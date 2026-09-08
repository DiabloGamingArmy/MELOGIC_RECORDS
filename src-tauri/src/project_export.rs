//! Local, transactional export. Only a destination selected in Save As is writable.
use std::{collections::HashMap, io::Write, path::PathBuf, sync::{Mutex, atomic::{AtomicU64, Ordering}}};
use tauri::State;
struct PendingExport { temporary: tempfile::NamedTempFile, destination: PathBuf }
#[derive(Default)]
pub struct ProjectExportState { pending: Mutex<HashMap<String, PendingExport>>, next: AtomicU64 }
#[tauri::command]
pub async fn project_export_begin(name: String, state: State<'_, ProjectExportState>) -> Result<Option<String>, String> {
    let filename = std::path::Path::new(&name).file_name().and_then(|s| s.to_str()).unwrap_or("Soura Mix.wav").to_owned();
    let destination = tauri::async_runtime::spawn_blocking(move || rfd::FileDialog::new().set_file_name(filename).add_filter("WAV audio", &["wav"]).save_file()).await.map_err(|e| e.to_string())?;
    let Some(destination) = destination else { return Ok(None) };
    let parent = destination.parent().ok_or("Invalid save directory")?;
    let temporary = tempfile::Builder::new().prefix(".soura-export-").tempfile_in(parent).map_err(|e| format!("Cannot create export in selected directory: {e}"))?;
    let id = state.next.fetch_add(1, Ordering::Relaxed).to_string();
    state.pending.lock().map_err(|e| e.to_string())?.insert(id.clone(), PendingExport { temporary, destination });
    Ok(Some(id))
}
#[tauri::command]
pub fn project_export_write(id: String, bytes: Vec<u8>, state: State<'_, ProjectExportState>) -> Result<(), String> {
    if bytes.len() > 262144 { return Err("Export chunk too large".into()) }
    let mut pending = state.pending.lock().map_err(|e| e.to_string())?;
    pending.get_mut(&id).ok_or("Export session has ended")?.temporary.write_all(&bytes).map_err(|e| format!("Cannot write export: {e}"))
}
#[tauri::command]
pub fn project_export_finish(id: String, state: State<'_, ProjectExportState>) -> Result<(), String> {
    let mut export = state.pending.lock().map_err(|e| e.to_string())?.remove(&id).ok_or("Export session has ended")?;
    export.temporary.flush().map_err(|e| format!("Cannot flush export: {e}"))?;
    export.temporary.as_file().sync_all().map_err(|e| format!("Cannot save export: {e}"))?;
    export.temporary.persist(export.destination).map_err(|e| format!("Cannot finalize export: {e}"))?;
    Ok(())
}
#[tauri::command]
pub fn project_export_cancel(id: String, state: State<'_, ProjectExportState>) -> Result<(), String> {
    state.pending.lock().map_err(|e| e.to_string())?.remove(&id);
    Ok(())
}
