const enc = new TextEncoder();
const dec = new TextDecoder();

export const toHex = (buf: ArrayBuffer | Uint8Array) =>
  [...(buf instanceof Uint8Array ? buf : new Uint8Array(buf))].map((b) => b.toString(16).padStart(2, '0')).join('');

export const fromHex = (hex: string) => new Uint8Array(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));

export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  return toHex(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

export const shortHash = (h: string, n = 6) => (h ? `${h.slice(0, n)}…${h.slice(-4)}` : '—');

/**
 * The demo's stand-in for a chip vendor's attestation root. In a real TEE the
 * signing key is fused into the hardware; here the browser plays that role.
 */
export interface VendorRoot {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  fingerprint: string;
}

let vendorRoot: Promise<VendorRoot> | null = null;
export function getVendorRoot(): Promise<VendorRoot> {
  if (!vendorRoot) {
    vendorRoot = (async () => {
      const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
      const raw = await crypto.subtle.exportKey('raw', kp.publicKey);
      return { privateKey: kp.privateKey, publicKey: kp.publicKey, fingerprint: await sha256Hex(raw) };
    })();
  }
  return vendorRoot;
}

export async function verifySignature(publicKey: CryptoKey, message: string, sigHex: string) {
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, fromHex(sigHex), enc.encode(message));
}

export async function newEcdhPair() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
  const raw = await crypto.subtle.exportKey('raw', kp.publicKey);
  return { kp, pubHex: toHex(raw) };
}

export async function deriveAesKey(privateKey: CryptoKey, peerPubHex: string) {
  const peer = await crypto.subtle.importKey('raw', fromHex(peerPubHex), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return crypto.subtle.deriveKey({ name: 'ECDH', public: peer }, privateKey, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function aesEncrypt(key: CryptoKey, text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return { iv, ciphertext: ct };
}

export async function aesDecrypt(key: CryptoKey, iv: Uint8Array, ciphertext: ArrayBuffer) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ciphertext);
  return dec.decode(pt);
}

export const randomHex = (bytes = 16) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));
