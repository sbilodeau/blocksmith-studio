# Pixel editor

The 1:1 editor opens when you double-click a texture in the grid (or select it and press Enter). It edits one
texture at a time, inside the pack's tab; going back to the grid keeps the editor state for that tab.

## Tools

| Tool         | Key | Behavior                                                                       |
| ------------ | --- | ------------------------------------------------------------------------------ |
| Pencil       | B   | Paints single pixels; dragging draws continuous lines                          |
| Eraser       | E   | Makes pixels fully transparent                                                 |
| Paint bucket | G   | Fills an area; options: tolerance (0-128) and contiguous area only             |
| Eyedropper   | I   | Picks the color under the cursor (left = first color, right = second color)    |
| Line         | L   | Straight pixel line with live preview                                          |
| Rectangle    | R   | Outline or filled rectangle (option "Filled rectangles")                       |
| Select       | M   | Drag to select; drag inside the selection to move it; copy, cut, paste, delete |

Left click uses the first color, right click the second (transparent by default). Mirror painting (left/right
and/or top/bottom) applies to the pencil, eraser, line and rectangle tools.

## Shortcuts

| Action                         | Shortcut                                |
| ------------------------------ | --------------------------------------- |
| Undo / redo (unsaved edits)    | Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y  |
| Save                           | Ctrl/Cmd+S                              |
| Copy / cut / paste             | Ctrl/Cmd+C, X, V                        |
| Select all / deselect          | Ctrl/Cmd+A, Escape                      |
| Delete selection               | Delete or Backspace                     |
| Drop a moved/pasted selection  | Enter (or switch tool)                  |
| Rotate 90° clockwise / counter | ] and [                                 |
| Flip horizontally / vertically | Shift+H, Shift+V                        |
| Swap first and second colors   | X                                       |
| Zoom in / out / fit            | + , - , 0 (or Ctrl/Cmd + scroll, pinch) |
| Move around                    | Scroll, or Space + drag, or middle drag |
| Preview vanilla in place       | Hold C                                  |
| Previous / next texture        | Page Up / Page Down (or Alt+Left/Right) |

Rotate and flip apply to the selection when there is one, otherwise to the whole texture.

## Compare and revert

- **Compare** shows the vanilla texture next to yours at the same scale. Holding **C** swaps the canvas to vanilla.
- **Revert to vanilla** deletes the pack's copy of the texture (only shown for modified textures). It is recorded in
  the saved history, so it can be undone.

## Animated textures

Animated textures are vertical strips (for example `block/fire_0.png`, 16 x 512 = 32 frames). The editor shows the
whole strip with red dashed lines between frames and fits the first frame to the view; scroll to move along the
strip. A frame timeline with playback comes in a later milestone (M9).

## Undo levels

1. **Unsaved edits** (left list in the History panel): every stroke, fill, shape, move, rotate or flip is one
   step. Steps are stored as minimal patches (the changed rectangle before and after), so long sessions stay light.
   Rotating a non-square texture changes its size; that step stores the whole image instead.
2. **Saved history** (pack journal): each save or revert is one entry in `.blocksmith/history/`. Undo/redo of saved
   steps rewrites the files on disk and refuses to clobber a file changed outside the app (see [packs.md](packs.md)).
   These buttons are disabled while the open texture has unsaved edits.

## How it works

- `src/renderer/stores/editor.ts`: one Pinia store per pack tab (`editor/<packId>`) holding the working image
  (straight RGBA, from `@shared/image`), the saved image, the vanilla image, the local undo/redo stacks, tool state,
  colors, selection and floating selection. A shared clipboard lets you paste between packs.
- `src/renderer/components/editor/PixelCanvas.vue`: Canvas 2D rendering at integer zoom with smoothing disabled,
  input handling for every tool. Pixel data is never read back from the canvas: the image core buffer is the source of
  truth, so colors stay exact (no premultiplied-alpha or color-management rounding).
- Loading and saving go through `texture.read` / `texture.save` (PNG bytes over IPC). PNGs are decoded and encoded
  with the image core (`decodePng` / `encodePng`, exact RGBA8).
- All drawing operations come from `src/shared/image` ([image-core.md](image-core.md)), the same code the AI tools
  will use in M3.
