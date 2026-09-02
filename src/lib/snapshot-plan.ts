/**
 * Snapshot sampling plan.
 *
 * The number of days sampled is derived from the CALENDAR window, never from
 * the block span. The block boundaries come from an approximate binary search
 * whose result depends on the live chain head, so the span for a given month
 * varies run to run; deriving the day count from it produced spurious extra
 * day buckets (e.g. a "day 32" in a 31-day month) whose degenerate block range
 * collapsed both samples onto the same block.
 */

import * as fs from "node:fs";

const SECONDS_PER_DAY = 86400;

/** Blocks sampled per day. Their mean is the day's balance contribution. */
export const SNAPSHOTS_PER_DAY = 2;

export interface SnapshotEntry {
  blockNumber: number;
  timestamp: number;
  day: number;
}

/** Number of calendar days covered by an inclusive timestamp window. */
export function expectedDayCount(
  startTimestamp: number,
  endTimestamp: number,
): number {
  return Math.round((endTimestamp - startTimestamp + 1) / SECONDS_PER_DAY);
}

/** Pick `count` distinct blocks uniformly from an inclusive block range. */
function sampleDistinct(from: number, to: number, count: number): number[] {
  const width = to - from + 1;
  if (width < count) {
    throw new Error(
      `block range ${from}..${to} holds ${width} block(s), need ${count} distinct samples`,
    );
  }
  const picked = new Set<number>();
  while (picked.size < count) {
    picked.add(from + Math.floor(Math.random() * width));
  }
  return [...picked];
}

/**
 * Spread the block span evenly across the window's calendar days and take
 * SNAPSHOTS_PER_DAY distinct blocks from each day.
 */
export function planSnapshots(
  startBlock: number,
  endBlock: number,
  startTimestamp: number,
  endTimestamp: number,
): SnapshotEntry[] {
  const days = expectedDayCount(startTimestamp, endTimestamp);
  if (days < 1) {
    throw new Error(
      `window ${startTimestamp}..${endTimestamp} covers no whole day`,
    );
  }

  const totalBlocks = endBlock - startBlock + 1;
  const needed = days * SNAPSHOTS_PER_DAY;
  if (totalBlocks < needed) {
    throw new Error(
      `block range ${startBlock}..${endBlock} holds ${totalBlocks} block(s), ` +
        `need at least ${needed} for ${days} day(s) x ${SNAPSHOTS_PER_DAY}`,
    );
  }

  const snapshots: SnapshotEntry[] = [];
  for (let day = 0; day < days; day++) {
    const dayStart = startBlock + Math.round((day * totalBlocks) / days);
    const dayEnd =
      day === days - 1
        ? endBlock
        : startBlock + Math.round(((day + 1) * totalBlocks) / days) - 1;

    for (const blockNumber of sampleDistinct(
      dayStart,
      dayEnd,
      SNAPSHOTS_PER_DAY,
    )) {
      snapshots.push({ blockNumber, timestamp: 0, day: day + 1 });
    }
  }
  return snapshots;
}

/**
 * Guard against a malformed snapshot file reaching a deploy: the sample count
 * must match the calendar window exactly, every day must be sampled
 * SNAPSHOTS_PER_DAY times, and no day may sample one block twice.
 */
export function assertSnapshotCount(
  snapshots: Array<{ blockNumber: number; day: number }>,
  startTimestamp: number,
  endTimestamp: number,
): void {
  const days = expectedDayCount(startTimestamp, endTimestamp);
  const expected = days * SNAPSHOTS_PER_DAY;
  if (snapshots.length !== expected) {
    throw new Error(
      `snapshot count ${snapshots.length} != expected ${expected} ` +
        `(${days} day(s) x ${SNAPSHOTS_PER_DAY})`,
    );
  }

  const blocksByDay = new Map<number, number[]>();
  for (const s of snapshots) {
    blocksByDay.set(s.day, [...(blocksByDay.get(s.day) ?? []), s.blockNumber]);
  }

  for (const day of blocksByDay.keys()) {
    if (day < 1 || day > days) {
      throw new Error(`snapshot day ${day} is outside 1..${days}`);
    }
  }

  for (let day = 1; day <= days; day++) {
    const blocks = blocksByDay.get(day) ?? [];
    if (blocks.length !== SNAPSHOTS_PER_DAY) {
      throw new Error(
        `day ${day} has ${blocks.length} snapshot(s), expected ${SNAPSHOTS_PER_DAY}`,
      );
    }
    if (new Set(blocks).size !== blocks.length) {
      throw new Error(`day ${day} sampled the same block more than once`);
    }
  }
}

/**
 * Validate a written snapshot.json against the window it declares. A missing
 * file is not an error: not every historical month has one on disk.
 */
export function assertSnapshotFile(snapshotPath: string): void {
  if (!fs.existsSync(snapshotPath)) return;

  const data = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const { startTimestamp, endTimestamp, snapshots } = data;
  if (
    typeof startTimestamp !== "number" ||
    typeof endTimestamp !== "number" ||
    !Array.isArray(snapshots)
  ) {
    throw new Error(`${snapshotPath} is not a valid snapshot file`);
  }

  try {
    assertSnapshotCount(snapshots, startTimestamp, endTimestamp);
  } catch (e) {
    throw new Error(`${snapshotPath}: ${(e as Error).message}`);
  }
}
