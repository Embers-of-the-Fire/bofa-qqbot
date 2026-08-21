import { describe, expect, it } from "vitest";
import { bytesToHex, getBotKeys, hexToBytes } from "./ed25519";

const encoder = new TextEncoder();

function base64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

describe("sign.html demo: https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/sign.html", () => {
  const secret = "naOC0ocQE3shWLAfffVLB1rhYPG7";
  const docSeed = "naOC0ocQE3shWLAfffVLB1rhYPG7naOC";
  const docPublicKey = [
    215, 195, 98, 254, 120, 174, 248, 31, 242, 50, 135, 180, 147, 98, 139, 93,
    176, 42, 60, 79, 227, 11, 33, 94, 77, 25, 96, 155, 93, 118, 103, 58,
  ];
  const body = '{ "op": 0,"d": {}, "t": "GATEWAY_EVENT_NAME"}';
  const timestamp = "1725442341";
  const docSignature =
    "865ad13a61752ca65e26bde6676459cd36cf1be609375b37bd62af366e1dc25a8dc789ba7f14e017ada3d554c671a911bfdf075ba54835b23391d509579ed002";

  it("derives the documented seed from the secret", async () => {
    const keys = await getBotKeys(secret);
    const jwk = (await crypto.subtle.exportKey(
      "jwk",
      keys.privateKey,
    )) as JsonWebKey;
    expect(jwk.d).toBeDefined();
    expect([...base64urlToBytes(jwk.d as string)]).toEqual([
      ...encoder.encode(docSeed),
    ]);
  });

  it("derives the documented public key", async () => {
    const keys = await getBotKeys(secret);
    const jwk = (await crypto.subtle.exportKey(
      "jwk",
      keys.privateKey,
    )) as JsonWebKey;
    expect(jwk.x).toBeDefined();
    expect([...base64urlToBytes(jwk.x as string)]).toEqual(docPublicKey);
  });

  it.fails("verifies the documented signature with the derived public key", async () => {
    const keys = await getBotKeys(secret);
    const sig = hexToBytes(docSignature);
    expect(sig).not.toBeNull();
    const valid = await crypto.subtle.verify(
      "Ed25519",
      keys.publicKey,
      sig as Uint8Array,
      encoder.encode(timestamp + body),
    );
    expect(valid).toBe(true);
  });

  it.fails("reproduces the documented signature when signing timestamp+body", async () => {
    const keys = await getBotKeys(secret);
    const sig = await crypto.subtle.sign(
      "Ed25519",
      keys.privateKey,
      encoder.encode(timestamp + body),
    );
    expect(bytesToHex(sig)).toBe(docSignature);
  });
});

describe("webhook.html demo: https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/webhook.html", () => {
  const secret = "DG5g3B4j9X2KOErG";
  const plainToken = "Arq0D5A61EgUu4OxUvOp";
  const eventTs = "1725442341";
  const docSignature =
    "87befc99c42c651b3aac0278e71ada338433ae26fcb24307bdc5ad38c1adc2d01bcfcadc0842edac85e85205028a1132afe09280305f13aa6909ffc2d652c706";

  it("reproduces the documented callback-validation signature", async () => {
    const keys = await getBotKeys(secret);
    const sig = await crypto.subtle.sign(
      "Ed25519",
      keys.privateKey,
      encoder.encode(eventTs + plainToken),
    );
    expect(bytesToHex(sig)).toBe(docSignature);
  });

  it("round-trips: signatures verify with the derived public key", async () => {
    const keys = await getBotKeys(secret);
    const msg = encoder.encode(eventTs + plainToken);
    const sig = await crypto.subtle.sign("Ed25519", keys.privateKey, msg);
    const valid = await crypto.subtle.verify(
      "Ed25519",
      keys.publicKey,
      sig,
      msg,
    );
    expect(valid).toBe(true);
  });
});
