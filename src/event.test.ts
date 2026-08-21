import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "./env";
import event, { EventErrorCode, renderReleaseMarkdown } from "./event";

const SECRET = "test-event-secret";

const app = new Hono<{ Bindings: Bindings }>().route("/event", event);

function fakeKv(store: Record<string, string>): KVNamespace {
  return {
    get: (key: string) => Promise.resolve(store[key] ?? null),
  } as unknown as KVNamespace;
}

function testEnv(store: Record<string, string> = {}): Bindings {
  return {
    QQ_BOT_APPID: "test-appid",
    QQ_BOT_SECRET: "test-secret",
    EVENT_SECRET: SECRET,
    CONFIG: fakeKv(store),
  };
}

async function post(
  body: string,
  headers: Record<string, string> = {},
  env: Bindings = testEnv(),
): Promise<Response> {
  const res = await app.request(
    "/event",
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    },
    env,
  );
  return res;
}

function authed(
  payload: unknown,
  env: Bindings = testEnv(),
): Promise<Response> {
  return post(
    JSON.stringify(payload),
    { authorization: `Bearer ${SECRET}` },
    env,
  );
}

async function errorcode(res: Response): Promise<number> {
  const body = (await res.json()) as { errorcode: number };
  return body.errorcode;
}

const validEvent = {
  type: "release-created",
  payload: { version: "1.2.3", tag: "v1.2.3", changelog: "# Changes\n" },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderReleaseMarkdown", () => {
  it("renders the configured template", () => {
    expect(
      renderReleaseMarkdown({
        version: "1.2.3",
        tag: "v1.2.3",
        changelog: "# Changes\n\n- stuff",
      }),
    ).toBe("# EFA 1.2.3\n> 标签：v1.2.3\n\n# Changes\n\n- stuff");
  });
});

describe("POST /event", () => {
  it("broadcasts markdown to all recognized groups", async () => {
    const fetchMock = vi.fn(
      (input: Request | URL | string, _init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/app/getAppAccessToken")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ access_token: "tok", expires_in: 7200 }),
            ),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ id: "m1", timestamp: "t" })),
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const env = testEnv({
      admin: "some-admin-openid",
      "recognized-group": '["GROUP_A", "GROUP_B"]',
    });
    const res = await authed(validEvent, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      errorcode: EventErrorCode.None,
    });

    const groupCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("/v2/groups/"),
    );
    expect(groupCalls.map(([input]) => String(input))).toEqual([
      "https://api.bot.qq.com/v2/groups/GROUP_A/messages",
      "https://api.bot.qq.com/v2/groups/GROUP_B/messages",
    ]);
    for (const [, init] of groupCalls) {
      const body = JSON.parse(String((init as RequestInit).body)) as {
        msg_type: number;
        markdown: { content: string };
      };
      expect(body.msg_type).toBe(2);
      expect(body.markdown.content).toBe(
        "# EFA 1.2.3\n> 标签：v1.2.3\n\n# Changes\n",
      );
      expect((init as RequestInit).headers).toMatchObject({
        authorization: "QQBot tok",
      });
    }
  });

  it("succeeds without broadcasting when no groups are configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await authed(validEvent);
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a missing Authorization header", async () => {
    const res = await post('{"type":"release-created","payload":{}}');
    expect(res.status).toBe(401);
    expect(await errorcode(res)).toBe(EventErrorCode.Unauthorized);
  });

  it("rejects a wrong bearer token", async () => {
    const res = await post("{}", { authorization: "Bearer wrong" });
    expect(res.status).toBe(401);
    expect(await errorcode(res)).toBe(EventErrorCode.Unauthorized);
  });

  it("rejects malformed JSON", async () => {
    const res = await post("not json", {
      authorization: `Bearer ${SECRET}`,
    });
    expect(res.status).toBe(400);
    expect(await errorcode(res)).toBe(EventErrorCode.MalformedBody);
  });

  it("rejects an unknown event type", async () => {
    const res = await authed({ type: "unknown", payload: {} });
    expect(res.status).toBe(400);
    expect(await errorcode(res)).toBe(EventErrorCode.UnknownEventType);
  });

  it("rejects an invalid payload", async () => {
    const res = await authed({
      type: "release-created",
      payload: { version: "1.2.3", tag: "v1.2.3" },
    });
    expect(res.status).toBe(400);
    expect(await errorcode(res)).toBe(EventErrorCode.InvalidPayload);
  });
});
