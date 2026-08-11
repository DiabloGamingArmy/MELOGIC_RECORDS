use std::{
  f32::consts::TAU,
  time::Instant,
};

use serde::Serialize;
use signalsmith_stretch::Stretch;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDspSelfTestResult {
  pub engine: String,
  pub channels: u32,
  pub sample_rate: u32,
  pub duration_seconds: f32,
  pub semitones: f32,
  pub processing_ms: f64,
  pub realtime_factor: f64,
  pub input_peak: f32,
  pub output_peak: f32,
  pub block_frames: usize,
  pub input_latency_frames: usize,
  pub output_latency_frames: usize,
}

pub fn run_signalsmith_self_test(
  semitones: f32,
) -> Result<NativeDspSelfTestResult, String> {
  const CHANNELS: u32 = 2;
  const SAMPLE_RATE: u32 = 48_000;
  const DURATION_SECONDS: f32 = 2.0;
  const BLOCK_FRAMES: usize = 1024;

  let total_frames =
    (SAMPLE_RATE as f32 * DURATION_SECONDS)
      as usize;

  let mut source =
    vec![
      0.0f32;
      total_frames * CHANNELS as usize
    ];

  for frame in 0..total_frames {
    let t =
      frame as f32
      / SAMPLE_RATE as f32;

    let sample =
      (TAU * 220.0 * t).sin()
      * 0.25;

    let index =
      frame * CHANNELS as usize;

    source[index] = sample;
    source[index + 1] = sample;
  }

  let mut stretch =
    Stretch::preset_cheaper(
      CHANNELS,
      SAMPLE_RATE,
    );

  stretch.set_transpose_factor_semitones(
    semitones,
    None,
  );

  let input_latency =
    stretch.input_latency();

  let output_latency =
    stretch.output_latency();

  let started =
    Instant::now();

  let mut output =
    vec![
      0.0f32;
      source.len()
    ];

  let channels =
    CHANNELS as usize;

  let mut frame_offset =
    0usize;

  while frame_offset < total_frames {
    let frames =
      BLOCK_FRAMES.min(
        total_frames - frame_offset
      );

    let sample_start =
      frame_offset * channels;

    let sample_end =
      (frame_offset + frames)
      * channels;

    stretch.process(
      &source[
        sample_start..sample_end
      ],
      &mut output[
        sample_start..sample_end
      ],
    );

    frame_offset += frames;
  }

  let processing_seconds =
    started.elapsed()
      .as_secs_f64();

  let processing_ms =
    processing_seconds * 1000.0;

  let realtime_factor =
    if processing_seconds > 0.0 {
      DURATION_SECONDS as f64
      / processing_seconds
    } else {
      f64::INFINITY
    };

  let input_peak =
    source.iter()
      .fold(
        0.0f32,
        |peak, sample|
          peak.max(sample.abs())
      );

  let output_peak =
    output.iter()
      .fold(
        0.0f32,
        |peak, sample|
          peak.max(sample.abs())
      );

  Ok(
    NativeDspSelfTestResult {
      engine:
        "signalsmith-stretch-native"
          .to_string(),

      channels:
        CHANNELS,

      sample_rate:
        SAMPLE_RATE,

      duration_seconds:
        DURATION_SECONDS,

      semitones,

      processing_ms,
      realtime_factor,

      input_peak,
      output_peak,

      block_frames:
        BLOCK_FRAMES,

      input_latency_frames:
        input_latency,

      output_latency_frames:
        output_latency,
    }
  )
}
