import { describe, it, expect } from "vitest";
import { buildClaimLeaf, buildClaimLeaves } from "../leaf";

describe("buildClaimLeaf", () => {
  it("matches Rain Float leaf encoding (index Float + address bytes32 + amount Float)", () => {
    const leaf = buildClaimLeaf(
      5n,
      "0x8f6bF4A948Af2Fc74eE34982C4435a7C013D1A52",
      "4924897972993079296",
    );
    expect(leaf).toBe(
      "0x2b76fb4e1b93ccba9dd70c9f0127a4ddd2576e89b709759b653f19ee592236e7",
    );
  });

  it("is deterministic", () => {
    const a = buildClaimLeaf(
      1n,
      "0x0000000000000000000000000000000000000001",
      7n,
    );
    const b = buildClaimLeaf(
      1n,
      "0x0000000000000000000000000000000000000001",
      7n,
    );
    expect(a).toBe(b);
  });
});

describe("buildClaimLeaves", () => {
  it("maps parsed rows to leaves in order", () => {
    const rows: Array<[string, string, string]> = [
      [
        "0",
        "0x0000000000000000000000000000000000000001",
        "1000000000000000000",
      ],
      ["1", "0x0000000000000000000000000000000000000000", "0"],
    ];
    const leaves = buildClaimLeaves(rows);
    expect(leaves).toHaveLength(2);
    expect(leaves[0]).toBe(buildClaimLeaf(rows[0][0], rows[0][1], rows[0][2]));
    expect(leaves[1]).toBe(buildClaimLeaf(rows[1][0], rows[1][1], rows[1][2]));
  });
});
