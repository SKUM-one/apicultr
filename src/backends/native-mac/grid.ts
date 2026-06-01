/**
 * Pure grid-layout maths for the native-Mac backend.
 *
 * Input: usable display bounds (after menu bar) and the configured per-window target size.
 * Output: a list of (x, y, w, h) tuples, top-to-bottom, left-to-right.
 *
 * Critical: never hardcode dimensions. The legacy v12.1 swarm-shell.zsh shipped with
 * `SWARM_WIN_W=411, SWARM_COLS=5` baked in, which broke on any display that wasn't the
 * original 16" MBP. apicultr always derives layout from the actual display at start time.
 */

export interface DisplayBounds {
  /** Top-left X of usable area (px). */
  x: number;
  /** Top-left Y of usable area (px). */
  y: number;
  /** Usable width (px). */
  width: number;
  /** Usable height (px). */
  height: number;
}

export interface GridCellPlacement {
  /** 0-based grid column (left=0). */
  col: number;
  /** 0-based grid row (top=0). */
  row: number;
  /** Pixel X of the window's top-left corner. */
  x: number;
  /** Pixel Y of the window's top-left corner. */
  y: number;
  /** Pixel width of the window. */
  width: number;
  /** Pixel height of the window. */
  height: number;
}

export interface GridLayout {
  cols: number;
  rows: number;
  cells: GridCellPlacement[];
  /** True if the grid is wider/taller than the display can fit; cells overlap. */
  overflow: boolean;
}

/**
 * Lay out N personas into a grid sized to fit `targetWindowSize` per cell within the
 * provided display bounds. If N exceeds capacity, overflow is true and excess cells wrap
 * back to row 0 (last-row policy: persona-007 will overlap persona-001).
 */
export function computeGrid(
  count: number,
  display: DisplayBounds,
  targetWindowSize: readonly [number, number],
): GridLayout {
  const [tw, th] = targetWindowSize;
  const cols = Math.max(1, Math.floor(display.width / tw));
  const rows = Math.max(1, Math.floor(display.height / th));
  const capacity = cols * rows;
  const overflow = count > capacity;

  const cells: GridCellPlacement[] = [];
  for (let i = 0; i < count; i++) {
    const wrap = overflow ? i % capacity : i;
    const row = Math.floor(wrap / cols);
    const col = wrap % cols;
    cells.push({
      col,
      row,
      x: display.x + col * tw,
      y: display.y + row * th,
      width: tw,
      height: th,
    });
  }
  return { cols, rows, cells, overflow };
}

/** Parse `query-display.applescript` stdout: "x y w h". */
export function parseDisplayBounds(stdout: string): DisplayBounds | undefined {
  const parts = stdout
    .trim()
    .split(/\s+/)
    .map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return undefined;
  const [x, y, width, height] = parts as [number, number, number, number];
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}
