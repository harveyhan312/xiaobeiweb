// channel 绑定 patch 模板：把 IT engineer 技能里的 sample JSON 转成 config.patch 片段。
// 模板是唯一写面——BFF 不接受浏览器上送的任意 config 片段，只接受参数
// （kind + 凭证），fragment 结构全部由本模块决定。
//
// channel 铁律（it-engineer/AGENTS.md）：channel 只写 bindings[].match.channel +
// channels.<name> + plugins.entries.<name> 三处，绝不写 agent 顶层。
import { homedir } from "node:os";
import { join } from "node:path";

export type ChannelKind = "awada" | "feishu";

export const CHANNEL_KINDS: ChannelKind[] = ["awada", "feishu"];

const SECRET_RE = /^[\x21-\x7e]{8,200}$/; // 可见 ASCII，无空白
const APP_ID_RE = /^[\x21-\x7e]{4,120}$/;

function wiseflowProjectRoot(): string {
  return process.env.XIAOBEI_PROJECT_ROOT ?? join(homedir(), "xiaobei");
}

export type FeishuAccountInput = { accountId: string; appId: string; appSecret: string };

export type ChannelBuildInput =
  | { kind: "awada"; awadaKey: string }
  | { kind: "feishu"; accounts: FeishuAccountInput[] };

export type ChannelBuildResult = {
  patch: Record<string, unknown>;
  /** config.patch 的 replacePaths（string 数组整体替换需显式意图） */
  replacePaths: string[];
  /** 展示用摘要（不含密钥明文） */
  summary: string[];
};

// 预览回显前把 patch 里的密钥字段打码；结构已知，只处理 channels.* 下的凭证键
export function maskChannelPatchSecrets(patch: Record<string, unknown>): Record<string, unknown> {
  const clone = structuredClone(patch) as {
    channels?: Record<string, Record<string, unknown>>;
  };
  const channels = clone.channels;
  if (channels) {
    if (typeof channels.awada?.awadaKey === "string") {
      channels.awada.awadaKey = "****";
    }
    const feishuAccounts = channels.feishu?.accounts as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (feishuAccounts) {
      for (const acc of Object.values(feishuAccounts)) {
        if (typeof acc.appSecret === "string") acc.appSecret = "****";
      }
    }
  }
  return clone as Record<string, unknown>;
}

export function buildChannelPatch(input: ChannelBuildInput, current: {
  bindings?: unknown;
  pluginLoadPaths?: unknown;
  feishuAccounts?: unknown;
}): ChannelBuildResult {
  if (input.kind === "awada") {
    const awadaKey = input.awadaKey.trim();
    if (!SECRET_RE.test(awadaKey)) {
      throw new Error("awadaKey 必须为 8-200 位可见 ASCII 字符");
    }
    const root = wiseflowProjectRoot();
    const prevPaths = Array.isArray(current.pluginLoadPaths)
      ? (current.pluginLoadPaths as unknown[]).filter((p): p is string => typeof p === "string")
      : [];
    const paths = [...new Set([...prevPaths, `${root}/awada`])];
    return {
      patch: {
        channels: { awada: { enabled: true, awadaKey } },
        plugins: {
          load: { paths },
          entries: {
            awada: {
              enabled: true,
              config: {
                customerdb: {
                  agentId: "sales-cs",
                  workspaceDir: `${homedir()}/.openclaw/workspace-sales-cs`,
                },
              },
            },
          },
        },
      },
      // plugins.load.paths 是 string 数组，合并语义为整体替换 → 必须显式声明 replacePaths
      replacePaths: ["plugins.load.paths"],
      summary: [
        "channels.awada：启用（awadaKey=****）",
        `plugins.load.paths：${prevPaths.length} 项 → ${paths.length} 项（追加 ${root}/awada）`,
        "plugins.entries.awada：启用 + customerdb 指向 sales-cs workspace",
      ],
    };
  }

  // feishu：accounts + bindings 全量替换（bindings 为对象数组，随模板追加后整体发送）
  const accounts = input.accounts;
  if (!Array.isArray(accounts) || accounts.length === 0 || accounts.length > 8) {
    throw new Error("accounts 需 1-8 个飞书账号");
  }
  const seenAccounts = new Set<string>();
  // 飞书模板固定三个 bot 的路由（与 work-channel-binding sample 一致）
  const AGENT_BY_ACCOUNT: Record<string, string> = {
    "main-bot": "main",
    "producer-bot": "content-producer",
    "it-bot": "it-engineer",
  };
  const channelAccounts: Record<string, unknown> = {};
  const feishuBindings: Array<{
    agentId: string;
    match: { channel: string; accountId: string };
  }> = [];
  for (const a of accounts) {
    const accountId = a.accountId.trim();
    const appId = a.appId.trim();
    const appSecret = a.appSecret.trim();
    if (!/^[a-z0-9-]{2,64}$/.test(accountId)) {
      throw new Error(`accountId 非法: ${accountId}`);
    }
    if (!APP_ID_RE.test(appId)) throw new Error(`appId 非法: ${accountId}`);
    if (!SECRET_RE.test(appSecret)) throw new Error(`appSecret 非法: ${accountId}`);
    if (seenAccounts.has(accountId)) throw new Error(`accountId 重复: ${accountId}`);
    seenAccounts.add(accountId);
    channelAccounts[accountId] = {
      appId,
      appSecret,
      dmPolicy: "open",
      groupPolicy: "mention",
      allowFrom: ["all"],
    };
    feishuBindings.push({
      agentId: AGENT_BY_ACCOUNT[accountId] ?? "main",
      match: { channel: "feishu", accountId },
    });
  }
  // accounts 是普通对象，merge-patch 下旧账号不会自动清除；
  // 用 null 删键把本次未提交的存量账号显式移除（模板输入即权威全集）
  const prevFeishuAccounts =
    current.feishuAccounts &&
    typeof current.feishuAccounts === "object" &&
    !Array.isArray(current.feishuAccounts)
      ? (current.feishuAccounts as Record<string, unknown>)
      : {};
  const removedAccounts: string[] = [];
  const removedArrayPaths: string[] = [];
  for (const prevId of Object.keys(prevFeishuAccounts)) {
    if (!seenAccounts.has(prevId)) {
      channelAccounts[prevId] = null;
      removedAccounts.push(prevId);
      // 删除账号会连带移除其 allowFrom 数组，gateway 护栏要求显式声明意图；
      // 账号结构由本模板定义，allowFrom 是其中唯一数组
      removedArrayPaths.push(`channels.feishu.accounts.${prevId}.allowFrom`);
    }
  }
  const currentBindings = Array.isArray(current.bindings)
    ? (current.bindings as Array<Record<string, unknown>>)
    : [];
  const keptBindings = currentBindings.filter((b) => {
    const ch = (b.match as Record<string, unknown> | undefined)?.channel;
    return ch !== "feishu";
  });
  return {
    patch: {
      bindings: [...keptBindings, ...feishuBindings],
      channels: {
        feishu: { enabled: true, accounts: channelAccounts },
      },
      plugins: {
        entries: { feishu: { enabled: true } },
      },
    },
    replacePaths: ["bindings", ...removedArrayPaths],
    summary: [
      `channels.feishu：启用 ${accounts.length} 个账号（${[...seenAccounts].join("、")}，appSecret 已脱敏）`,
      ...(removedAccounts.length > 0
        ? [`channels.feishu.accounts：移除未提交的存量账号 ${removedAccounts.join("、")}`]
        : []),
      `bindings：${keptBindings.length} 条保留 + ${feishuBindings.length} 条飞书路由`,
      "plugins.entries.feishu：启用",
    ],
  };
}

// API 路由共享的请求体解析：只放行 kind + 凭证参数，结构校验不过直接给错误消息
export function parseChannelRequest(body: Record<string, unknown>):
  | { ok: true; input: ChannelBuildInput }
  | { ok: false; error: string } {
  const kind = typeof body.kind === "string" ? body.kind : "";
  if (kind !== "awada" && kind !== "feishu") {
    return { ok: false, error: "kind 必须是 awada 或 feishu" };
  }
  if (kind === "awada") {
    if (typeof body.awadaKey !== "string" || body.awadaKey.trim() === "") {
      return { ok: false, error: "awada 需要 awadaKey" };
    }
    return { ok: true, input: { kind, awadaKey: body.awadaKey } };
  }
  if (!Array.isArray(body.accounts)) {
    return { ok: false, error: "feishu 需要 accounts 数组" };
  }
  const accounts: FeishuAccountInput[] = [];
  for (const raw of body.accounts) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: "accounts 每项必须是对象" };
    }
    const a = raw as Record<string, unknown>;
    if (
      typeof a.accountId !== "string" ||
      typeof a.appId !== "string" ||
      typeof a.appSecret !== "string" ||
      a.accountId.trim() === ""
    ) {
      return { ok: false, error: "accounts 每项需要 accountId/appId/appSecret 字符串" };
    }
    accounts.push({ accountId: a.accountId, appId: a.appId, appSecret: a.appSecret });
  }
  if (accounts.length === 0) {
    return { ok: false, error: "accounts 至少一项" };
  }
  return { ok: true, input: { kind, accounts } };
}
