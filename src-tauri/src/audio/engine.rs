use std::{
  f32::consts::TAU,
  sync::{
    atomic::{
      AtomicBool,
      AtomicU32,
      Ordering,
    },
    Arc,
  },
};

use cpal::{
  traits::{
    DeviceTrait,
    HostTrait,
    StreamTrait,
  },
  Device,
  SampleFormat,
  Stream,
  StreamConfig,
  SupportedBufferSize,
};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioDeviceInfo {
  pub index: usize,
  pub name: String,
  pub is_default: bool,
  pub max_channels: u16,
  pub min_sample_rate: u32,
  pub max_sample_rate: u32,
  pub buffer_size: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioStatus {
  pub backend: String,
  pub ready: bool,
  pub stream_active: bool,
  pub test_tone_active: bool,
  pub device_name: Option<String>,
  pub sample_rate: Option<u32>,
  pub channels: Option<u16>,
  pub sample_format: Option<String>,
}

#[derive(Default)]
struct RealtimeControl {
  tone_active: AtomicBool,
  tone_frequency_bits: AtomicU32,
  tone_gain_bits: AtomicU32,
}

impl RealtimeControl {
  fn set_tone(
    &self,
    active: bool,
    frequency_hz: f32,
    gain: f32,
  ) {
    self.tone_frequency_bits.store(
      frequency_hz.to_bits(),
      Ordering::Relaxed,
    );

    self.tone_gain_bits.store(
      gain.to_bits(),
      Ordering::Relaxed,
    );

    self.tone_active.store(
      active,
      Ordering::Release,
    );
  }

  fn tone_active(&self) -> bool {
    self.tone_active.load(
      Ordering::Acquire,
    )
  }

  fn frequency_hz(&self) -> f32 {
    f32::from_bits(
      self.tone_frequency_bits.load(
        Ordering::Relaxed,
      )
    )
  }

  fn gain(&self) -> f32 {
    f32::from_bits(
      self.tone_gain_bits.load(
        Ordering::Relaxed,
      )
    )
  }
}

pub struct NativeAudioEngine {
  stream: Option<Stream>,
  control: Arc<RealtimeControl>,

  device_name: Option<String>,
  sample_rate: Option<u32>,
  channels: Option<u16>,
  sample_format: Option<SampleFormat>,
}

impl NativeAudioEngine {
  pub fn new() -> Self {
    let control =
      Arc::new(
        RealtimeControl::default()
      );

    control.set_tone(
      false,
      440.0,
      0.08,
    );

    Self {
      stream: None,
      control,
      device_name: None,
      sample_rate: None,
      channels: None,
      sample_format: None,
    }
  }

  pub fn initialize(
    &mut self,
  ) -> Result<NativeAudioStatus, String> {
    self.ensure_default_output_stream()?;
    Ok(self.status())
  }

  pub fn list_output_devices(
    &self,
  ) -> Result<Vec<NativeAudioDeviceInfo>, String> {
    let host =
      cpal::default_host();

    let default_name =
      host.default_output_device()
        .and_then(
          |device| device.name().ok()
        );

    let devices =
      host.output_devices()
        .map_err(
          |error|
            format!(
              "Could not enumerate output devices: {error}"
            )
        )?;

    let mut result =
      Vec::new();

    for (index, device) in devices.enumerate() {
      let name =
        device.name()
          .unwrap_or_else(
            |_| "Unknown Audio Device".to_string()
          );

      let mut max_channels = 0u16;
      let mut min_sample_rate = u32::MAX;
      let mut max_sample_rate = 0u32;
      let mut buffer_size =
        "Unknown".to_string();

      if let Ok(configs) =
        device.supported_output_configs()
      {
        for config in configs {
          max_channels =
            max_channels.max(
              config.channels()
            );

          min_sample_rate =
            min_sample_rate.min(
              config.min_sample_rate()
            );

          max_sample_rate =
            max_sample_rate.max(
              config.max_sample_rate()
            );

          buffer_size =
            supported_buffer_size_label(
              config.buffer_size()
            );
        }
      }

      if min_sample_rate == u32::MAX {
        min_sample_rate = 0;
      }

      result.push(
        NativeAudioDeviceInfo {
          index,
          is_default:
            default_name.as_deref()
              == Some(name.as_str()),
          name,
          max_channels,
          min_sample_rate,
          max_sample_rate,
          buffer_size,
        }
      );
    }

    Ok(result)
  }

  pub fn start_test_tone(
    &mut self,
    frequency_hz: f32,
    gain: f32,
  ) -> Result<NativeAudioStatus, String> {
    self.ensure_default_output_stream()?;

    let frequency_hz =
      frequency_hz.clamp(
        20.0,
        20_000.0,
      );

    let gain =
      gain.clamp(
        0.0,
        0.25,
      );

    self.control.set_tone(
      true,
      frequency_hz,
      gain,
    );

    Ok(self.status())
  }

  pub fn stop_test_tone(
    &mut self,
  ) -> NativeAudioStatus {
    self.control.set_tone(
      false,
      440.0,
      0.0,
    );

    self.status()
  }

  pub fn status(
    &self,
  ) -> NativeAudioStatus {
    NativeAudioStatus {
      backend:
        "native-cpal".to_string(),

      ready:
        self.stream.is_some(),

      stream_active:
        self.stream.is_some(),

      test_tone_active:
        self.control.tone_active(),

      device_name:
        self.device_name.clone(),

      sample_rate:
        self.sample_rate,

      channels:
        self.channels,

      sample_format:
        self.sample_format.map(
          |format|
            format!("{format:?}")
        ),
    }
  }

  fn ensure_default_output_stream(
    &mut self,
  ) -> Result<(), String> {
    if self.stream.is_some() {
      return Ok(());
    }

    let host =
      cpal::default_host();

    let device =
      host.default_output_device()
        .ok_or_else(
          ||
            "No native audio output device is available."
              .to_string()
        )?;

    let device_name =
      device.name()
        .unwrap_or_else(
          |_| "Default Audio Output".to_string()
        );

    let supported_config =
      device.default_output_config()
        .map_err(
          |error|
            format!(
              "Could not read the default output configuration: {error}"
            )
        )?;

    let sample_format =
      supported_config.sample_format();

    let config:
      StreamConfig =
        supported_config.clone().into();

    let sample_rate =
      config.sample_rate;

    let channels =
      config.channels;

    let stream =
      build_output_stream(
        &device,
        &config,
        sample_format,
        Arc::clone(&self.control),
      )?;

    stream.play()
      .map_err(
        |error|
          format!(
            "Could not start native audio output: {error}"
          )
      )?;

    self.device_name =
      Some(device_name);

    self.sample_rate =
      Some(sample_rate);

    self.channels =
      Some(channels);

    self.sample_format =
      Some(sample_format);

    self.stream =
      Some(stream);

    Ok(())
  }
}

fn supported_buffer_size_label(
  size: &SupportedBufferSize,
) -> String {
  match size {
    SupportedBufferSize::Range {
      min,
      max,
    } => {
      format!("{min}-{max} frames")
    }

    SupportedBufferSize::Unknown => {
      "Driver controlled".to_string()
    }
  }
}

fn build_output_stream(
  device: &Device,
  config: &StreamConfig,
  sample_format: SampleFormat,
  control: Arc<RealtimeControl>,
) -> Result<Stream, String> {
  match sample_format {
    SampleFormat::F32 => {
      build_f32_stream(
        device,
        config,
        control,
      )
    }

    SampleFormat::I16 => {
      build_i16_stream(
        device,
        config,
        control,
      )
    }

    SampleFormat::U16 => {
      build_u16_stream(
        device,
        config,
        control,
      )
    }

    other => {
      Err(
        format!(
          "Soura native audio does not yet support output sample format {other:?}."
        )
      )
    }
  }
}

fn build_f32_stream(
  device: &Device,
  config: &StreamConfig,
  control: Arc<RealtimeControl>,
) -> Result<Stream, String> {
  let sample_rate =
    config.sample_rate as f32;

  let channels =
    usize::from(config.channels);

  let mut phase =
    0.0f32;

  let error_callback =
    |error| {
      log::error!(
        "[soura-native-audio] stream error: {error}"
      );
    };

  device.build_output_stream(
    config,
    move |output: &mut [f32], _| {
      write_test_tone_f32(
        output,
        channels,
        sample_rate,
        &control,
        &mut phase,
      );
    },
    error_callback,
    None,
  )
  .map_err(
    |error|
      format!(
        "Could not build F32 output stream: {error}"
      )
  )
}

fn build_i16_stream(
  device: &Device,
  config: &StreamConfig,
  control: Arc<RealtimeControl>,
) -> Result<Stream, String> {
  let sample_rate =
    config.sample_rate as f32;

  let channels =
    usize::from(config.channels);

  let mut phase =
    0.0f32;

  let error_callback =
    |error| {
      log::error!(
        "[soura-native-audio] stream error: {error}"
      );
    };

  device.build_output_stream(
    config,
    move |output: &mut [i16], _| {
      let active =
        control.tone_active();

      let frequency =
        control.frequency_hz();

      let gain =
        control.gain();

      for frame in output.chunks_mut(channels) {
        let sample =
          if active {
            (phase.sin() * gain)
              .clamp(-1.0, 1.0)
          } else {
            0.0
          };

        phase +=
          TAU * frequency / sample_rate;

        if phase >= TAU {
          phase -= TAU;
        }

        let converted =
          (sample * i16::MAX as f32)
            as i16;

        for channel in frame {
          *channel = converted;
        }
      }
    },
    error_callback,
    None,
  )
  .map_err(
    |error|
      format!(
        "Could not build I16 output stream: {error}"
      )
  )
}

fn build_u16_stream(
  device: &Device,
  config: &StreamConfig,
  control: Arc<RealtimeControl>,
) -> Result<Stream, String> {
  let sample_rate =
    config.sample_rate as f32;

  let channels =
    usize::from(config.channels);

  let mut phase =
    0.0f32;

  let error_callback =
    |error| {
      log::error!(
        "[soura-native-audio] stream error: {error}"
      );
    };

  device.build_output_stream(
    config,
    move |output: &mut [u16], _| {
      let active =
        control.tone_active();

      let frequency =
        control.frequency_hz();

      let gain =
        control.gain();

      for frame in output.chunks_mut(channels) {
        let sample =
          if active {
            (phase.sin() * gain)
              .clamp(-1.0, 1.0)
          } else {
            0.0
          };

        phase +=
          TAU * frequency / sample_rate;

        if phase >= TAU {
          phase -= TAU;
        }

        let converted =
          (((sample * 0.5) + 0.5)
            * u16::MAX as f32)
            as u16;

        for channel in frame {
          *channel = converted;
        }
      }
    },
    error_callback,
    None,
  )
  .map_err(
    |error|
      format!(
        "Could not build U16 output stream: {error}"
      )
  )
}

fn write_test_tone_f32(
  output: &mut [f32],
  channels: usize,
  sample_rate: f32,
  control: &RealtimeControl,
  phase: &mut f32,
) {
  let active =
    control.tone_active();

  let frequency =
    control.frequency_hz();

  let gain =
    control.gain();

  for frame in output.chunks_mut(channels) {
    let sample =
      if active {
        phase.sin() * gain
      } else {
        0.0
      };

    *phase +=
      TAU * frequency / sample_rate;

    if *phase >= TAU {
      *phase -= TAU;
    }

    for channel in frame {
      *channel = sample;
    }
  }
}
