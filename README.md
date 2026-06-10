# Pixel Studio

A minimal, dependency-free pixel art editor built with vanilla JavaScript and the HTML5 Canvas API. No frameworks, no build step, no `node_modules` — open `index.html` and draw.

![Pixel Studio screenshot](docs/screenshot.png)

## Features

- **Drawing tools** — pencil, eraser (true transparency), flood fill, and an eyedropper that samples colors from the canvas.
- **Shape tools** — rectangle, square, circle, and regular polygons (triangle, pentagon, hexagon, heptagon, octagon), drawn by dragging from corner to corner with a live preview.
- **Undo / redo** — every stroke, fill, and shape is a single, reversible history step.
- **Color** — native color picker, a curated 16-swatch palette, and an auto-updating list of recently used colors.
- **Canvas sizes** — 16×16, 32×32, or 64×64.
- **Zoom** — scale the working canvas from 4px to 48px per cell.
- **Toggleable grid lines** for precise placement.
- **PNG export** — preserves transparency and upscales with nearest-neighbour so the output stays crisp.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `B` | Pencil |
| `E` | Eraser |
| `G` | Fill (bucket) |
| `I` | Eyedropper |
| `[` / `]` | Zoom out / in |
| `Ctrl/⌘ + Z` | Undo |
| `Ctrl/⌘ + Shift + Z` or `Ctrl + Y` | Redo |

## Running it

It's a static site — no install required.

```bash
# Option 1: just open the file
open index.html        # macOS
start index.html       # Windows

# Option 2: serve it (recommended, avoids any file:// quirks)
python -m http.server 8000
# then visit http://localhost:8000
```

## How it works

The editor keeps a single source of truth: a `rows × cols` matrix of color
strings (or `null` for transparent cells). Everything else is derived from it.

- **Rendering** — `render()` paints each non-empty cell as a scaled rectangle.
  Shape tools pass an *overlay* set of cells so a preview can be drawn on top of
  the grid without mutating it until the drag ends.
- **History** — before each committed action the grid is deep-copied onto an
  undo stack (capped at 100 entries); redo mirrors it. One user action maps to
  exactly one undo step.
- **Shapes** — polygon vertices are computed on the drag's bounding ellipse and
  connected with a Bresenham line rasteriser; circles/ellipses are sampled
  parametrically. Square and circle constrain to equal extents.
- **Export** — the grid is drawn at native resolution (1px per cell) onto an
  offscreen canvas to preserve alpha, then upscaled with image smoothing
  disabled for clean, blocky pixels.

## Project structure

```
pixel-art-canvas/
├── index.html   # markup + inline SVG icons
├── styles.css   # theming via CSS custom properties
├── app.js       # state, rendering, tools, history, export
└── README.md
```

## License

MIT — see [LICENSE](LICENSE).
