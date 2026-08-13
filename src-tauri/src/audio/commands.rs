use tauri::State;
use tauri::AppHandle;

use super::{
  dsp::{
    run_signalsmith_self_test,
    NativeDspSelfTestResult,
  },
  engine::{
    NativeAudioDeviceInfo,
    NativeAudioStatus,
  },
  NativeAudioState,
};
use super::analysis::{analyze_with_cache, NativeAudioAnalysisRequest};

fn lock_error() -> String {
  "Soura native audio engine state is unavailable."
    .to_string()
}

#[tauri::command]
pub fn native_audio_initialize(
  state: State<'_, NativeAudioState>,
) -> Result<NativeAudioStatus, String> {
  let mut engine =
    state.engine.lock()
      .map_err(|_| lock_error())?;

  engine.initialize()
}

#[tauri::command]
pub fn native_audio_list_output_devices(
  state: State<'_, NativeAudioState>,
) -> Result<Vec<NativeAudioDeviceInfo>, String> {
  let engine =
    state.engine.lock()
      .map_err(|_| lock_error())?;

  engine.list_output_devices()
}

#[tauri::command]
pub fn native_audio_get_status(
  state: State<'_, NativeAudioState>,
) -> Result<NativeAudioStatus, String> {
  let engine =
    state.engine.lock()
      .map_err(|_| lock_error())?;

  Ok(engine.status())
}

#[tauri::command]
pub fn native_audio_start_test_tone(
  state: State<'_, NativeAudioState>,
  frequency_hz: Option<f32>,
  gain: Option<f32>,
) -> Result<NativeAudioStatus, String> {
  let mut engine =
    state.engine.lock()
      .map_err(|_| lock_error())?;

  engine.start_test_tone(
    frequency_hz.unwrap_or(440.0),
    gain.unwrap_or(0.06),
  )
}

#[tauri::command]
pub fn native_audio_stop_test_tone(
  state: State<'_, NativeAudioState>,
) -> Result<NativeAudioStatus, String> {
  let mut engine =
    state.engine.lock()
      .map_err(|_| lock_error())?;

  Ok(
    engine.stop_test_tone()
  )
}

#[tauri::command]
pub fn native_audio_dsp_self_test(
  semitones: Option<f32>,
) -> Result<NativeDspSelfTestResult, String> {
  run_signalsmith_self_test(
    semitones.unwrap_or(-5.0)
  )
}

#[tauri::command]
pub async fn native_audio_analyze_pcm(
  app: AppHandle,
  request: NativeAudioAnalysisRequest,
) -> Result<serde_json::Value, String> {
  tauri::async_runtime::spawn_blocking(move || {
    analyze_with_cache(&app, request)
  })
    .await
    .map_err(|error| format!("Native audio analysis task failed: {error}"))?
}
