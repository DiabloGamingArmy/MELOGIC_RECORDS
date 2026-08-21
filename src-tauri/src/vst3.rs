use serde::Serialize;
use std::{env, fs, path::{Path, PathBuf}};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeVst3Plugin {
    pub name: String,
    pub path: String,
    pub vendor: String,
    pub version: String,
    pub bundle_id: String,
    pub source_root: String,
}

fn standard_vst3_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    #[cfg(target_os = "macos")]
    {
        roots.push(PathBuf::from("/Library/Audio/Plug-Ins/VST3"));
        if let Some(home) = env::var_os("HOME") {
            roots.push(PathBuf::from(home).join("Library/Audio/Plug-Ins/VST3"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(common) = env::var_os("COMMONPROGRAMFILES") {
            roots.push(PathBuf::from(common).join("VST3"));
        }
        if let Some(local) = env::var_os("LOCALAPPDATA") {
            roots.push(PathBuf::from(local).join("Programs/Common/VST3"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        roots.push(PathBuf::from("/usr/lib/vst3"));
        roots.push(PathBuf::from("/usr/local/lib/vst3"));
        if let Some(home) = env::var_os("HOME") {
            roots.push(PathBuf::from(home).join(".vst3"));
        }
    }

    roots
}

fn extract_plist_string(text: &str, key: &str) -> String {
    let marker = format!("<key>{}</key>", key);
    let Some(key_pos) = text.find(&marker) else { return String::new(); };
    let after = &text[key_pos + marker.len()..];
    let Some(start_rel) = after.find("<string>") else { return String::new(); };
    let value = &after[start_rel + "<string>".len()..];
    let Some(end_rel) = value.find("</string>") else { return String::new(); };
    value[..end_rel].trim().to_string()
}

fn read_bundle_metadata(bundle: &Path, root: &Path) -> NativeVst3Plugin {
    let fallback_name = bundle
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Unknown VST3")
        .to_string();

    let mut plugin = NativeVst3Plugin {
        name: fallback_name,
        path: bundle.to_string_lossy().to_string(),
        vendor: String::new(),
        version: String::new(),
        bundle_id: String::new(),
        source_root: root.to_string_lossy().to_string(),
    };

    #[cfg(target_os = "macos")]
    {
        let plist_path = bundle.join("Contents/Info.plist");
        if let Ok(bytes) = fs::read(plist_path) {
            if let Ok(text) = String::from_utf8(bytes) {
                let name = extract_plist_string(&text, "CFBundleDisplayName");
                let name = if name.is_empty() { extract_plist_string(&text, "CFBundleName") } else { name };
                if !name.is_empty() { plugin.name = name; }
                plugin.version = extract_plist_string(&text, "CFBundleShortVersionString");
                plugin.bundle_id = extract_plist_string(&text, "CFBundleIdentifier");
                plugin.vendor = extract_plist_string(&text, "CFBundleGetInfoString");
            }
        }
    }

    plugin
}

fn scan_root(root: &Path, output: &mut Vec<NativeVst3Plugin>) {
    let Ok(entries) = fs::read_dir(root) else { return; };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_vst3 = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("vst3"))
            .unwrap_or(false);

        if is_vst3 {
            output.push(read_bundle_metadata(&path, root));
            continue;
        }

        // Some vendors group plug-ins in one intermediate directory. Descend
        // one level, but never recurse into a discovered .vst3 bundle.
        if path.is_dir() {
            let Ok(children) = fs::read_dir(&path) else { continue; };
            for child in children.flatten() {
                let child_path = child.path();
                let child_is_vst3 = child_path
                    .extension()
                    .and_then(|value| value.to_str())
                    .map(|value| value.eq_ignore_ascii_case("vst3"))
                    .unwrap_or(false);
                if child_is_vst3 {
                    output.push(read_bundle_metadata(&child_path, root));
                }
            }
        }
    }
}

#[tauri::command]
pub fn native_vst3_scan() -> Vec<NativeVst3Plugin> {
    let mut plugins = Vec::new();
    for root in standard_vst3_roots() {
        scan_root(&root, &mut plugins);
    }

    plugins.sort_by(|a, b| {
        a.name
            .to_ascii_lowercase()
            .cmp(&b.name.to_ascii_lowercase())
            .then_with(|| a.path.cmp(&b.path))
    });
    plugins.dedup_by(|a, b| a.path == b.path);
    plugins
}

#[tauri::command]
pub fn native_vst3_is_available(path: String) -> bool {
    let candidate = PathBuf::from(path);
    candidate.exists()
        && candidate
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("vst3"))
            .unwrap_or(false)
}
