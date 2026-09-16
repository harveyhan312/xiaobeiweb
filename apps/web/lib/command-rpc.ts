// 快捷指令 BFF 逻辑：参数校验 + prompt 服务端渲染（红线：模板与组装不出服务端）。
import { randomUUID } from "node:crypto";

import { findCommand, type CommandDef } from "./command-catalog";

// 目标 agent 白名单（计划 §8 红线）：sales-cs 是对外 crew，绝不开放
const ALLOWED_TARGET_AGENTS = new Set(["main", "content-producer", "it-engineer"]);

// 参数字符白名单：排除模板占位符/转义/协议敏感字符与控制符（含换行），
// 参数以单行文本嵌入静态模板；具体内容约束由各指令 label 引导
const PARAM_TEXT_RE = /^[^{}$`\\\x00-\x1f\x7f]{1,500}$/u;

export type RenderResult =
  | { ok: true; prompt: string; sessionKey: string; targetAgentId: string }
  | { ok: false; error: string };

export function validateAndRender(
  commandId: unknown,
  rawParams: unknown,
): RenderResult {
  if (typeof commandId !== "string" || commandId.length === 0 || commandId.length > 64) {
    return { ok: false, error: "invalid commandId" };
  }
  const command: CommandDef | undefined = findCommand(commandId);
  if (!command) {
    return { ok: false, error: `unknown commandId: ${commandId}` };
  }
  if (!ALLOWED_TARGET_AGENTS.has(command.targetAgentId)) {
    return { ok: false, error: "target agent not allowed" };
  }
  if (rawParams === undefined || rawParams === null) {
    return { ok: false, error: "params object is required" };
  }
  if (typeof rawParams !== "object" || Array.isArray(rawParams)) {
    return { ok: false, error: "params must be an object" };
  }
  const params = rawParams as Record<string, unknown>;

  // 未声明的键一律拒绝，防止把任意内容挤进模板
  const declared = new Set(command.params.map((p) => p.key));
  for (const key of Object.keys(params)) {
    if (!declared.has(key)) {
      return { ok: false, error: `unknown param: ${key}` };
    }
  }

  const values: Record<string, string> = {};
  for (const p of command.params) {
    const raw = params[p.key];
    const str = typeof raw === "string" ? raw.trim() : "";
    if (!str) {
      if (p.required) {
        return { ok: false, error: `param ${p.key} is required` };
      }
      values[p.key] = "（未提供）";
      continue;
    }
    if (str.length > 500) {
      return { ok: false, error: `param ${p.key} too long (max 500 chars)` };
    }
    if (!PARAM_TEXT_RE.test(str)) {
      return { ok: false, error: `param ${p.key} 含非法字符` };
    }
    if (p.type === "choice") {
      if (!p.options || !p.options.includes(str)) {
        return { ok: false, error: `param ${p.key} 必须是给定选项之一` };
      }
    }
    values[p.key] = str;
  }

  const prompt = command.promptTemplate.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "（未提供）");
  if (/\{\{|\}\}/.test(prompt)) {
    // 防御：参数白名单已排除花括号，正常流程到不了这里
    return { ok: false, error: "rendered prompt contains placeholder residue" };
  }

  // 会话空间（T1 实证）：agent 前缀 key 直达目标 agent，与裸 web: 会话互不相通；
  // chat.send 的 agentId 参数与 key 内嵌一致由 gateway 二次校验
  const sessionKey = `agent:${command.targetAgentId}:web:${randomUUID()}`;
  return { ok: true, prompt, sessionKey, targetAgentId: command.targetAgentId };
}
