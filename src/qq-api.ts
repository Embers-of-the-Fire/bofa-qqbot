const API_BASE = "https://api.bot.qq.com";

let tokenCache:
  | { appId: string; clientSecret: string; token: string; expiresAt: number }
  | undefined;

export async function getAccessToken(
  appId: string,
  clientSecret: string,
): Promise<string> {
  const now = Date.now();
  if (
    tokenCache &&
    tokenCache.appId === appId &&
    tokenCache.clientSecret === clientSecret &&
    tokenCache.expiresAt > now + 60_000
  ) {
    return tokenCache.token;
  }

  const res = await fetch(`${API_BASE}/app/getAppAccessToken`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ appId, clientSecret }),
  });
  if (!res.ok) {
    throw new Error(`getAppAccessToken failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number | string;
  };
  tokenCache = {
    appId,
    clientSecret,
    token: data.access_token,
    expiresAt: now + Number(data.expires_in) * 1000,
  };
  return data.access_token;
}

export interface GroupMessageResult {
  groupOpenid: string;
  ok: boolean;
  status: number;
  messageId?: string;
  error?: string;
}

export async function sendGroupMarkdownMessage(
  token: string,
  groupOpenid: string,
  content: string,
): Promise<GroupMessageResult> {
  const res = await fetch(`${API_BASE}/v2/groups/${groupOpenid}/messages`, {
    method: "POST",
    headers: {
      authorization: `QQBot ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ msg_type: 2, markdown: { content } }),
  });

  const text = await res.text();
  if (!res.ok) {
    return { groupOpenid, ok: false, status: res.status, error: text };
  }

  let messageId: string | undefined;
  try {
    messageId = (JSON.parse(text) as { id?: string }).id;
  } catch {
    console.error("unparseable send response", text);
  }
  return { groupOpenid, ok: true, status: res.status, messageId };
}
