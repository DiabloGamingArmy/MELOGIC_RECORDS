# StageMaker Roadmap

## Phase 2: Keybinds and Transform Gizmo Foundation

Status: implemented as a conservative editor interaction pass.

- Keyboard shortcuts added for Select (`V`), Pan (`H`), Move (`G` / `M`), Rotate (`R`), Scale (`S`), Focus selected (`F`), Frame all (`A`), Duplicate (`Cmd/Ctrl+D`), Save (`Cmd/Ctrl+S`), Delete / Backspace, and Escape cancel.
- Hotkeys are ignored while typing in inputs, textareas, selects, or contenteditable fields.
- Tab now toggles between Object Mode and the Phase 3 Edit Mode foundation when the selected object supports simple footprint editing.
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

## Phase 3: Edit Mode Foundation

Status: implemented for simple rectangular objects.

- Object Mode / Edit Mode state is explicit and saved in local editor recovery.
- `Tab` enters Edit Mode for supported selected objects and returns to Object Mode from Edit Mode.
- Edit Mode currently supports simple rectangular or box-like objects such as the stage deck when unlocked, primitive rectangle/square/cube objects, platforms, decks, and booth-like blocks.
- Locked objects stay in Object Mode and show "Unlock this object before editing."
- Unsupported production objects such as speakers, microphones, fixtures, cameras, truss, LED walls, screens, power, grouped, or linked objects remain unavailable for Edit Mode.
- The Three.js viewport draws a wireframe edit overlay plus four corner and four edge handles above the selected supported object.
- Dragging an edit handle resizes width and/or depth, clamps width/depth to at least 0.5, preserves height at least 0.1, respects grid snap when enabled, and commits through the existing object transform/save path.
- Resizing uses center-origin mesh data but shifts the object center by half of the size delta so the opposite edge remains visually anchored for the simple rectangular cases.

Known limitations:

- This is not vertex, edge, face, or arbitrary mesh editing.
- Edit handles are tuned first for top/planning views; 3D and isometric views are usable but still screen-space based.
- Height editing is intentionally left to the existing scale tool and Properties panel until a reliable height handle is designed.
