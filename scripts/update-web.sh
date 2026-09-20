#!/bin/sh
# xiaobei-web 升级脚本：拉新产物 → 停服务 → 换程序目录 → 起服务。
# 令牌/端口在 ~/.xiaobei-web/env.local（程序目录外），升级零保留负担（审核 R2）。
#
# 用法：./update-web.sh [--file 本地tarball路径] [--mirror]
# 红线：绝不写 ~/.openclaw。
set -eu

LABEL="${XB_WEB_LABEL:-ai.xiaobei.web}"
PROGRAM_DIR="$HOME/xiaobei-web"
CONFIG_DIR="$HOME/.xiaobei-web"
ENV_FILE="$CONFIG_DIR/env.local"
BASE_GH="${XB_WEB_RELEASE_BASE:-https://github.com/harveyhan312/xiaobeiweb/releases/latest/download}"
BASE_GITEE="${XB_WEB_RELEASE_BASE_GITEE:-https://gitee.com/harvey_han312/xiaobeiweb/releases/download/v0.2.0}"

FILE=""
MIRROR=0
while [ $# -gt 0 ]; do
  case "$1" in
    --file) FILE="$2"; shift 2 ;;
    --mirror) MIRROR=1; shift ;;
    *) echo "✗ 未知参数: $1" >&2; exit 1 ;;
  esac
done

say() { echo "· $*"; }
die() { echo "✗ $*" >&2; exit 1; }

[ -d "$PROGRAM_DIR" ] || die "未检测到已安装的 xiaobei-web（$PROGRAM_DIR 不存在），请先运行 install-web.sh"
[ -f "$ENV_FILE" ] || die "缺 $ENV_FILE，请先运行 install-web.sh"

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS/$ARCH" in
  Darwin/arm64) PLAT="mac-arm64" ;;
  Darwin/x86_64) PLAT="mac-x64" ;;
  Linux/x86_64) PLAT="linux-x64" ;;
  *) die "暂不支持的平台: $OS/$ARCH" ;;
esac

NODE_BIN=""
for cand in "$HOME/xiaobei/tools/node/bin/node" "$(command -v node 2>/dev/null || true)"; do
  [ -n "$cand" ] && [ -x "$cand" ] || continue
  if "$cand" -e 'process.exit(parseInt(process.versions.node, 10) >= 20 ? 0 : 1)'; then
    NODE_BIN="$cand"
    break
  fi
done
[ -n "$NODE_BIN" ] || die "未找到 Node.js ≥ 20"

# ---------- 下载 + 校验（与 install 一致）----------
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
    [ "$ACTUAL" = "$EXPECTED" ] || die "SHA256 校验失败"
    say "SHA256 校验通过"
  else
    die "校验文件（.sha256）不可达，拒绝升级。可用 --file 指定已校验的本地产物（审核 S1：校验为强制闸门）"
  fi
fi
say "解压 ..."
mkdir "$STAGING/pkg"
tar -xzf "$TARBALL" -C "$STAGING/pkg"
[ -f "$STAGING/pkg/server.js" ] || die "产物缺 server.js，tarball 结构异常"

# ---------- 停服务 ----------
say "停止服务 ..."
if [ "$OS" = "Darwin" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
else
  systemctl --user stop xiaobei-web 2>/dev/null || true
fi

# ---------- 换目录（先备份，成功后删；失败回滚）----------
OLD="${PROGRAM_DIR}.old.$$"
mv "$PROGRAM_DIR" "$OLD"
mv "$STAGING/pkg" "$PROGRAM_DIR"
if [ ! -f "$PROGRAM_DIR/server.js" ]; then
  rm -rf "$PROGRAM_DIR"
  mv "$OLD" "$PROGRAM_DIR"
  die "新产物不完整，已回滚（服务已停止，请重跑 update-web.sh）"
fi
rm -rf "$OLD"

# ---------- 重新生成 wrapper（node 路径可能变化）----------
PORT_FROM_ENV="$(grep '^XB_WEB_PORT=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
WRAPPER="$PROGRAM_DIR/start-web.sh"
cat > "$WRAPPER" <<EOF
#!/bin/sh
# 由 install-web.sh / update-web.sh 生成；端口/令牌改 $ENV_FILE 后重启服务
set -eu
CONFIG_DIR="$CONFIG_DIR"
. "\$CONFIG_DIR/env.local"
export XB_WEB_TOKEN
export PORT="\${XB_WEB_PORT:-3000}"
export HOSTNAME=127.0.0.1
exec "$NODE_BIN" "$PROGRAM_DIR/server.js"
EOF
chmod 700 "$WRAPPER"

# ---------- 起服务 + 健康检查 ----------
say "启动服务 ..."
if [ "$OS" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  [ -f "$PLIST" ] || die "launchd plist 缺失（$PLIST），请重跑 install-web.sh"
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
else
  systemctl --user start xiaobei-web
fi

HEALTH="http://127.0.0.1:${PORT_FROM_ENV:-3000}"
OK=""
i=0
while [ $i -lt 15 ]; do
  if curl -fsS -o /dev/null "$HEALTH" 2>/dev/null; then
    OK=1
    break
  fi
  sleep 1
  i=$((i + 1))
done
if [ -n "$OK" ]; then
  echo "✓ xiaobei-web 升级完成，健康检查通过：$HEALTH"
else
  echo "⚠ 升级完成但健康检查未通过，请查看日志" >&2
  if [ "$OS" = "Darwin" ]; then
    echo "  $HOME/Library/Logs/xiaobei-web/err.log" >&2
  else
    echo "  journalctl --user -u xiaobei-web" >&2
  fi
  exit 1
fi
