# StageMaker Roadmap

## Phase 2: Keybinds and Transform Gizmo Foundation

Status: implemented as a conservative editor interaction pass.

- Keyboard shortcuts added for Select (`V`), Pan (`H`), Move (`G` / `M`), Rotate (`R`), Scale (`S`), Focus selected (`F`), Frame all (`A`), Duplicate (`Cmd/Ctrl+D`), Save (`Cmd/Ctrl+S`), Delete / Backspace, and Escape cancel.
- Hotkeys are ignored while typing in inputs, textareas, selects, or contenteditable fields.
- Tab is reserved for a future Edit Mode and currently shows a Phase 3 notice.
- Move gizmo is implemented in the Three.js viewport with X, Y, and Z axis handles. X and Z snap to the existing grid interval when snap is enabled; Y remains continuous elevation.
- Rotate gizmo is implemented as a single yaw ring because the current practical object rotation field is `rotation.y`.
- Scale gizmo is implemented with X, Y, and Z handles mapped to width, height, and depth. Dimensions are clamped above zero.
- Locked selected objects show a locked message and do not transform.
- Transform commits use the existing selected-object update path, so the properties panel, object table, local recovery, and save queue stay synchronized.

Known limitations:

- This is object-mode only. Vertex, edge, face, and mesh Edit Mode are intentionally not implemented in Phase 2.
- Rotation exposes only the supported yaw axis. Multi-axis rotation is not presented as functional yet.
- Gizmo dragging uses screen-space axis deltas for simple predictable control; more precise world-space plane constraints can be refined later.
- Multi-select transform remains limited to the existing primary selected object behavior.
