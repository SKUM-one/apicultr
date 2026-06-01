import { describe, expect, it } from "bun:test";
import { computeGrid, parseDisplayBounds } from "../../src/backends/native-mac/grid.ts";

describe("computeGrid", () => {
  it("computes a sensible 5x3 grid on a 16-inch MBP at 480x320 cells", () => {
    const display = { x: 0, y: 25, width: 2400, height: 1450 };
    const layout = computeGrid(15, display, [480, 320]);
    expect(layout.cols).toBe(5);
    expect(layout.rows).toBe(4);
    expect(layout.overflow).toBe(false);
    expect(layout.cells).toHaveLength(15);
    expect(layout.cells[0]).toMatchObject({ col: 0, row: 0, x: 0, y: 25 });
    expect(layout.cells[5]).toMatchObject({ col: 0, row: 1, x: 0, y: 25 + 320 });
  });

  it("computes a denser grid on a 6K display", () => {
    const display = { x: 0, y: 25, width: 6016, height: 3360 };
    const layout = computeGrid(30, display, [480, 320]);
    expect(layout.cols).toBe(12);
    expect(layout.rows).toBe(10);
    expect(layout.overflow).toBe(false);
  });

  it("on a 13-inch display fits fewer cells", () => {
    const display = { x: 0, y: 25, width: 1440, height: 900 };
    const layout = computeGrid(6, display, [480, 320]);
    expect(layout.cols).toBe(3);
    expect(layout.rows).toBe(2);
  });

  it("wraps when count exceeds capacity", () => {
    const display = { x: 0, y: 0, width: 480, height: 320 };
    const layout = computeGrid(3, display, [480, 320]);
    expect(layout.cols).toBe(1);
    expect(layout.rows).toBe(1);
    expect(layout.overflow).toBe(true);
    // All three cells map back to (0,0)
    expect(layout.cells.every((c) => c.col === 0 && c.row === 0)).toBe(true);
  });

  it("never returns less than 1x1", () => {
    const display = { x: 0, y: 0, width: 100, height: 100 };
    const layout = computeGrid(1, display, [480, 320]);
    expect(layout.cols).toBe(1);
    expect(layout.rows).toBe(1);
  });

  it("identical configs on different displays produce different bounds (proves screen-derived)", () => {
    const a = computeGrid(4, { x: 0, y: 0, width: 1440, height: 900 }, [480, 320]);
    const b = computeGrid(4, { x: 0, y: 0, width: 6016, height: 3360 }, [480, 320]);
    expect(a.cols).not.toBe(b.cols);
  });
});

describe("parseDisplayBounds", () => {
  it("parses query-display output", () => {
    expect(parseDisplayBounds("0 25 2400 1450")).toEqual({
      x: 0,
      y: 25,
      width: 2400,
      height: 1450,
    });
  });
  it("returns undefined for malformed input", () => {
    expect(parseDisplayBounds("garbage")).toBeUndefined();
    expect(parseDisplayBounds("0 25 -1 100")).toBeUndefined();
    expect(parseDisplayBounds("")).toBeUndefined();
  });
});
