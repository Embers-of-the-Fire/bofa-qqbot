import { Hono } from "hono";
import { getConfiguration } from "./config";
import type { Bindings } from "./env";
import { getAccessToken, sendGroupMarkdownMessage } from "./qq-api";

export const EventErrorCode = {
  None: 0,
  Unauthorized: 1,
  MalformedBody: 2,
  UnknownEventType: 3,
  InvalidPayload: 4,
} as const;

export type EventErrorCode =
  (typeof EventErrorCode)[keyof typeof EventErrorCode];

interface ReleaseCreatedPayload {
  version: string;
  tag: string;
  changelog: string;
}

function isReleaseCreatedPayload(p: unknown): p is ReleaseCreatedPayload {
  if (typeof p !== "object" || p === null) {
    return false;
  }
  const o = p as Record<string, unknown>;
  return (
    typeof o.version === "string" &&
    typeof o.tag === "string" &&
    typeof o.changelog === "string"
  );
}

function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const ea = encoder.encode(a);
  const eb = encoder.encode(b);
  if (ea.length !== eb.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < ea.length; i++) {
    diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  }
  return diff === 0;
}

function errorResponse(
  c: { json: (body: unknown, status: number) => Response },
  httpStatus: number,
  errorcode: EventErrorCode,
  message: string,
): Response {
  return c.json({ status: "error", errorcode, error: { message } }, httpStatus);
}

export function renderReleaseMarkdown(p: ReleaseCreatedPayload): string {
  return `# EFA ${p.version}\n> 标签：${p.tag}\n\n${p.changelog}`;
}

const event = new Hono<{ Bindings: Bindings }>();

event.post("/", async (c) => {
  const secret = c.env.EVENT_SECRET;
  if (!secret) {
    return errorResponse(
      c,
      500,
      EventErrorCode.Unauthorized,
      "event secret not configured",
    );
  }

  const auth = c.req.header("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
  if (!token || !safeEqual(token, secret)) {
    return errorResponse(c, 401, EventErrorCode.Unauthorized, "unauthorized");
  }

  let body: { type?: unknown; payload?: unknown };
  try {
    body = (await c.req.json()) as { type?: unknown; payload?: unknown };
  } catch {
    return errorResponse(
      c,
      400,
      EventErrorCode.MalformedBody,
      "request body is not valid JSON",
    );
  }

  if (body.type !== "release-created") {
    return errorResponse(
      c,
      400,
      EventErrorCode.UnknownEventType,
      `unknown event type: ${String(body.type)}`,
    );
  }

  if (!isReleaseCreatedPayload(body.payload)) {
    return errorResponse(
      c,
      400,
      EventErrorCode.InvalidPayload,
      "payload must contain string fields: version, tag, changelog",
    );
  }

  console.log(
    "event",
    JSON.stringify({ type: body.type, payload: body.payload }),
  );

  const config = await getConfiguration(c.env.CONFIG);
  const markdown = renderReleaseMarkdown(body.payload);

  if (config.recognizedGroups.length === 0) {
    console.log("no recognized groups configured, skipping broadcast");
    return c.json({ status: "ok", errorcode: EventErrorCode.None });
  }

  try {
    const token = await getAccessToken(c.env.QQ_BOT_APPID, c.env.QQ_BOT_SECRET);
    const results = await Promise.all(
      config.recognizedGroups.map((group) =>
        sendGroupMarkdownMessage(token, group, markdown).catch(
          (e: unknown) => ({
            groupOpenid: group,
            ok: false as const,
            status: 0,
            error: e instanceof Error ? e.message : String(e),
          }),
        ),
      ),
    );
    console.log("release broadcast results", JSON.stringify(results));
  } catch (e) {
    console.error(
      "release broadcast failed",
      e instanceof Error ? e.message : String(e),
    );
  }

  return c.json({ status: "ok", errorcode: EventErrorCode.None });
});

export default event;
