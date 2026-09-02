import { describe, it, expect } from "vitest";
import {
  resolveOutputDir,
  validateCsvTotal,
  findPendingPayoutEntry,
  buildMerkleLeaves,
} from "../validation";
import { buildClaimLeaves } from "../leaf";

describe("resolveOutputDir", () => {
  it("converts --month 2026-03 to date range", () => {
    const result = resolveOutputDir("2026-03");
    expect(result).toBe("2026-03-01_to_2026-03-31");
  });

  it("handles February non-leap year", () => {
    const result = resolveOutputDir("2026-02");
    expect(result).toBe("2026-02-01_to_2026-02-28");
  });

  it("handles February leap year", () => {
    const result = resolveOutputDir("2028-02");
    expect(result).toBe("2028-02-01_to_2028-02-29");
  });

  it("handles December", () => {
    const result = resolveOutputDir("2026-12");
    expect(result).toBe("2026-12-01_to_2026-12-31");
  });
});

describe("validateCsvTotal", () => {
  it("returns true when CLI amount matches CSV total (18 decimal CSV)", () => {
    const csvAmountsWei = [500000000000000000000n, 228450000000000000000n];
    expect(validateCsvTotal(728.45, csvAmountsWei)).toBe(true);
  });

  it("returns true when the deposit is rounded up over the CSV total", () => {
    // Real July 2026 R1 case: the CSV carries sub-picoUSDC rounding dust above
    // the clean totalPayout, so the deposit is bumped to the next microUSDC.
    const csvAmountsWei = [743300000000000635674n];
    expect(validateCsvTotal(743.300001, csvAmountsWei)).toBe(true);
  });

  it("returns false when the deposit is below the CSV total", () => {
    // Same case without the roundup: 743.30 does not cover the dust.
    const csvAmountsWei = [743300000000000635674n];
    expect(validateCsvTotal(743.3, csvAmountsWei)).toBe(false);
  });

  it("returns false when the deposit is far below the CSV total", () => {
    const csvAmountsWei = [500000000000000000000n];
    expect(validateCsvTotal(12.34, csvAmountsWei)).toBe(false);
  });
});

describe("buildMerkleLeaves", () => {
  it("matches the shared leaf encoder", () => {
    const rows: Array<[string, string, string]> = [
      [
        "0",
        "0x0000000000000000000000000000000000000001",
        "1000000000000000000",
      ],
      ["1", "0x0000000000000000000000000000000000000000", "0"],
    ];
    expect(buildMerkleLeaves(rows)).toEqual(buildClaimLeaves(rows));
  });
});

describe("findPendingPayoutEntry", () => {
  it("finds entry with empty date/txHash/orderHash", () => {
    const metadata = {
      payoutData: [
        {
          tokenPayout: {
            date: "2025-09-17",
            txHash: "0xabc",
            orderHash: "0xdef",
          },
        },
        {
          tokenPayout: {
            date: "",
            txHash: "",
            orderHash: "",
            totalPayout: 100,
          },
        },
      ],
    };
    const entry = findPendingPayoutEntry(metadata);
    expect(entry).toBeDefined();
    expect(entry!.tokenPayout.totalPayout).toBe(100);
  });

  it("returns null when no pending entry", () => {
    const metadata = {
      payoutData: [
        {
          tokenPayout: {
            date: "2025-09-17",
            txHash: "0xabc",
            orderHash: "0xdef",
          },
        },
      ],
    };
    expect(findPendingPayoutEntry(metadata)).toBeNull();
  });
});
