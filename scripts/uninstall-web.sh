#!/bin/sh
# xiaobei-web 卸载脚本：停服务 → 删程序目录 →（可选）删配置目录。
# 红线：绝不触碰 ~/.openclaw（引擎运行数据）。
#
# 用法：./uninstall-web.sh [--yes] [--purge-config]
#   --yes          非交互（跳过确认）
#   --purge-config 同时删除 ~/.xiaobei-web（访问令牌等）
set -eu

LABEL="${XB_WEB_LABEL:-ai.xiaobei.web}"
PROGRAM_DIR="$HOME/xiaobei-web"
CONFIG_DIR="$HOME/.xiaobei-web"

ASSUME_YES=0
PURGE_CONFIG=0
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) ASSUME_YES=1; shift ;;
    --purge-config) PURGE_CONFIG=1; shift ;;
    *) echo "✗ 未知参数: $1" >&2; exit 1 ;;
  esac
done

say() { echo "· $*"; }

confirm() {
  [ "$ASSUME_YES" = 1 ] && return 0
  printf "%s [y/N] " "$1"
  read -r ans
  [ "$ans" = "y" ] || [ "$ans" = "Y" ]
}

if [ "$PURGE_CONFIG" = 1 ] && [ "$ASSUME_YES" != 1 ]; then
  confirm "将同时删除 $CONFIG_DIR（含访问令牌），确定?" || PURGE_CONFIG=0
fi
if [ "$ASSUME_YES" != 1 ]; then
  confirm "卸载 xiaobei-web（$PROGRAM_DIR + 常驻服务）?" || exit 0
fi

OS="$(uname -s)"

say "停止并移除常驻服务 ..."
if [ "$OS" = "Darwin" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
else
  systemctl --user disable --now xiaobei-web 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/xiaobei-web.service"
  systemctl --user daemon-reload 2>/dev/null || true
fi

if [ -d "$PROGRAM_DIR" ]; then
  say "删除程序目录 $PROGRAM_DIR ..."
  rm -rf "$PROGRAM_DIR"
else
  say "程序目录不存在，跳过"
fi

if [ "$PURGE_CONFIG" = 1 ] && [ -d "$CONFIG_DIR" ]; then
  say "删除配置目录 $CONFIG_DIR ..."
  rm -rf "$CONFIG_DIR"
else
  say "保留配置目录 $CONFIG_DIR（含访问令牌；手动删除: rm -rf $CONFIG_DIR）"
fi

echo "✓ xiaobei-web 已卸载（未触碰 ~/.openclaw）"
