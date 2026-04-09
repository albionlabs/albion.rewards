declare module 'cbor-web' {
  export function encodeCanonical(value: unknown): Uint8Array;
  export function decodeAllSync(input: Uint8Array | Buffer): unknown[];
  export default {
    encodeCanonical,
    decodeAllSync,
  };
}
