#!/bin/sh
# xiaobei-web 独立安装脚本（对齐 xiaobei 引擎 install.sh 的风格）
#
# 用法：
#   curl -fsSL <release-base>/install-web.sh | sh
#   ./install-web.sh [--port N] [--file 本地tarball路径] [--mirror]
#
# 行为：检测引擎与 Node → 下载并校验产物 → 装到 ~/xiaobei-web →
#       生成访问令牌（~/.xiaobei-web/env.local，0600）→ 安装常驻服务（自启+自拉）
#
# 红线：绝不写 ~/.openclaw（只读检测）。
set -eu

LABEL="${XB_WEB_LABEL:-ai.xiaobei.web}"
PROGRAM_DIR="$HOME/xiaobei-web"
CONFIG_DIR="$HOME/.xiaobei-web"
ENV_FILE="$CONFIG_DIR/env.local"
DEFAULT_PORT=3000
# 主仓 GitHub（harveyhan312/xiaobeiweb），Gitee 镜像同路径；可用环境变量覆盖
BASE_GH="${XB_WEB_RELEASE_BASE:-https://github.com/harveyhan312/xiaobeiweb/releases/latest/download}"
BASE_GITEE="${XB_WEB_RELEASE_BASE_GITEE:-https://gitee.com/harvey_han312/xiaobeiweb/releases/download/v0.2.0}"

PORT=""
FILE=""
MIRROR=0
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --file) FILE="$2"; shift 2 ;;
    --mirror) MIRROR=1; shift ;;
    *) echo "✗ 未知参数: $1" >&2; exit 1 ;;
  esac
done

say() { echo "· $*"; }
die() { echo "✗ $*" >&2; exit 1; }

# ---------- 平台 ----------
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS/$ARCH" in
  Darwin/arm64) PLAT="mac-arm64" ;;
  Darwin/x86_64) PLAT="mac-x64" ;;
  Linux/x86_64) PLAT="linux-x64" ;;
  MINGW*|MSYS*|Cywin*) die "Windows 为实验性支持，本脚本暂不覆盖；请按 README 手动部署" ;;
  *) die "暂不支持的平台: $OS/$ARCH" ;;
esac
say "平台: $PLAT"

# ---------- 引擎前置检测（审核 R4：可执行 或 openclaw.json 任一即可）----------
OPENCLAW_JSON="$HOME/.openclaw/openclaw.json"
ENGINE_BIN=""
[ -x "$HOME/xiaobei/bin/openclaw" ] && ENGINE_BIN="$HOME/xiaobei/bin/openclaw"
if [ -z "$ENGINE_BIN" ] && command -v openclaw >/dev/null 2>&1; then
  ENGINE_BIN="$(command -v openclaw)"
fi
if [ -z "$ENGINE_BIN" ] && [ ! -f "$OPENCLAW_JSON" ]; then
  echo "✗ 未检测到 xiaobei 引擎。" >&2
  echo "  xiaobei-web 是 xiaobei 的可选控制台，需引擎在本机运行。请先安装并启动一次 xiaobei。" >&2
  exit 1
fi
say "引擎检测: ${ENGINE_BIN:-$OPENCLAW_JSON}"

# ---------- Node 解析：引擎 portable node → 系统 node ≥ 20 ----------
NODE_BIN=""
for cand in "$HOME/xiaobei/tools/node/bin/node" "$(command -v node 2>/dev/null || true)"; do
  [ -n "$cand" ] && [ -x "$cand" ] || continue
  if "$cand" -e 'process.exit(parseInt(process.versions.node, 10) >= 20 ? 0 : 1)'; then
    NODE_BIN="$cand"
    break
  fi
done
[ -n "$NODE_BIN" ] || die "未找到 Node.js ≥ 20。请先安装 xiaobei（自带 portable node）或系统 Node。"
say "Node: $NODE_BIN ($("$NODE_BIN" -v))"

# ---------- 引擎初始化检测（装了未首跑 → gateway 令牌缺失，诚实报错）----------
if [ -f "$OPENCLAW_JSON" ]; then
  if ! "$NODE_BIN" -e '
    const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    process.exit(j.gateway && j.gateway.auth && j.gateway.auth.token ? 0 : 1);
  ' "$OPENCLAW_JSON"; then
    die "引擎已安装但未完成初始化（openclaw.json 缺 gateway.auth.token）。请先启动一次 xiaobei 引擎再安装 web。"
  fi
fi

# ---------- 下载 + SHA256 ----------
BASE="$BASE_GH"
[ "$MIRROR" = 1 ] && BASE="$BASE_GITEE"
STAGING="${PROGRAM_DIR}.staging.$$"
trap 'rm -rf "$STAGING"' EXIT INT TERM
mkdir -p "$STAGING"
TARBALL="$STAGING/xiaobei-web-$PLAT.tar.gz"
if [ -n "$FILE" ]; then
  [ -f "$FILE" ] || die "本地产物不存在: $FILE"
  cp "$FILE" "$TARBALL"
  say "使用本地产物: $FILE"
else
  say "下载 xiaobei-web ($PLAT) ..."
  curl -fL --progress-bar "$BASE/xiaobei-web-$PLAT.tar.gz" -o "$TARBALL" || die "下载失败（可试 --mirror 走 Gitee）"
  if curl -fsSL "$BASE/xiaobei-web-$PLAT.tar.gz.sha256" -o "$TARBALL.sha256" 2>/dev/null; then
    if command -v sha256sum >/dev/null 2>&1; then
      ACTUAL="$(sha256sum "$TARBALL" | cut -d' ' -f1)"
    else
      ACTUAL="$(shasum -a 256 "$TARBALL" | cut -d' ' -f1)"
    fi
    EXPECTED="$(cut -d' ' -f1 "$TARBALL.sha256" | head -1)"
    [ "$ACTUAL" = "$EXPECTED" ] || die "SHA256 校验失败（actual=$ACTUAL expected=$EXPECTED）"
    say "SHA256 校验通过"
  else
    die "校验文件（.sha256）不可达，拒绝安装。可用 --file 指定已校验的本地产物（审核 S1：校验为强制闸门）"
  fi
fi
say "解压 ..."
mkdir "$STAGING/pkg"
tar -xzf "$TARBALL" -C "$STAGING/pkg"
[ -f "$STAGING/pkg/server.js" ] || die "产物缺 server.js，tarball 结构异常"

# ---------- 换装程序目录（旧版备份，成功后删）----------
OLD="${PROGRAM_DIR}.old.$$"
[ -d "$PROGRAM_DIR" ] && mv "$PROGRAM_DIR" "$OLD"
mv "$STAGING/pkg" "$PROGRAM_DIR"
if [ -d "$OLD" ]; then
  if [ -f "$PROGRAM_DIR/server.js" ]; then
    rm -rf "$OLD"
  else
    mv "$OLD" "$PROGRAM_DIR"
    die "新产物不完整，已回滚"
  fi
fi

# ---------- 访问令牌（外置 ~/.xiaobei-web/env.local，0600；审核 R2）----------
mkdir -p "$CONFIG_DIR"
TOKEN=""
if [ -f "$ENV_FILE" ] && grep -q '^XB_WEB_TOKEN=' "$ENV_FILE"; then
  TOKEN="$(grep '^XB_WEB_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
  say "保留既有访问令牌"
else
  TOKEN="$("$NODE_BIN" -e 'console.log(require("crypto").randomBytes(32).toString("base64url"))')"
fi

# ---------- 端口（--port 或从 3000 起找空闲；审核 R3）----------
if [ -z "$PORT" ]; then
  PORT="$DEFAULT_PORT"
  while lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do
    PORT=$((PORT + 1))
  done
fi

# 写 env.local：保留 TOKEN 行，刷新 PORT 行
ENV_TMP="$ENV_FILE.tmp.$$"
if [ -f "$ENV_FILE" ]; then
  grep -v '^XB_WEB_PORT=' "$ENV_FILE" > "$ENV_TMP" || true
else
  printf '# xiaobei-web 本机配置（含访问令牌，勿外传）\n' > "$ENV_TMP"
fi
grep -q '^XB_WEB_TOKEN=' "$ENV_TMP" || printf 'XB_WEB_TOKEN=%s\n' "$TOKEN" >> "$ENV_TMP"
grep -q '^XB_WEB_TOKEN=' "$ENV_TMP" || die "令牌写入失败"
printf 'XB_WEB_PORT=%s\n' "$PORT" >> "$ENV_TMP"
mv "$ENV_TMP" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# ---------- 启动 wrapper（PORT/HOSTNAME env 注入；standalone server.js 无 -p/-H）----------
WRAPPER="$PROGRAM_DIR/start-web.sh"
cat > "$WRAPPER" <<EOF
#!/bin/sh
# 由 install-web.sh 生成，升级时会覆盖；端口/令牌改 \$CONFIG_DIR/env.local 后重启服务
set -eu
CONFIG_DIR="$CONFIG_DIR"
. "\$CONFIG_DIR/env.local"
export XB_WEB_TOKEN
export PORT="\${XB_WEB_PORT:-$DEFAULT_PORT}"
export HOSTNAME=127.0.0.1
exec "$NODE_BIN" "$PROGRAM_DIR/server.js"
EOF
chmod 700 "$WRAPPER"

# ---------- 常驻服务（自启 RunAtLoad / 崩溃自拉 KeepAlive；审核 R1）----------
if [ "$OS" = "Darwin" ]; then
  LOG_DIR="$HOME/Library/Logs/xiaobei-web"
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  mkdir -p "$LOG_DIR" "$(dirname "$PLIST")"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>$WRAPPER</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$PROGRAM_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/out.log</string>
  <key>StandardErrPath</key>
  <string>$LOG_DIR/err.log</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  say "launchd 服务已安装（RunAtLoad + KeepAlive，路径按实际安装位置生成）"
else
  UNIT_DIR="$HOME/.config/systemd/user"
  UNIT="$UNIT_DIR/xiaobei-web.service"
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT" <<EOF
[Unit]
Description=xiaobei-web console
After=network.target

[Service]
ExecStart=$WRAPPER
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now xiaobei-web
  say "systemd 用户服务已安装（enable --now + Restart=always）"
fi

echo ""
echo "✓ xiaobei-web 安装完成"
echo "  访问:  http://127.0.0.1:$PORT"
echo "  令牌:  $TOKEN"
echo "         （已存 $ENV_FILE，浏览器首次打开时粘贴一次即可）"
if [ "$OS" = "Darwin" ]; then
  echo "  日志:  $HOME/Library/Logs/xiaobei-web/"
fi
echo "  升级:  重新运行本脚本或 update-web.sh"
echo "  卸载:  uninstall-web.sh"
