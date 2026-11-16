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
| Previous / next frame          | , and . (animated textures)             |

Rotate and flip apply to the selection when there is one, otherwise to the whole texture.

## Compare and revert

- **Compare** shows the vanilla texture next to yours at the same scale. Holding **C** swaps the canvas to vanilla.
- **Revert to vanilla** deletes the pack's copy of the texture (only shown for modified textures). It is recorded in
  the saved history, so it can be undone.

## Animated textures

Animated textures are vertical strips of frames (for example `block/fire_0.png`, 16 x 512 = 32 frames of 16 x 16)
described by a `.png.mcmeta` file. The editor edits **one frame at a time**: the canvas shows the current frame, and
every tool (pencil, fill, mirror, selection, rotate, flip, paste) stays inside it. A timeline under the canvas holds:

- the frames as thumbnails with their number and duration (click one to edit it; `,` and `.` move between frames);
- **Play / Pause**: plays the animation in the small preview next to the frames (with **Smooth** on, frames blend
  into each other as in the game), and in the 3D view. When paused, the 3D view shows the frame you are editing;
- **Add frame** (blank, after the current one), **Duplicate**, **Delete frame**, **◀ Move / Move ▶**;
- **Onion skin**: the previous frame drawn faintly over the current one, to line up movements;
- **Frame time** (ticks per frame, 1 tick = 1/20 s), the current frame's own duration (empty: the frame time) and
  **Smooth** (`interpolate`);
- **Import GIF...**: replaces the frames with the GIF's frames, fitted to the frame size (nearest neighbor, aspect
  kept, centered) with their delays converted to ticks (the most common delay becomes the frame time);
- **Remove animation**: keeps the current frame as a still texture.

**Animate** in the editor header turns a still texture into a one-frame animation to start from. Every timeline
action is one unsaved edit (undo restores frames and timing together; undoing a drawing step shows its frame again).

Saving writes the strip and its `.png.mcmeta` as one entry in the saved history. Minecraft reads a texture's
`.mcmeta` only from the pack that provides the PNG (or a pack above it), so when the animation came from vanilla, the
save copies it into the pack: without it, an edited vanilla animation would show the whole strip at once in game.
A custom playback order in the `.mcmeta` (`frames` with repeats) is kept and follows its images when frames move.
Only vertical strips of full-width frames are edited frame by frame; frames laid out in a grid are edited as one
image.

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
- Animated textures: the store keeps the frames (`frames`, `frameIndex`) with `image` pointing at the current frame,
  the parsed `.mcmeta` (`meta`) and computed `strip` / `mcmeta` for saving, the 3D view and the AI agent. The pure
  parts (parse and write `.mcmeta`, split and join frames, keep a custom playback order on the same images when frames
  are added, removed or moved, playback timing) are in `src/shared/animation/`. GIF decoding (with frame disposal)
  runs in main (`src/main/services/packs/gif.ts`, channel `texture.importGif`).
- `src/renderer/components/editor/PixelCanvas.vue`: Canvas 2D rendering at integer zoom with smoothing disabled,
  input handling for every tool. Pixel data is never read back from the canvas: the image core buffer is the source of
  truth, so colors stay exact (no premultiplied-alpha or color-management rounding).
- Loading and saving go through `texture.read` / `texture.save` (PNG bytes over IPC). PNGs are decoded and encoded
  with the image core (`decodePng` / `encodePng`, exact RGBA8).
- All drawing operations come from `src/shared/image` ([image-core.md](image-core.md)), the same code the AI tools
  will use in M3.
