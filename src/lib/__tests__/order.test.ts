import { describe, it, expect } from 'vitest';
import { applyOrderbookOverride } from '../order';

const STANDIN = '0xe522cB4a5fCb2eb31a52Ff41a4653d85A4fd7C9D';
const V6 = '0xb05D73E6BCc26AEB5b67Ff68C6E9C6151073e3cE';

// Mirrors the relevant shape of the pinned rain.strategies settings.yaml:
// the base orderbook address appears exactly once, and other networks carry
// their own (different) orderbook addresses that must not be touched.
const SAMPLE = `orderbooks:
  base:
    address: ${STANDIN}
    network: base
    subgraph: base
    deployment-block: 41747644
  polygon:
    address: 0x8a3C8E610d827093F7437E0C45EFa648563c0dDA
    network: polygon
`;

describe('applyOrderbookOverride', () => {
  it('rewrites the base orderbook address to the target', () => {
    const out = applyOrderbookOverride(SAMPLE, STANDIN, V6);
    expect(out).toContain(`address: ${V6}`);
    expect(out).not.toContain(STANDIN);
  });

  it('leaves other networks\' orderbook addresses untouched', () => {
    const out = applyOrderbookOverride(SAMPLE, STANDIN, V6);
    expect(out).toContain('0x8a3C8E610d827093F7437E0C45EFa648563c0dDA');
  });

  it('returns the YAML byte-for-byte when target equals stand-in (default no-op)', () => {
    expect(applyOrderbookOverride(SAMPLE, STANDIN, STANDIN)).toBe(SAMPLE);
  });

  it('treats the equality check case-insensitively', () => {
    expect(applyOrderbookOverride(SAMPLE, STANDIN, STANDIN.toLowerCase())).toBe(SAMPLE);
  });

  it('throws if the stand-in address is absent (settings shape changed)', () => {
    const altered = SAMPLE.replace(STANDIN, '0x0000000000000000000000000000000000000000');
    expect(() => applyOrderbookOverride(altered, STANDIN, V6)).toThrow(/exactly one/);
  });

  it('throws if the stand-in address appears more than once (ambiguous)', () => {
    const dup = `${SAMPLE}metaboards:\n  base: ${STANDIN}\n`;
    expect(() => applyOrderbookOverride(dup, STANDIN, V6)).toThrow(/found 2/);
  });
});
