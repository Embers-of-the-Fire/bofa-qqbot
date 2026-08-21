import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "./env";
import event, {
  EventErrorCode,
  renderDataUpdateMarkdown,
  renderReleaseMarkdown,
} from "./event";

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

const validDataUpdateEvent = {
  type: "data_update",
  payload: {
    servers: [
      {
        id: "tranquility",
        name: "晨曦",
        build: 2798617,
        version: "24.06",
        createdAt: "2026-08-20T12:34:56Z",
      },
    ],
  },
};

afterEach(() => {
  vi.useRealTimers();
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

describe("renderDataUpdateMarkdown", () => {
  const now = new Date("2026-08-21T03:00:00Z");

  it("renders a single server", () => {
    expect(
      renderDataUpdateMarkdown(
        {
          servers: [
            {
              id: "tranquility",
              name: "晨曦",
              build: 2798617,
              version: "24.06",
              createdAt: "2026-08-20T12:34:56Z",
            },
          ],
        },
        now,
      ),
    ).toBe(
      "# 数据更新 2026/08/21\n\n本次更新涉及以下版本：\n- 晨曦 (tranquility)\n  版本：24.06\n  数据同步：2798617\n  创建时间：2026-08-20T12:34:56Z",
    );
  });

  it("renders multiple servers", () => {
    expect(
      renderDataUpdateMarkdown(
        {
          servers: [
            {
              id: "tranquility",
              name: "晨曦",
              build: 2798617,
              version: "24.06",
              createdAt: "2026-08-20T12:34:56Z",
            },
            {
              id: "serenity",
              name: "宁静",
              build: 2799000,
              version: "24.06.1",
              createdAt: "2026-08-21T01:02:03Z",
            },
          ],
        },
        now,
      ),
    ).toBe(
      "# 数据更新 2026/08/21\n\n本次更新涉及以下版本：\n- 晨曦 (tranquility)\n  版本：24.06\n  数据同步：2798617\n  创建时间：2026-08-20T12:34:56Z\n- 宁静 (serenity)\n  版本：24.06.1\n  数据同步：2799000\n  创建时间：2026-08-21T01:02:03Z",
    );
  });

  it("uses the UTC+8 date when UTC is still the previous day", () => {
    expect(
      renderDataUpdateMarkdown(
        {
          servers: [
            {
              id: "tranquility",
              name: "晨曦",
              build: 2798617,
              version: "24.06",
              createdAt: "2026-08-20T12:34:56Z",
            },
          ],
        },
        new Date("2026-08-20T17:30:00Z"),
      ),
    ).toContain("# 数据更新 2026/08/21\n");
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

  it("broadcasts data_update markdown to all recognized groups", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T03:00:00Z"));
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
      "recognized-group": '["GROUP_A"]',
    });
    const res = await authed(validDataUpdateEvent, env);

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
    ]);
    const [, init] = groupCalls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      msg_type: number;
      markdown: { content: string };
    };
    expect(body.msg_type).toBe(2);
    expect(body.markdown.content).toBe(
      "# 数据更新 2026/08/21\n\n本次更新涉及以下版本：\n- 晨曦 (tranquility)\n  版本：24.06\n  数据同步：2798617\n  创建时间：2026-08-20T12:34:56Z",
    );
  });

  it("rejects a data_update event with an empty servers array", async () => {
    const res = await authed({ type: "data_update", payload: { servers: [] } });
    expect(res.status).toBe(400);
    expect(await errorcode(res)).toBe(EventErrorCode.InvalidPayload);
  });

  it("rejects a data_update event with an invalid server entry", async () => {
    const res = await authed({
      type: "data_update",
      payload: {
        servers: [
          {
            id: "tranquility",
            name: "晨曦",
            build: "2798617",
            version: "24.06",
            createdAt: "2026-08-20T12:34:56Z",
          },
        ],
      },
    });
    expect(res.status).toBe(400);
    expect(await errorcode(res)).toBe(EventErrorCode.InvalidPayload);
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
