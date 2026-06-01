import { describe, expect, it } from "bun:test";
import { computeGrid } from "../../src/backends/native-mac/grid.ts";

/**
 * The grid math test is deliberately deterministic (no Terminal.app spawn). It proves
 * the brief's "grid math from screen, never hardcoded" requirement by computing layouts
 * for two real-world display resolutions and asserting the cell positions differ.
 *
 * The legacy v12.1 swarm-shell.zsh shipped with SWARM_WIN_W=411, SWARM_COLS=5 hardcoded
 * for a specific 16" MBP. apicultr derives both numbers from the actual display.
 */

describe("native-mac grid math (screen-derived)", () => {
  it("16-inch MBP layout differs from 13-inch MBA layout", () => {
    const personas = 12;
    const cellSize = [480, 320] as const;
    const mbp16 = computeGrid(personas, { x: 0, y: 25, width: 2400, height: 1450 }, cellSize);
    const mba13 = computeGrid(personas, { x: 0, y: 25, width: 1440, height: 900 }, cellSize);

    expect(mbp16.cols).toBe(5);
    expect(mba13.cols).toBe(3);

    // Different displays produce different x-positions for the same persona index.
    expect(mbp16.cells[0]?.x).toBe(mba13.cells[0]?.x);
    expect(mbp16.cells[5]?.x).not.toBe(mba13.cells[5]?.x);
  });

  it("a Pro Display XDR fits a hive that crushes a MacBook screen", () => {
    const xdr = computeGrid(30, { x: 0, y: 25, width: 6016, height: 3360 }, [480, 320]);
    const mbp = computeGrid(30, { x: 0, y: 25, width: 2400, height: 1450 }, [480, 320]);
    expect(xdr.overflow).toBe(false);
    expect(mbp.overflow).toBe(true);
  });
});
