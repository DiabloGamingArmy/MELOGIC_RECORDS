#!/usr/bin/env python3
from pathlib import Path
import json
import shutil

ROOT = Path.cwd()

configs = [
    path for path in ROOT.rglob("tauri.conf.json")
    if "node_modules" not in path.parts
    and "target" not in path.parts
]

if not configs:
    raise SystemExit(
        "No tauri.conf.json found under this repository. "
        "If Nexus lives in a sibling folder, run this script from that project's root instead."
    )

changed = 0

for path in configs:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:
        print("skip:", path, error)
        continue

    app = data.get("app")
    if not isinstance(app, dict):
        continue

    windows = app.get("windows")
    if not isinstance(windows, list) or not windows:
        continue

    # Prefer the main/Nexus window; otherwise use the first configured window.
    index = 0
    for candidate_index, window in enumerate(windows):
        label = str(window.get("label", "")).lower()
        title = str(window.get("title", "")).lower()
        if "main" in label or "nexus" in label or "melogic nexus" in title:
            index = candidate_index
            break

    window = windows[index]

    backup = path.with_suffix(".json.window-v44.bak")
    if not backup.exists():
        shutil.copy2(path, backup)

    window["width"] = 1280
    window["height"] = 800
    window["minWidth"] = min(int(window.get("minWidth", 900) or 900), 1100)
    window["minHeight"] = min(int(window.get("minHeight", 640) or 640), 720)
    window["resizable"] = True
    window["center"] = True
    window["maximized"] = False

    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8"
    )

    changed += 1
    print("updated:", path)
    print("backup :", backup)
    print("window :", window.get("label") or window.get("title") or index)

if not changed:
    raise SystemExit(
        "Tauri config(s) were found, but none used an app.windows configuration."
    )

print(f"Updated {changed} Tauri config(s).")
