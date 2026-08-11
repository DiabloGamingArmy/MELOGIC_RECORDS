mod audio;

use audio::NativeAudioState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(NativeAudioState::default())
    .invoke_handler(tauri::generate_handler![
      audio::commands::native_audio_initialize,
      audio::commands::native_audio_list_output_devices,
      audio::commands::native_audio_get_status,
      audio::commands::native_audio_start_test_tone,
      audio::commands::native_audio_stop_test_tone,
      audio::commands::native_audio_dsp_self_test,
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
