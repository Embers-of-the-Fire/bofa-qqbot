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

interface DataUpdateServer {
  id: string;
  name: string;
  build: number;
  version: string;
  createdAt: string;
}

interface DataUpdatePayload {
  servers: DataUpdateServer[];
}

function isDataUpdatePayload(p: unknown): p is DataUpdatePayload {
  if (typeof p !== "object" || p === null) {
    return false;
  }
  const o = p as Record<string, unknown>;
  if (!Array.isArray(o.servers) || o.servers.length === 0) {
    return false;
  }
  return o.servers.every((s) => {
    if (typeof s !== "object" || s === null) {
      return false;
    }
    const srv = s as Record<string, unknown>;
    return (
      typeof srv.id === "string" &&
      typeof srv.name === "string" &&
      typeof srv.build === "number" &&
      Number.isInteger(srv.build) &&
      typeof srv.version === "string" &&
      typeof srv.createdAt === "string"
    );
  });
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

function formatUtc8Date(now: Date): string {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

export function renderDataUpdateMarkdown(
  p: DataUpdatePayload,
  now: Date = new Date(),
): string {
  const items = p.servers
    .map(
      (s) =>
        `- ${s.name} (${s.id})\n  版本：${s.version}\n  数据同步：${s.build}\n  创建时间：${s.createdAt}`,
    )
    .join("\n");
  return `# 数据更新 ${formatUtc8Date(now)}\n\n本次更新涉及以下版本：\n${items}`;
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

  let markdown: string;
  if (body.type === "release-created") {
    if (!isReleaseCreatedPayload(body.payload)) {
      return errorResponse(
        c,
        400,
        EventErrorCode.InvalidPayload,
        "payload must contain string fields: version, tag, changelog",
      );
    }
    markdown = renderReleaseMarkdown(body.payload);
  } else if (body.type === "data_update") {
    if (!isDataUpdatePayload(body.payload)) {
      return errorResponse(
        c,
        400,
        EventErrorCode.InvalidPayload,
        "payload must contain a non-empty servers array, each with fields: id (string), name (string), build (int), version (string), createdAt (string)",
      );
    }
    markdown = renderDataUpdateMarkdown(body.payload);
  } else {
    return errorResponse(
      c,
      400,
      EventErrorCode.UnknownEventType,
      `unknown event type: ${String(body.type)}`,
    );
  }

  console.log(
    "event",
    JSON.stringify({ type: body.type, payload: body.payload }),
  );

  const config = await getConfiguration(c.env.CONFIG);

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
    console.log("event broadcast results", JSON.stringify(results));
  } catch (e) {
    console.error(
      "event broadcast failed",
      e instanceof Error ? e.message : String(e),
    );
  }

  return c.json({ status: "ok", errorcode: EventErrorCode.None });
});

export default event;
