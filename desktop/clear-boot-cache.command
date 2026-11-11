#!/bin/bash
set -e
UD="$HOME/Library/Application Support/外贸智慧协同"
echo "正在清理客户端启动缓存（不影响账号与本地业务数据）…"
# 先退出客户端
osascript -e 'tell application "外贸智慧协同" to quit' 2>/dev/null || true
sleep 1
pkill -f '外贸智慧协同' 2>/dev/null || true
sleep 1
mkdir -p "$UD"
date +%s > "$UD/last-boot-failed"
echo recover > "$UD/boot-in-progress"
rm -rf "$UD/Cache" "$UD/Code Cache" "$UD/GPUCache" "$UD/DawnGraphiteCache" "$UD/DawnWebGPUCache" "$UD/DawnCache"
mkdir -p "$UD/Cache"
echo "完成。请重新打开「外贸智慧协同」。"
echo "也可先用浏览器打开：https://babyworld.ltd/?_boot=$(date +%s)"
read -n 1 -s -r -p "按任意键关闭…"
