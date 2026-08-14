use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreAssetRequest {
    asset_id: String,
    file_name: String,
    bytes: Vec<u8>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetSource {
    local_path: String,
    content_type: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAsset {
    id: String,
    name: String,
    kind: String,
    source_type: String,
    parent_id: String,
    source: AssetSource,
    local_path: String,
}

fn safe_component(value: &str, fallback: &str) -> String {
    let clean: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || "._-".contains(ch) {
                ch
            } else {
                '_'
            }
        })
        .take(220)
        .collect();
    if clean.is_empty() || clean == "." || clean == ".." {
        fallback.to_string()
    } else {
        clean
    }
}

fn asset_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("Soura")
        .join("Assets")
        .join("User");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root)
}

fn index_path(root: &Path) -> PathBuf {
    root.join("index.json")
}

fn read_index(root: &Path) -> Result<Vec<StoredAsset>, String> {
    let path = index_path(root);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn native_asset_list(app: AppHandle) -> Result<Vec<StoredAsset>, String> {
    let root = asset_root(&app)?;
    read_index(&root)
}

#[tauri::command]
pub async fn native_asset_store(
    app: AppHandle,
    request: StoreAssetRequest,
) -> Result<StoredAsset, String> {
    if request.bytes.is_empty() {
        return Err("Audio asset is empty.".into());
    }
    let root = asset_root(&app)?;
    let id = safe_component(&request.asset_id, "asset");
    let display_name = safe_component(&request.file_name, "audio.bin");
    let stored_name = format!("{}--{}", id, display_name);
    let target = root.join(stored_name);
    fs::write(&target, request.bytes).map_err(|error| error.to_string())?;
    let extension = target
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let content_type = match extension.as_str() {
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "ogg" | "oga" => "audio/ogg",
        "webm" => "audio/webm",
        "flac" => "audio/flac",
        _ => "application/octet-stream",
    }
    .to_string();
    let local_path = target.to_string_lossy().to_string();
    let record = StoredAsset {
        id: request.asset_id,
        name: display_name,
        kind: "audio".into(),
        source_type: "user".into(),
        parent_id: "user".into(),
        source: AssetSource {
            local_path: local_path.clone(),
            content_type,
        },
        local_path,
    };
    let mut rows = read_index(&root)?;
    rows.retain(|row| row.id != record.id);
    rows.push(record.clone());
    fs::write(
        index_path(&root),
        serde_json::to_vec_pretty(&rows).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(record)
}

#[tauri::command]
pub async fn native_asset_read(app: AppHandle, asset_id: String) -> Result<Vec<u8>, String> {
    let root = asset_root(&app)?;
    let row = read_index(&root)?
        .into_iter()
        .find(|row| row.id == asset_id)
        .ok_or_else(|| "Audio asset not found.".to_string())?;
    let path = PathBuf::from(row.source.local_path);
    if path.parent() != Some(root.as_path()) {
        return Err("Stored asset path is invalid.".into());
    }
    fs::read(path).map_err(|error| error.to_string())
}
