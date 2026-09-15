# xiaobei-web 本机部署日志

> 部署日期：2026-09-15。形态：本机生产（launchd 常驻，**不开机自启**——按用户选择，重启后需手动启动）。
> 代码仓：`/Users/harvey/Documents/Qoder/projects/xiaobei-web`（branch main）。前置：Phase 1–3 已过第三方审核。

## 一、落点清单（装了什么、在哪）

| 内容 | 路径 |
|------|------|
| 应用代码与构建产物 | `~/Documents/Qoder/projects/xiaobei-web/apps/web`（`.next/` 为生产构建） |
| launchd 配置（本机生效） | `~/Library/LaunchAgents/ai.xiaobei.web.plist` |
| launchd 配置（仓内副本） | `deploy/ai.xiaobei.web.plist` |
| 运行日志 | `~/Library/Logs/xiaobei-web/out.log`（stdout） |
| 访问令牌 | `apps/web/.env.local` 的 `XB_WEB_TOKEN`（0600，gitignored；浏览器 cookie `xb_token` 登录一次即可） |
| gateway token | 不落 web 任何文件：BFF 运行时从 `~/.openclaw/openclaw.json` 服务端解析 |

服务参数：`next start -H 127.0.0.1 -p 3000`（只绑本机回环）；不设 `RunAtLoad`/`KeepAlive`（不自启、崩溃不自动拉起，均为手动控制）。

## 二、部署过程记录

1. `next build` 生产构建（exit 0，27 条路由）
2. 仓内 `deploy/ai.xiaobei.web.plist` → 拷贝至 `~/Library/LaunchAgents/` → `plutil -lint` 通过
3. 停掉原手动 dev server（:3000 归属本项目的进程；:3001 与 :18789 未动）
4. `launchctl bootstrap gui/502 …` + `launchctl start ai.xiaobei.web`（uid=502）
5. 冒烟矩阵（见第四节）首次发现生产模式网关 API 全 500 → 排障与修复（第三节）→ 复检全绿

## 三、部署事故与修复（重要教训）

**现象**：生产模式下带令牌的网关 API 全部 500（握手 15s 超时），同代码 dev 模式正常。

**根因**：Next.js 生产构建把 `ws` 打进 server bundle，其内部引用的可选原生模块（`buffer-util`）被打碎——BFF 发送 connect 帧时抛 `TypeError: b.mask is not a function`，异常被吞后才落到 15s 握手超时。dev 模式（Turbopack 不打包 server 依赖）不复现。

**修复**（两处）：
1. `next.config.ts` 增加 `serverExternalPackages: ["ws"]`——让 ws 运行时从 node_modules 原生加载（根修）
2. `lib/gateway.ts` 握手加固：握手期错误 res 快速失败（原代码静默丢弃会干等 15s）+ connect 帧 send 包 try/catch（异常直接 reject 不再伪装成超时）

**排障教训**：launchd 服务的 stderr 若无输出，`err.log` 文件不会创建（勿以"文件不存在"推断"无错误"）；生产模式行为必须实测，dev 通过 ≠ 生产通过。

## 四、部署验证矩阵（launchd 服务实测）

| 用例 | 结果 |
|------|------|
| 页面 ×7（/ /config /publish /bd-ir /customers /videos /sessions） | 全 200 ✅ |
| 写 API 无令牌 ×8 | 全 401 ✅ |
| 读 API 无令牌 ×3 | 全 401 ✅ |
| 带令牌读（config/gateway / cron / config/crews，真实网关只读） | 全 200，快照正确（hash 5b0be2f6…、3 agents、openclaw-weixin、1 provider）✅ |
| POST /api/domain/ir/status 空 body | 400（校验护栏）✅ |
| :18789 gateway / launchd 服务状态 | 未受影响、running ✅ |
| tsc --noEmit | 0 error ✅ |

## 五、日常操作

```bash
# 启动（重启电脑后手动执行一次）
launchctl bootstrap gui/502 ~/Library/LaunchAgents/ai.xiaobei.web.plist 2>/dev/null; launchctl start ai.xiaobei.web

# 停止
launchctl bootout gui/502/ai.xiaobei.web

# 升级（代码更新后）
cd ~/Documents/Qoder/projects/xiaobei-web/apps/web && npx next build \
  && launchctl kickstart -k gui/502/ai.xiaobei.web

# 看日志
tail -f ~/Library/Logs/xiaobei-web/out.log
```

浏览器访问 `http://127.0.0.1:3000`，首次粘贴 `.env.local` 中的 `XB_WEB_TOKEN` 即登录。

## 六、回滚

- 服务回退：`launchctl bootout gui/502/ai.xiaobei.web`（恢复手动 dev：`cd apps/web && pnpm dev`）
- 代码回退：git 仓库按 commit 回退后重跑第五节升级命令

## 七、已知限制

- 未开机自启（用户选择）：重启电脑后需手动执行第五节启动命令
- 未设 KeepAlive：进程崩溃后需手动重启（可用 `launchctl print gui/502/ai.xiaobei.web | grep state` 检查，或直接访问 :3000 观察）
- 单租户本机形态；多租户 SaaS（Phase 4）需独立部署设计（授权已取得）
