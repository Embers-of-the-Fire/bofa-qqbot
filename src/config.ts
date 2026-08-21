export interface BotConfiguration {
  admin: string | null;
  recognizedGroups: string[];
}

export async function getConfiguration(
  kv: KVNamespace,
): Promise<BotConfiguration> {
  const [adminRaw, groupsRaw] = await Promise.all([
    kv.get("admin"),
    kv.get("recognized-group"),
  ]);

  let recognizedGroups: string[] = [];
  if (groupsRaw !== null) {
    try {
      const parsed: unknown = JSON.parse(groupsRaw);
      if (Array.isArray(parsed) && parsed.every((n) => typeof n === "string")) {
        recognizedGroups = parsed as string[];
      }
    } catch {
      console.error("invalid recognized-group config", groupsRaw);
    }
  }

  return { admin: adminRaw, recognizedGroups };
}
