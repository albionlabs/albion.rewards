// Build a synthetic 256-leaf claims tree, splice its root into a real claims
// order's bytecode, and emit everything the forge test needs.
const fs = require("fs");
const path = require("path");
const { keccak256, concat, toBeHex, getAddress, randomBytes } = require("ethers");
const { SimpleMerkleTree } = require("@openzeppelin/merkle-tree");
const flt = require("@rainlanguage/float");

const testdata = path.join(__dirname, "..", "testdata");

const w = (x) => toBeHex(BigInt(x), 32);
function floatWord(intValue) {
  const r = flt.Float.fromFixedDecimalLossy(BigInt(intValue), 0);
  const e = r.value ?? r.float;
  return e.asHex();
}

// Fixed anvil accounts.
const TAKER = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"); // claimant = order-counterparty
const OWNER = getAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"); // order owner / depositor

// Claim words. Float(index=0), Float(amount=100).
const indexWord = floatWord(0);
const amountWord = floatWord(100);

// leaf = keccak256( indexWord || counterparty(32) || amountWord ) — exactly what
// claims.rain computes: hash(signed-context<0 0>, order-counterparty(), signed-context<0 1>)
const counterparty32 = w(BigInt(TAKER));
const leaf0 = keccak256(concat([indexWord, counterparty32, amountWord]));

// 256 leaves → depth-8 proof, matching production and claims.rain's 8 proof slots.
const leaves = [leaf0];
for (let i = 1; i < 256; i++) leaves.push(keccak256(randomBytes(32)));
const tree = SimpleMerkleTree.of(leaves);
const root = tree.root;
let idx = -1;
for (const [i, v] of tree.entries()) if (v === leaf0) {
  idx = i;
  break;
}
const proof = tree.getProof(idx);
if (proof.length !== 8) throw new Error("proof depth " + proof.length + " != 8");

// Real claims order 0x41e3ca1f… on 0xb05D (merkle-words = 0x22d83c…, root 0x4fe663…73d5).
const ORDER_BYTES =
  "0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000a51fd23d6e2442805130eac0712f590691e9151700000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000034000000000000000000000000000000000000000000000000000000000000003a0d571f80bfa3d1965e3e8a4d68029af8a25984b6dd99fae13f295e43db7353fe80000000000000000000000003bf9bd9da4784f75c92317e61c68493ecc9aabdc0000000000000000000000001aa775533e28b1d843e1a589034984e3a62005dc0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000021f000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000457870656374656420636c61696dee000000000000000000000000000000000000000000000000636c61696d6564e70000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000436c61696d6564e74fe663800243f4ea4269334d7fbe93aa90ba3567415ee15d4c03706b000f73d5000000000000000000000000000000000000000000000000000050726f6f66e500000000000000000000000022d83c031bc02737ad3eaf5aa3386de2bf7f7fbc00000000000000000000000000000000000000000000000000000000000000df0500000024005c0070009808040004031001060b100002001000010b010003001000010b01000400100000011000000d060002031001060b1000020110000100100000031004041f1200001e020000011000030110000200100001031000010c13000047020000040300010310010603100201031000060c1300000906010101100004011000000110000200100000031000010c130000461100001f1200001e0200000e0b010203100906031008060310070603100606031005060310040603100306031002060010000001100005021a000701100006001000011e0200000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000004200000000000000000000000000000000000006ee2965a442614e0128469b0e7174c5ef7136bf1419fdf6d620996c6307d6b8ae0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913ee2965a442614e0128469b0e7174c5ef7136bf1419fdf6d620996c6307d6b8ae";

const OLD_ROOT = "4fe663800243f4ea4269334d7fbe93aa90ba3567415ee15d4c03706b000f73d5";
const occ = ORDER_BYTES.toLowerCase().split(OLD_ROOT).length - 1;
if (occ !== 1) throw new Error("expected committed root once in bytecode, found " + occ);
const spliced = ORDER_BYTES.toLowerCase().replace(OLD_ROOT, root.slice(2).toLowerCase());

fs.mkdirSync(testdata, { recursive: true });
fs.writeFileSync(path.join(testdata, "order.hex"), spliced);
const out = {
  taker: TAKER,
  owner: OWNER,
  root,
  leaf: leaf0,
  indexWord,
  amountWord,
  proof,
  depositWord: floatWord(1000),
  maxIOWord: floatWord(1000000),
  usdc: getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
};
fs.writeFileSync(path.join(testdata, "data.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
console.log("wrote", testdata);
