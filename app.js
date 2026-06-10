/* ============================================================
   Pixel Studio — a minimal pixel art editor
   Vanilla JS, no dependencies. Canvas API + a grid data model.

   Architecture
   ------------
   - `state.grid` is the single source of truth: a rows × cols
     matrix of color strings (or null for transparent).
   - `render()` paints the grid onto the visible canvas; an optional
     overlay lets shape tools preview without mutating the grid.
   - Every committed action snapshots the grid into the undo stack,
     so one stroke / fill / shape = one undo step.
   - Export draws the grid at native resolution onto an offscreen
     canvas (transparency preserved), then upscales with nearest
     -neighbour for a crisp, shareable PNG.
   ============================================================ */

(() => {
  "use strict";

  // ---- Constants ----
  const MIN_CELL = 4;
  const MAX_CELL = 48;
  const HISTORY_LIMIT = 100;
  const GRID_LINE = "rgba(33, 31, 26, 0.12)";
  const PALETTE = [
    "#211f1a", "#5a5750", "#9a9488", "#ffffff",
    "#be5a38", "#e2894f", "#f0c060", "#fff2b0",
    "#3a7d52", "#7bbf6a", "#cfe88a", "#2d4a6b",
    "#4f86c6", "#8fc1e3", "#7a4ea3", "#c98bc0",
  ];

  // ---- State ----
  const state = {
    cols: 32,
    rows: 32,
    cell: 16,            // displayed pixels per grid cell (zoom)
    grid: [],            // [row][col] -> color string | null
    tool: "pencil",      // pencil | eraser | fill | eyedropper | shape
    shape: "rectangle",
    color: "#211f1a",
    showGrid: true,
    // interaction
    drawing: false,
    shapeStart: null,    // {x, y}
    strokeOpen: false,   // history already snapshotted for this stroke
    // history
    undo: [],
    redo: [],
    recent: [],
  };

  // ---- DOM ----
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const $ = (id) => document.getElementById(id);

  const el = {
    palette: $("palette"),
    recent: $("recent"),
    colorInput: $("color-input"),
    colorHex: $("color-hex"),
    zoomReadout: $("zoom-readout"),
    statusTool: $("status-tool"),
    statusSize: $("status-size"),
    statusPos: $("status-pos"),
  };

  // ======================================================
  //  Grid model
  // ======================================================
  function newGrid(cols, rows) {
    state.cols = cols;
    state.rows = rows;
    state.grid = Array.from({ length: rows }, () => new Array(cols).fill(null));
    state.cell = defaultCell(cols);
  }

  /** Pick a starting zoom so the canvas lands near ~512px wide. */
  function defaultCell(cols) {
    return clamp(Math.round(512 / cols), MIN_CELL, MAX_CELL);
  }

  const inBounds = (x, y) => x >= 0 && y >= 0 && x < state.cols && y < state.rows;

  function setCell(x, y, color) {
    if (!inBounds(x, y)) return false;
    if (state.grid[y][x] === color) return false;
    state.grid[y][x] = color;
    return true;
  }

  function isEmpty() {
    return state.grid.every((row) => row.every((c) => c === null));
  }

  // ======================================================
  //  Rendering
  // ======================================================
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = state.cols * state.cell;
    const h = state.rows * state.cell;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  /**
   * @param {Set<string>} [overlay] - cells "x,y" drawn in current color on top
   *                                  of the grid (shape preview), not committed.
   */
  function render(overlay) {
    const c = state.cell;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // committed cells
    for (let y = 0; y < state.rows; y++) {
      for (let x = 0; x < state.cols; x++) {
        const color = state.grid[y][x];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(x * c, y * c, c, c);
        }
      }
    }

    // preview overlay
    if (overlay && overlay.size) {
      ctx.fillStyle = state.color;
      for (const key of overlay) {
        const [x, y] = key.split(",").map(Number);
        ctx.fillRect(x * c, y * c, c, c);
      }
    }

    if (state.showGrid) drawGridLines();
  }

  function drawGridLines() {
    const c = state.cell;
    const w = state.cols * c;
    const h = state.rows * c;
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= state.cols; x++) {
      const px = Math.round(x * c) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
    }
    for (let y = 0; y <= state.rows; y++) {
      const py = Math.round(y * c) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
    }
    ctx.stroke();
  }

  // ======================================================
  //  History
  // ======================================================
  function cloneGrid() {
    return state.grid.map((row) => row.slice());
  }
  function snapshot() {
    state.undo.push(cloneGrid());
    if (state.undo.length > HISTORY_LIMIT) state.undo.shift();
    state.redo.length = 0;
  }
  function undo() {
    if (!state.undo.length) return;
    state.redo.push(cloneGrid());
    state.grid = state.undo.pop();
    render();
  }
  function redo() {
    if (!state.redo.length) return;
    state.undo.push(cloneGrid());
    state.grid = state.redo.pop();
    render();
  }

  // ======================================================
  //  Tools
  // ======================================================
  function paintAt(x, y) {
    const color = state.tool === "eraser" ? null : state.color;
    if (setCell(x, y, color)) render();
  }

  function floodFill(x, y) {
    const target = state.grid[y][x];
    const replacement = state.color;
    if (target === replacement) return;
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (!inBounds(cx, cy) || state.grid[cy][cx] !== target) continue;
      state.grid[cy][cx] = replacement;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    render();
  }

  function eyedrop(x, y) {
    const color = state.grid[y][x];
    if (color) setColor(color);
  }

  // ---- Shape rasterisation ----
  /** Bresenham line into a Set of "x,y" keys. */
  function plotLine(x0, y0, x1, y1, out) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      out.add(x0 + "," + y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  /** Cells forming the outline of `shape` between two drag points. */
  function shapeCells(shape, x0, y0, x1, y1) {
    const out = new Set();

    // Constrain square & circle to equal extent, following the larger drag axis.
    if (shape === "square" || shape === "circle") {
      const size = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      x1 = x0 + Math.sign(x1 - x0 || 1) * size;
      y1 = y0 + Math.sign(y1 - y0 || 1) * size;
    }

    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);

    if (shape === "rectangle" || shape === "square") {
      plotLine(minX, minY, maxX, minY, out);
      plotLine(maxX, minY, maxX, maxY, out);
      plotLine(maxX, maxY, minX, maxY, out);
      plotLine(minX, maxY, minX, minY, out);
      return clip(out);
    }

    // Ellipse / circle / regular polygons share a bounding ellipse.
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const rx = (maxX - minX) / 2, ry = (maxY - minY) / 2;

    if (shape === "circle") {
      sampleEllipse(cx, cy, rx, ry, out);
      return clip(out);
    }

    const sides = { triangle: 3, pentagon: 5, hexagon: 6, heptagon: 7, octagon: 8 }[shape];
    if (sides) {
      const verts = [];
      for (let i = 0; i < sides; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
        verts.push([Math.round(cx + rx * Math.cos(a)), Math.round(cy + ry * Math.sin(a))]);
      }
      for (let i = 0; i < sides; i++) {
        const [ax, ay] = verts[i];
        const [bx, by] = verts[(i + 1) % sides];
        plotLine(ax, ay, bx, by, out);
      }
    }
    return clip(out);
  }

  function sampleEllipse(cx, cy, rx, ry, out) {
    const steps = Math.max(24, Math.ceil(2 * Math.PI * Math.max(rx, ry) * 2));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * 2 * Math.PI;
      out.add(Math.round(cx + rx * Math.cos(a)) + "," + Math.round(cy + ry * Math.sin(a)));
    }
  }

  /** Drop any cells that fall outside the grid. */
  function clip(set) {
    const out = new Set();
    for (const key of set) {
      const [x, y] = key.split(",").map(Number);
      if (inBounds(x, y)) out.add(key);
    }
    return out;
  }

  function commitShape(cells) {
    let changed = false;
    for (const key of cells) {
      const [x, y] = key.split(",").map(Number);
      if (setCell(x, y, state.color)) changed = true;
    }
    return changed;
  }

  // ======================================================
  //  Pointer interaction
  // ======================================================
  function cellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / state.cell);
    const y = Math.floor((e.clientY - rect.top) / state.cell);
    return { x, y };
  }

  function onPointerDown(e) {
    const { x, y } = cellFromEvent(e);
    if (!inBounds(x, y)) return;
    canvas.setPointerCapture(e.pointerId);

    switch (state.tool) {
      case "eyedropper":
        eyedrop(x, y);
        return;
      case "fill":
        snapshot();
        floodFill(x, y);
        pushRecent(state.color);
        return;
      case "shape":
        snapshot();
        state.drawing = true;
        state.shapeStart = { x, y };
        return;
      default: // pencil / eraser
        snapshot();
        state.drawing = true;
        state.strokeOpen = true;
        paintAt(x, y);
        if (state.tool !== "eraser") pushRecent(state.color);
    }
  }

  function onPointerMove(e) {
    const { x, y } = cellFromEvent(e);
    el.statusPos.textContent = inBounds(x, y) ? `${x}, ${y}` : "—";
    if (!state.drawing) return;

    if (state.tool === "shape" && state.shapeStart) {
      const s = state.shapeStart;
      render(shapeCells(state.shape, s.x, s.y, clampX(x), clampY(y)));
    } else if (state.tool === "pencil" || state.tool === "eraser") {
      paintAt(x, y);
    }
  }

  function onPointerUp(e) {
    if (state.tool === "shape" && state.shapeStart) {
      const { x, y } = cellFromEvent(e);
      const s = state.shapeStart;
      const cells = shapeCells(state.shape, s.x, s.y, clampX(x), clampY(y));
      const changed = commitShape(cells);
      if (changed) pushRecent(state.color);
      else state.undo.pop(); // nothing drawn — discard the snapshot
      render();
    }
    state.drawing = false;
    state.shapeStart = null;
    state.strokeOpen = false;
  }

  // ======================================================
  //  Color + swatches
  // ======================================================
  function setColor(hex) {
    state.color = hex.toLowerCase();
    el.colorInput.value = state.color;
    el.colorHex.textContent = state.color.toUpperCase();
    markActiveSwatch();
  }

  function pushRecent(hex) {
    hex = hex.toLowerCase();
    state.recent = [hex, ...state.recent.filter((c) => c !== hex)].slice(0, 8);
    renderRecent();
  }

  function buildSwatch(hex) {
    const b = document.createElement("button");
    b.className = "swatch";
    b.style.background = hex;
    b.title = hex.toUpperCase();
    b.dataset.color = hex;
    b.addEventListener("click", () => setColor(hex));
    return b;
  }

  function renderPalette() {
    el.palette.innerHTML = "";
    PALETTE.forEach((hex) => el.palette.appendChild(buildSwatch(hex)));
    markActiveSwatch();
  }
  function renderRecent() {
    el.recent.innerHTML = "";
    state.recent.forEach((hex) => el.recent.appendChild(buildSwatch(hex)));
    markActiveSwatch();
  }
  function markActiveSwatch() {
    document.querySelectorAll(".swatch").forEach((s) => {
      s.classList.toggle("is-active", s.dataset.color === state.color);
    });
  }

  // ======================================================
  //  Tool / UI selection
  // ======================================================
  const TOOL_LABEL = {
    pencil: "Pencil", eraser: "Eraser", fill: "Fill", eyedropper: "Eyedropper",
  };
  const SHAPE_LABEL = {
    rectangle: "Rectangle", square: "Square", circle: "Circle", triangle: "Triangle",
    pentagon: "Pentagon", hexagon: "Hexagon", heptagon: "Heptagon", octagon: "Octagon",
  };

  function selectToolButton(btn) {
    document.querySelectorAll(".tool-btn").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    state.tool = btn.dataset.tool;
    if (btn.dataset.shape) state.shape = btn.dataset.shape;
    el.statusTool.textContent =
      state.tool === "shape" ? SHAPE_LABEL[state.shape] : TOOL_LABEL[state.tool];
  }

  function selectTool(toolName, shapeName) {
    const sel = shapeName
      ? `.tool-btn[data-shape="${shapeName}"]`
      : `.tool-btn[data-tool="${toolName}"]`;
    const btn = document.querySelector(sel);
    if (btn) selectToolButton(btn);
  }

  function setZoom(cell) {
    state.cell = clamp(cell, MIN_CELL, MAX_CELL);
    el.zoomReadout.textContent = state.cell + "px";
    resizeCanvas();
    render();
  }

  function setSize(n) {
    if (!isEmpty() && !confirm(`Resize to ${n} × ${n}? This clears the canvas.`)) return;
    newGrid(n, n);
    state.undo.length = 0;
    state.redo.length = 0;
    document.querySelectorAll(".size-btn").forEach((b) =>
      b.classList.toggle("is-active", Number(b.dataset.size) === n));
    el.statusSize.textContent = `${n} × ${n}`;
    el.zoomReadout.textContent = state.cell + "px";
    resizeCanvas();
    render();
  }

  function clearCanvas() {
    if (isEmpty()) return;
    if (!confirm("Clear the entire canvas?")) return;
    snapshot();
    state.grid = Array.from({ length: state.rows }, () => new Array(state.cols).fill(null));
    render();
  }

  // ======================================================
  //  Export
  // ======================================================
  function exportPNG() {
    const off = document.createElement("canvas");
    off.width = state.cols;
    off.height = state.rows;
    const octx = off.getContext("2d");
    for (let y = 0; y < state.rows; y++) {
      for (let x = 0; x < state.cols; x++) {
        const color = state.grid[y][x];
        if (color) { octx.fillStyle = color; octx.fillRect(x, y, 1, 1); }
      }
    }
    // Upscale with nearest-neighbour so the PNG is crisp and shareable.
    const scale = Math.max(1, Math.round(640 / state.cols));
    const out = document.createElement("canvas");
    out.width = state.cols * scale;
    out.height = state.rows * scale;
    const c2 = out.getContext("2d");
    c2.imageSmoothingEnabled = false;
    c2.drawImage(off, 0, 0, out.width, out.height);

    const link = document.createElement("a");
    link.download = `pixel-art-${state.cols}x${state.rows}.png`;
    link.href = out.toDataURL("image/png");
    link.click();
  }

  // ======================================================
  //  Helpers
  // ======================================================
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  const clampX = (x) => clamp(x, 0, state.cols - 1);
  const clampY = (y) => clamp(y, 0, state.rows - 1);

  // ======================================================
  //  Wiring
  // ======================================================
  function bind() {
    // Tools
    document.querySelectorAll(".tool-btn").forEach((btn) =>
      btn.addEventListener("click", () => selectToolButton(btn)));

    // Canvas pointer
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerleave", () => { el.statusPos.textContent = "—"; });

    // Color
    el.colorInput.addEventListener("input", (e) => setColor(e.target.value));

    // Header
    $("undo").addEventListener("click", undo);
    $("redo").addEventListener("click", redo);
    $("zoom-in").addEventListener("click", () => setZoom(state.cell + 2));
    $("zoom-out").addEventListener("click", () => setZoom(state.cell - 2));
    $("export").addEventListener("click", exportPNG);
    $("toggle-grid").addEventListener("click", (e) => {
      state.showGrid = !state.showGrid;
      e.currentTarget.setAttribute("aria-pressed", String(state.showGrid));
      render();
    });

    // Inspector
    document.querySelectorAll(".size-btn").forEach((btn) =>
      btn.addEventListener("click", () => setSize(Number(btn.dataset.size))));
    $("clear").addEventListener("click", clearCanvas);

    // Keyboard
    window.addEventListener("keydown", onKey);
  }

  function onKey(e) {
    if (e.target.matches("input")) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if (ctrl && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
    switch (e.key.toLowerCase()) {
      case "b": selectTool("pencil"); break;
      case "e": selectTool("eraser"); break;
      case "g": selectTool("fill"); break;
      case "i": selectTool("eyedropper"); break;
      case "]": setZoom(state.cell + 2); break;
      case "[": setZoom(state.cell - 2); break;
    }
  }

  // ======================================================
  //  Init
  // ======================================================
  function init() {
    newGrid(state.cols, state.rows);
    renderPalette();
    renderRecent();
    setColor(state.color);
    el.statusSize.textContent = `${state.cols} × ${state.rows}`;
    el.zoomReadout.textContent = state.cell + "px";
    resizeCanvas();
    render();
    bind();
  }

  init();
})();
