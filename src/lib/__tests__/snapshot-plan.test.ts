import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  assertSnapshotCount,
  assertSnapshotFile,
  expectedDayCount,
  planSnapshots,
  SNAPSHOTS_PER_DAY,
} from "../snapshot-plan";

// Real July 2026 window: 2026-07-01T00:00:00Z .. 2026-07-31T23:59:59Z
const JUL_START_TS = 1782864000;
const JUL_END_TS = 1785542399;

// The block span actually returned by the HyperSync binary search for R2's
// July run, which is ~1 day wider than 31 * 43200 and produced a phantom day 32.
const R2_START_BLOCK = 48037326;
const R2_END_BLOCK = 49376526;

describe("expectedDayCount", () => {
  it("counts calendar days in the window, not block span", () => {
    expect(expectedDayCount(JUL_START_TS, JUL_END_TS)).toBe(31);
  });

  it("handles a 30-day month", () => {
    // 2026-06-01T00:00:00Z .. 2026-06-30T23:59:59Z
    expect(expectedDayCount(1780272000, 1782863999)).toBe(30);
  });

  it("handles a 28-day month", () => {
    // 2026-02-01T00:00:00Z .. 2026-02-28T23:59:59Z
    expect(expectedDayCount(1769904000, 1772323199)).toBe(28);
  });
});

describe("planSnapshots", () => {
  it("emits exactly SNAPSHOTS_PER_DAY per calendar day even when the block span overshoots", () => {
    const snaps = planSnapshots(
      R2_START_BLOCK,
      R2_END_BLOCK,
      JUL_START_TS,
      JUL_END_TS,
    );
    expect(snaps).toHaveLength(31 * SNAPSHOTS_PER_DAY);
  });

  it("never emits a day beyond the calendar day count", () => {
    const snaps = planSnapshots(
      R2_START_BLOCK,
      R2_END_BLOCK,
      JUL_START_TS,
      JUL_END_TS,
    );
    const days = [...new Set(snaps.map((s) => s.day))].sort((a, b) => a - b);
    expect(days).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
  });

  it("gives every day exactly SNAPSHOTS_PER_DAY samples", () => {
    const snaps = planSnapshots(
      R2_START_BLOCK,
      R2_END_BLOCK,
      JUL_START_TS,
      JUL_END_TS,
    );
    const counts = new Map<number, number>();
    for (const s of snaps) counts.set(s.day, (counts.get(s.day) ?? 0) + 1);
    for (const [, c] of counts) expect(c).toBe(SNAPSHOTS_PER_DAY);
  });

  it("keeps every sampled block inside [startBlock, endBlock]", () => {
    const snaps = planSnapshots(
      R2_START_BLOCK,
      R2_END_BLOCK,
      JUL_START_TS,
      JUL_END_TS,
    );
    for (const s of snaps) {
      expect(s.blockNumber).toBeGreaterThanOrEqual(R2_START_BLOCK);
      expect(s.blockNumber).toBeLessThanOrEqual(R2_END_BLOCK);
    }
  });

  it("never samples the same block twice within a day", () => {
    // Repeat: the sampling is random, so run it enough to catch a flaky collision.
    for (let run = 0; run < 20; run++) {
      const snaps = planSnapshots(
        R2_START_BLOCK,
        R2_END_BLOCK,
        JUL_START_TS,
        JUL_END_TS,
      );
      const byDay = new Map<number, number[]>();
      for (const s of snaps) {
        byDay.set(s.day, [...(byDay.get(s.day) ?? []), s.blockNumber]);
      }
      for (const [day, blocks] of byDay) {
        expect(new Set(blocks).size, `day ${day} had duplicate blocks`).toBe(
          blocks.length,
        );
      }
    }
  });

  it("produces the same day count regardless of block-span slop", () => {
    // Same calendar window, three different search results for the boundaries.
    const spans: Array<[number, number]> = [
      [48037326, 49376526], // overshoots 31 * 43200
      [48059252, 49373735], // undershoots
      [48000000, 49339200], // exactly 31 * 43200
    ];
    for (const [a, b] of spans) {
      const snaps = planSnapshots(a, b, JUL_START_TS, JUL_END_TS);
      expect(snaps).toHaveLength(31 * SNAPSHOTS_PER_DAY);
      expect(Math.max(...snaps.map((s) => s.day))).toBe(31);
    }
  });

  it("covers the window: day 1 starts at startBlock, last day ends at endBlock", () => {
    const snaps = planSnapshots(
      R2_START_BLOCK,
      R2_END_BLOCK,
      JUL_START_TS,
      JUL_END_TS,
    );
    const day1 = snaps.filter((s) => s.day === 1).map((s) => s.blockNumber);
    const last = snaps.filter((s) => s.day === 31).map((s) => s.blockNumber);
    const dayWidth = (R2_END_BLOCK - R2_START_BLOCK + 1) / 31;
    for (const b of day1) {
      expect(b).toBeLessThan(R2_START_BLOCK + Math.ceil(dayWidth));
    }
    for (const b of last) {
      expect(b).toBeGreaterThan(R2_END_BLOCK - Math.ceil(dayWidth));
    }
  });

  it("throws when the block range is too small to sample", () => {
    expect(() => planSnapshots(100, 100, JUL_START_TS, JUL_END_TS)).toThrow(
      /block range/i,
    );
  });
});

describe("assertSnapshotCount", () => {
  const ok = () => planSnapshots(48037326, 49376526, JUL_START_TS, JUL_END_TS);

  it("accepts a well-formed plan for the window", () => {
    expect(() =>
      assertSnapshotCount(ok(), JUL_START_TS, JUL_END_TS),
    ).not.toThrow();
  });

  it("rejects a plan with too few snapshots", () => {
    const snaps = ok().slice(0, -1);
    expect(() => assertSnapshotCount(snaps, JUL_START_TS, JUL_END_TS)).toThrow(
      /snapshot count 61 != expected 62/,
    );
  });

  it("rejects the real June-2026 style overshoot (64 samples, a day 32)", () => {
    const snaps = [
      ...ok(),
      { blockNumber: 49376526, day: 32 },
      { blockNumber: 49376526, day: 32 },
    ];
    expect(() => assertSnapshotCount(snaps, JUL_START_TS, JUL_END_TS)).toThrow(
      /snapshot count 64 != expected 62/,
    );
  });

  it("rejects a day sampled only once", () => {
    const snaps = ok();
    const i = snaps.findIndex((s) => s.day === 7);
    snaps.splice(i, 1);
    snaps.push({ blockNumber: 49000000, timestamp: 0, day: 9 });
    expect(() => assertSnapshotCount(snaps, JUL_START_TS, JUL_END_TS)).toThrow(
      /day 7 has 1 snapshot/,
    );
  });

  it("rejects the same block sampled twice within a day", () => {
    const snaps = ok();
    const day5 = snaps.filter((s) => s.day === 5);
    day5[1].blockNumber = day5[0].blockNumber;
    expect(() => assertSnapshotCount(snaps, JUL_START_TS, JUL_END_TS)).toThrow(
      /day 5 sampled the same block more than once/,
    );
  });
});

describe("assertSnapshotFile", () => {
  const tmp = () =>
    fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-plan-"));

  const write = (dir: string, data: unknown) => {
    const p = path.join(dir, "snapshot.json");
    fs.writeFileSync(p, JSON.stringify(data));
    return p;
  };

  it("passes a snapshot file whose count matches its own window", () => {
    const dir = tmp();
    const p = write(dir, {
      startTimestamp: JUL_START_TS,
      endTimestamp: JUL_END_TS,
      snapshots: planSnapshots(48037326, 49376526, JUL_START_TS, JUL_END_TS),
    });
    expect(() => assertSnapshotFile(p)).not.toThrow();
  });

  it("rejects the real 64-sample overshoot seen in June/July 2026", () => {
    const dir = tmp();
    const p = write(dir, {
      startTimestamp: JUL_START_TS,
      endTimestamp: JUL_END_TS,
      snapshots: [
        ...planSnapshots(48037326, 49376526, JUL_START_TS, JUL_END_TS),
        { blockNumber: 49376526, timestamp: 0, day: 32 },
        { blockNumber: 49376526, timestamp: 0, day: 32 },
      ],
    });
    expect(() => assertSnapshotFile(p)).toThrow(/64 != expected 62/);
  });

  it("is a no-op when the snapshot file does not exist", () => {
    expect(() =>
      assertSnapshotFile(path.join(tmp(), "absent.json")),
    ).not.toThrow();
  });
});
