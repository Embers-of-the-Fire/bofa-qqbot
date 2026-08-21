import { Hono } from "hono";
import { bytesToHex, getBotKeys, hexToBytes } from "./ed25519";
import { type CallbackValidationData, OpCode, type Payload } from "./payload";

type Bindings = {
  QQ_BOT_APPID: string;
  QQ_BOT_SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/qq", (c) => c.text("ok"));

app.post("/qq", async (c) => {
  const secret = c.env.QQ_BOT_SECRET;
  if (!secret) {
    return c.text("bot secret not configured", 500);
  }

  const body = await c.req.text();

  console.log(
    "qq webhook POST",
    JSON.stringify({
      appid: c.req.header("X-Bot-Appid"),
      timestamp: c.req.header("X-Signature-Timestamp"),
      body,
    }),
  );

  let payload: Payload;
  try {
    payload = JSON.parse(body) as Payload;
  } catch {
    return c.text("invalid payload", 400);
  }

  const keys = await getBotKeys(secret);
  const encoder = new TextEncoder();

  if (payload.op === OpCode.CallbackValidation) {
    const d = payload.d as CallbackValidationData;
    const msg = encoder.encode(d.event_ts + d.plain_token);
    const signature = await crypto.subtle.sign("Ed25519", keys.privateKey, msg);
    const response = {
      plain_token: d.plain_token,
      signature: bytesToHex(signature),
    };
    console.log("qq webhook validation response", JSON.stringify(response));
    return c.json(response);
  }

  const signatureHeader = c.req.header("X-Signature-Ed25519");
  const timestamp = c.req.header("X-Signature-Timestamp");
  if (!signatureHeader || !timestamp) {
    return c.text("missing signature headers", 401);
  }

  const signature = hexToBytes(signatureHeader);
  const lastByte = signature?.[63];
  if (signature?.length !== 64 || lastByte === undefined) {
    return c.text("invalid signature", 401);
  }
  if ((lastByte & 0xe0) !== 0) {
    return c.text("invalid signature", 401);
  }

  const msg = encoder.encode(timestamp + body);
  const valid = await crypto.subtle.verify(
    "Ed25519",
    keys.publicKey,
    signature,
    msg,
  );
  if (!valid) {
    return c.text("signature verification failed", 401);
  }

  if (payload.op === OpCode.Dispatch) {
    c.executionCtx.waitUntil(handleEvent(payload));
  }

  return c.json({ op: OpCode.HttpCallbackAck });
});

async function handleEvent(payload: Payload): Promise<void> {
  console.log("event", payload.t, JSON.stringify(payload.d));
}

export default app;
