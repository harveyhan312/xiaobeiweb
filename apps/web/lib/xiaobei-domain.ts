// xiaobei 域数据层：只读访问 ~/.openclaw/workspace-* 下的业务库与产物目录。
// 铁律同 xiaobei-data.ts：sqlite 一律 readOnly:true，文件只读，绝不写回。
// 库文件可能尚未创建（agent 首次发布/记录前不存在）——一律返回空值而非报错。

import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { safeUrl } from "./safe-url";

const STATE_DIR = process.env.OPENCLAW_STATE_DIR ?? join(homedir(), ".openclaw");
const MAIN_WS = join(STATE_DIR, "workspace-main");
const CONTENT_WS = join(STATE_DIR, "workspace-content-producer");
const SALES_WS = join(STATE_DIR, "workspace-sales-cs");

export const PLATFORM_LABELS: Record<string, string> = {
  wx_mp: "微信公众号",
  wx_channel: "微信视频号",
  xhs: "小红书",
  douyin: "抖音",
  bilibili: "B站",
  kuaishou: "快手",
  zhihu: "知乎",
  toutiao: "今日头条",
  juejin: "掘金",
  twitter: "Twitter/X",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  pinterest: "Pinterest",
  threads: "Threads",
};

const PLATFORM_SET = new Set(Object.keys(PLATFORM_LABELS));

export type DomainPlatform = {
  id: string;
  label: string;
  hasDna: boolean;
  hasCalibration: boolean;
  hasOutputs: boolean;
};

export function getDomainPlatforms(): DomainPlatform[] {
  if (!existsSync(MAIN_WS)) return [];
  return readdirSync(MAIN_WS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && PLATFORM_SET.has(e.name))
    .map((e) => ({
      id: e.name,
      label: PLATFORM_LABELS[e.name] ?? e.name,
      hasDna: existsSync(join(MAIN_WS, e.name, "dna")),
      hasCalibration: existsSync(join(MAIN_WS, e.name, "calibration")),
      hasOutputs: existsSync(join(MAIN_WS, e.name, "outputs")),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// workspace 内文本文件读取：resolve 后必须仍落在 MAIN_WS 内，防 URL 参数穿越
export function readWorkspaceTextFile(...parts: string[]): string | null {
  const abs = resolve(MAIN_WS, ...parts);
  if (!abs.startsWith(resolve(MAIN_WS) + sep)) return null;
  if (!existsSync(abs) || !statSync(abs).isFile()) return null;
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

function openDomainDb(dbPath: string): DatabaseSync | null {
  if (!existsSync(dbPath)) return null;
  try {
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null;
  }
}

// 域库可能只建了部分表（跨版本演进）——按表探测、逐表容错，单表缺失不连带丢另一表数据
function queryTable(
  db: DatabaseSync,
  table: string,
  sql: string,
): Array<Record<string, unknown>> {
  const hit = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(table);
  if (hit === undefined) return [];
  try {
    return db.prepare(sql).all() as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}

// ── 发布记录（workspace-main/db/published_track.db，每平台一张 pub_<platform> 表）──

export type PublishedRow = {
  platform: string;
  platformLabel: string;
  title: string;
  contentType: string | null;
  publishDate: string;
  distributeStatus: number; // 0=待分发 1=无需分发 2=已分发
  publishUrl: string | null;
  dnaId: string | null;
  account: string | null;
  metrics: Record<string, number>;
};

const DISTRIBUTE_LABELS: Record<number, string> = {
  0: "待分发",
  1: "无需分发",
  2: "已分发",
};

export function distributeLabel(status: number): string {
  return DISTRIBUTE_LABELS[status] ?? String(status);
}

const COMMON_PUB_COLS = new Set([
  "id", "title", "content_type", "source_folder", "publish_url", "publish_date",
  "distribute_status", "top_comment", "notes", "dna_id", "account", "perf_evaluated",
  "cal_enabled", "cal_score_er", "cal_score_hp", "cal_score_sr", "cal_score_ql",
  "cal_score_na", "cal_score_ab", "cal_score_pv", "cal_composite", "cal_rubric_version",
  "cal_scored_at", "cal_bias_signals", "cal_bump_evaluated", "created_at", "updated_at",
]);

export function getPublishedRows(limit = 200): PublishedRow[] {
  const db = openDomainDb(join(MAIN_WS, "db", "published_track.db"));
  if (!db) return [];
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pub_%'")
      .all() as Array<{ name: string }>;
    const rows: PublishedRow[] = [];
    for (const { name } of tables) {
      // 表名来自 sqlite_master 枚举而非用户输入；仍做形状守卫再拼接
      if (!/^pub_[a-z0-9_]+$/.test(name)) continue;
      const platform = name.slice(4);
      const rs = db
        .prepare(`SELECT * FROM ${name} ORDER BY publish_date DESC LIMIT ?`)
        .all(limit) as Array<Record<string, unknown>>;
      for (const r of rs) {
        const metrics: Record<string, number> = {};
        for (const [k, v] of Object.entries(r)) {
          if (!COMMON_PUB_COLS.has(k) && typeof v === "number") metrics[k] = v;
        }
        rows.push({
          platform,
          platformLabel: PLATFORM_LABELS[platform] ?? platform,
          title: String(r.title ?? ""),
          contentType: (r.content_type as string) ?? null,
          publishDate: String(r.publish_date ?? ""),
          distributeStatus: Number(r.distribute_status ?? 0),
          publishUrl: safeUrl(r.publish_url as string | null),
          dnaId: (r.dna_id as string) ?? null,
          account: (r.account as string) ?? null,
          metrics,
        });
      }
    }
    return rows.sort((a, b) => b.publishDate.localeCompare(a.publishDate)).slice(0, limit);
  } finally {
    db.close();
  }
}

// ── 内容风格 DNA（<platform>/dna/<dna-id>/）──

export type DnaSummary = {
  platform: string;
  platformLabel: string;
  id: string;
  hasDoc: boolean;
  hasTemplate: boolean;
  reports: string[];
  evals: string[];
  covers: number;
};

function listMdFiles(dir: string, sub: string): string[] {
  const target = join(dir, sub);
  if (!existsSync(target)) return [];
  try {
    return readdirSync(target).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
}

export function getDnaIndex(): DnaSummary[] {
  const out: DnaSummary[] = [];
  for (const p of getDomainPlatforms()) {
    if (!p.hasDna) continue;
    const dnaDir = join(MAIN_WS, p.id, "dna");
    try {
      const entries = readdirSync(dnaDir, { withFileTypes: true }).filter((e) => e.isDirectory());
      for (const e of entries) {
        const dir = join(dnaDir, e.name);
        out.push({
          platform: p.id,
          platformLabel: p.label,
          id: e.name,
          hasDoc: existsSync(join(dir, `${e.name}.dna.md`)),
          hasTemplate: existsSync(join(dir, `${e.name}.template.md`)),
          reports: listMdFiles(dir, "reports"),
          evals: listMdFiles(dir, "evals"),
          covers: existsSync(join(dir, "covers"))
            ? readdirSync(join(dir, "covers")).length
            : 0,
        });
      }
    } catch {
      continue;
    }
  }
  return out;
}

// ── 复盘校准（<platform>/calibration/：platform-state.json + md 文档）──

export type CalibrationInfo = {
  platform: string;
  platformLabel: string;
  state: Record<string, unknown> | null;
  docs: Array<{ name: string; content: string }>;
};

export function getCalibrations(): CalibrationInfo[] {
  const out: CalibrationInfo[] = [];
  for (const p of getDomainPlatforms()) {
    if (!p.hasCalibration) continue;
    const dir = join(MAIN_WS, p.id, "calibration");
    let state: Record<string, unknown> | null = null;
    const statePath = join(dir, "platform-state.json");
    if (existsSync(statePath)) {
      try {
        state = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
      } catch {
        state = null;
      }
    }
    let docs: Array<{ name: string; content: string }> = [];
    try {
      docs = readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .map((name) => ({ name, content: readFileSync(join(dir, name), "utf8") }));
    } catch {
      docs = [];
    }
    out.push({ platform: p.id, platformLabel: p.label, state, docs });
  }
  return out;
}

// ── BD 线索（workspace-main/db/bd_record.db）──

export type LeadCreator = {
  id: number;
  platform: string;
  creatorId: string;
  nickname: string | null;
  homepageUrl: string | null;
  qualified: boolean;
  notes: string | null;
  createdAt: string;
};

export type CommentPost = {
  id: number;
  platform: string;
  postTitle: string | null;
  postUrl: string | null;
  strategy: string;
  replied: boolean;
  replyContent: string | null;
  createdAt: string;
};

export type BdData = { leads: LeadCreator[]; comments: CommentPost[] };

export function getBdData(): BdData {
  const db = openDomainDb(join(MAIN_WS, "db", "bd_record.db"));
  if (!db) return { leads: [], comments: [] };
  try {
    const leads = queryTable(
      db,
      "lead_creators",
      "SELECT * FROM lead_creators ORDER BY created_at DESC LIMIT 200",
    ).map((r) => ({
      id: Number(r.id ?? 0),
      platform: String(r.platform ?? ""),
      creatorId: String(r.creator_id ?? ""),
      nickname: (r.nickname as string) ?? null,
      homepageUrl: safeUrl(r.homepage_url as string | null),
      qualified: Number(r.qualified ?? 0) === 1,
      notes: (r.notes as string) ?? null,
      createdAt: String(r.created_at ?? ""),
    }));
    const comments = queryTable(
      db,
      "comment_posts",
      "SELECT * FROM comment_posts ORDER BY created_at DESC LIMIT 200",
    ).map((r) => ({
      id: Number(r.id ?? 0),
      platform: String(r.platform ?? ""),
      postTitle: (r.post_title as string) ?? null,
      postUrl: safeUrl(r.post_url as string | null),
      strategy: String(r.strategy ?? ""),
      replied: Number(r.replied ?? 0) === 1,
      replyContent: (r.reply_content as string) ?? null,
      createdAt: String(r.created_at ?? ""),
    }));
    return { leads, comments };
  } catch {
    return { leads: [], comments: [] };
  } finally {
    db.close();
  }
}

// ── BD 情报（workspace-main/db/info_record.db）──

export type IntelItem = {
  id: number;
  source: string;
  sourceType: string;
  title: string | null;
  author: string | null;
  publishDate: string | null;
  createdAt: string;
};

export function getIntelItems(): IntelItem[] {
  const db = openDomainDb(join(MAIN_WS, "db", "info_record.db"));
  if (!db) return [];
  try {
    return (
      db.prepare("SELECT * FROM intel_items ORDER BY created_at DESC LIMIT 200").all() as Array<
        Record<string, unknown>
      >
    ).map((r) => ({
      id: Number(r.id ?? 0),
      source: String(r.source ?? ""),
      sourceType: String(r.source_type ?? ""),
      title: (r.title as string) ?? null,
      author: (r.author as string) ?? null,
      publishDate: (r.publish_date as string) ?? null,
      createdAt: String(r.created_at ?? ""),
    }));
  } catch {
    return [];
  } finally {
    db.close();
  }
}

// ── IR 投资人（workspace-main/db/ir_record.db）──

export type IrInvestor = {
  id: number;
  name: string;
  type: string;
  firm: string;
  status: string;
  focusAreas: string | null;
  matchScore: string | null;
  updatedAt: string;
};

export type IrApplication = {
  id: number;
  name: string;
  type: string;
  organizer: string | null;
  deadline: string | null;
  status: string;
  result: string | null;
};

export type IrData = { investors: IrInvestor[]; applications: IrApplication[] };

export function getIrData(): IrData {
  const db = openDomainDb(join(MAIN_WS, "db", "ir_record.db"));
  if (!db) return { investors: [], applications: [] };
  try {
    const investors = queryTable(
      db,
      "investors",
      "SELECT * FROM investors ORDER BY updated_at DESC LIMIT 200",
    ).map((r) => ({
      id: Number(r.id ?? 0),
      name: String(r.name ?? ""),
      type: String(r.type ?? ""),
      firm: String(r.firm ?? ""),
      status: String(r.status ?? "new"),
      focusAreas: (r.focus_areas as string) ?? null,
      matchScore: (r.match_score as string) ?? null,
      updatedAt: String(r.updated_at ?? ""),
    }));
    const applications = queryTable(
      db,
      "applications",
      "SELECT * FROM applications ORDER BY deadline IS NULL, deadline ASC LIMIT 100",
    ).map((r) => ({
      id: Number(r.id ?? 0),
      name: String(r.name ?? ""),
      type: String(r.type ?? ""),
      organizer: (r.organizer as string) ?? null,
      deadline: (r.deadline as string) ?? null,
      status: String(r.status ?? "planning"),
      result: (r.result as string) ?? null,
    }));
    return { investors, applications };
  } catch {
    return { investors: [], applications: [] };
  } finally {
    db.close();
  }
}

// ── 客户库（workspace-sales-cs/db/customer.db，sales-cs crew 启用后由 hook 写入）──

export type CsRecord = {
  peer: string;
  businessStatus: string;
  purpose: string;
  updatedAt: string | null;
};

export type FollowUp = {
  id: number;
  peer: string;
  followUpAt: string;
  reason: string;
  status: string;
  contextSummary: string | null;
};

export type CustomerData = { records: CsRecord[]; followUps: FollowUp[] };

export function getCustomerData(): CustomerData {
  const db = openDomainDb(join(SALES_WS, "db", "customer.db"));
  if (!db) return { records: [], followUps: [] };
  try {
    const records = queryTable(
      db,
      "cs_record",
      "SELECT * FROM cs_record ORDER BY updated_at DESC LIMIT 500",
    ).map((r) => ({
      peer: String(r.peer ?? ""),
      businessStatus: String(r.business_status ?? "free"),
      purpose: String(r.purpose ?? ""),
      updatedAt: (r.updated_at as string) ?? null,
    }));
    const followUps = queryTable(
      db,
      "follow_up",
      "SELECT * FROM follow_up WHERE status != 'completed' ORDER BY follow_up_at ASC LIMIT 100",
    ).map((r) => ({
      id: Number(r.id ?? 0),
      peer: String(r.peer ?? ""),
      followUpAt: String(r.follow_up_at ?? ""),
      reason: String(r.reason ?? ""),
      status: String(r.status ?? "pending"),
      contextSummary: (r.context_summary as string) ?? null,
    }));
    return { records, followUps };
  } catch {
    return { records: [], followUps: [] };
  } finally {
    db.close();
  }
}

// ── 视频生产任务（产物文件存在性即 checkpoint，见计划 §4.3）──

export type VideoMilestones = {
  brief: boolean;
  script: boolean;
  storyboard: boolean;
  characters: boolean;
  gateA: boolean;
  gateB: boolean;
  slots: boolean;
  render: boolean;
  audio: boolean;
  artifacts: boolean;
  review: boolean;
  cover: boolean;
  finalDeliver: boolean;
};

export type VideoProject = {
  name: string;
  dir: string;
  source: string;
  milestones: VideoMilestones;
};

const VIDEO_MILESTONE_FILES: Array<[keyof VideoMilestones, string[]]> = [
  ["brief", ["brief.md"]],
  ["script", ["script", "script.md"]],
  ["storyboard", ["storyboard", "storyboard.json"]],
  ["characters", ["characters", "registry.json"]],
  ["gateA", ["gates", "gate-a.md"]],
  ["gateB", ["gates", "gate-b.md"]],
  ["slots", ["slots", "slot-plan.json"]],
  ["render", ["render"]],
  ["audio", ["audio", "narration.mp3"]],
  ["artifacts", ["artifacts"]],
  ["review", ["review", "verdict.json"]],
  ["cover", ["cover.jpg"]],
  ["finalDeliver", ["final-deliver.md"]],
];

export const VIDEO_MILESTONE_LABELS: Array<[keyof VideoMilestones, string]> = [
  ["brief", "创意简报"],
  ["script", "脚本"],
  ["storyboard", "分镜"],
  ["characters", "角色"],
  ["gateA", "闸门A"],
  ["gateB", "闸门B"],
  ["slots", "素材槽"],
  ["render", "生成"],
  ["audio", "配音"],
  ["artifacts", "片段"],
  ["review", "自检"],
  ["cover", "封面"],
  ["finalDeliver", "交付"],
];

function scanVideoDir(base: string, source: string, requireMarker: boolean): VideoProject[] {
  if (!existsSync(base)) return [];
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const dir = join(base, e.name);
        const milestones = {} as VideoMilestones;
        for (const [key, parts] of VIDEO_MILESTONE_FILES) {
          milestones[key] = existsSync(join(dir, ...parts));
        }
        return { name: e.name, dir: dir.replace(homedir(), "~"), source, milestones };
      })
      .filter((p) => {
        if (!requireMarker) return true;
        // 平台 outputs 下混有文章等非视频产物——只收带视频工程标记的目录
        return (
          p.milestones.brief || p.milestones.artifacts || p.milestones.cover || p.milestones.finalDeliver
        );
      });
  } catch {
    return [];
  }
}

export function getVideoProjects(): VideoProject[] {
  return [
    ...scanVideoDir(join(CONTENT_WS, "output_videos"), "content-producer/output_videos", false),
    ...getDomainPlatforms()
      .filter((p) => p.hasOutputs)
      .flatMap((p) => scanVideoDir(join(MAIN_WS, p.id, "outputs"), `main/${p.id}/outputs`, true)),
  ];
}
