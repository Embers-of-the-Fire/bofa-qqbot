const ED25519_PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04,
  0x22, 0x04, 0x20,
]);

const SEED_SIZE = 32;

export interface BotKeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

let cached: { secret: string; keys: Promise<BotKeyPair> } | undefined;

export function getBotKeys(secret: string): Promise<BotKeyPair> {
  if (!cached || cached.secret !== secret) {
    cached = { secret, keys: deriveKeys(secret) };
  }
  return cached.keys;
}

async function deriveKeys(secret: string): Promise<BotKeyPair> {
  let seed = secret;
  while (seed.length < SEED_SIZE) {
    seed = seed.repeat(2);
  }
  const seedBytes = new TextEncoder().encode(seed.slice(0, SEED_SIZE));

  const pkcs8 = new Uint8Array(ED25519_PKCS8_PREFIX.length + SEED_SIZE);
  pkcs8.set(ED25519_PKCS8_PREFIX, 0);
  pkcs8.set(seedBytes, ED25519_PKCS8_PREFIX.length);

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    "Ed25519",
    true,
    ["sign"],
  );

  const jwk = (await crypto.subtle.exportKey("jwk", privateKey)) as JsonWebKey;
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "OKP", crv: "Ed25519", x: jwk.x },
    "Ed25519",
    false,
    ["verify"],
  );

  return { privateKey, publicKey };
}

export function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let hex = "";
  for (const b of view) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}
