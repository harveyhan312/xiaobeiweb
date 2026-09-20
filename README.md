# xiaobei-web

xiaobei 引擎的可选 Web 控制台：聊天、快捷指令、任务通知、平台登录态监控。
独立程序，装也可不装；安装前提只有一个——本机已安装并启动过一次 xiaobei 引擎（引擎自带 portable Node）。

## 安装

<!-- release-base 由 T3（远端仓库 + CI）确定后替换，如 https://github.com/<org>/<repo>/releases/latest/download -->

```sh
curl -fsSL https://github.com/harveyhan312/xiaobeiweb/releases/latest/download/install-web.sh | sh
```

国内网络可加镜像线（下载源切 Gitee）：

```sh
curl -fsSL https://github.com/harveyhan312/xiaobeiweb/releases/latest/download/install-web.sh -o install-web.sh && sh install-web.sh --mirror
```

安装器会自动完成：检测引擎与 Node → 下载分平台产物并校验 SHA256 → 装到 `~/xiaobei-web` → 生成访问令牌 → 安装常驻服务（开机自启 + 崩溃自拉）→ 打印访问地址与令牌。

- 默认端口 3000，被占用时自动顺延（或 `--port N` 指定）
- 访问令牌存于 `~/.xiaobei-web/env.local`（0600），升级不会丢失
- 服务默认只监听 127.0.0.1（仅本机可访问）；远程访问属高级用法，需自行承担暴露风险

> **信任假设（curl | sh 安装方式）**：此模式信任发布渠道（HTTPS 官方仓库）与传输层。tarball 附 SHA256 校验，可防传输损坏与部分篡改场景；若需逐字节核验，请先下载脚本与产物检视后再手动执行。

## 升级

```sh
~/xiaobei-web/update-web.sh          # 或重新运行 install-web.sh，效果一致
```

停服务 → 换程序目录 → 起服务 → 健康检查；令牌与端口保留。

## 卸载

```sh
~/xiaobei-web/uninstall-web.sh               # 交互确认；保留令牌配置
~/xiaobei-web/uninstall-web.sh --purge-config # 连同 ~/.xiaobei-web 一起删除
```

卸载不触碰 `~/.openclaw`（引擎运行数据）。

## 平台支持

| 平台 | 状态 |
|---|---|
| macOS (arm64 / x64) | 一等支持，实测 |
| Linux (x64) | 一等支持，CI 验证 |
| Windows | 实验性（出包但不承诺，手动部署） |

## 与引擎的关系

xiaobei-web 只读 `~/.openclaw/openclaw.json` 获取 gateway 地址与令牌，经 WebSocket 与引擎通信；除此之外与引擎数据零耦合。引擎升级协议大版本时 web 需跟版（README 兼容矩阵随 release 发布）。
