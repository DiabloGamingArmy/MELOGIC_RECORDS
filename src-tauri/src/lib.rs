mod audio;
mod assets;
mod vst3;
mod native_vst3_host;

use audio::NativeAudioState;
use native_vst3_host::NativeVst3HostState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(NativeAudioState::default())
    .manage(NativeVst3HostState::default())
    .invoke_handler(tauri::generate_handler![
      audio::commands::native_audio_initialize,
      audio::commands::native_audio_list_output_devices,
      audio::commands::native_audio_get_status,
      audio::commands::native_audio_start_test_tone,
      audio::commands::native_audio_stop_test_tone,
      audio::commands::native_audio_dsp_self_test,
      audio::commands::native_audio_analyze_pcm,
      assets::native_asset_list,
      assets::native_asset_store,
      assets::native_asset_read,
      vst3::native_vst3_scan,
      vst3::native_vst3_is_available,
      native_vst3_host::native_vst3_host_create,
      native_vst3_host::native_vst3_host_note_on,
      native_vst3_host::native_vst3_host_note_off,
      native_vst3_host::native_vst3_host_set_mix,
      native_vst3_host::native_vst3_host_open_editor,
      native_vst3_host::native_vst3_host_dispose,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
