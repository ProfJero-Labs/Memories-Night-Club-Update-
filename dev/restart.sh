#!/bin/sh
# Restart the local dev server in the background (pid in /tmp/memories-dev.pid).
[ -f /tmp/memories-dev.pid ] && kill "$(cat /tmp/memories-dev.pid)" 2>/dev/null
cd "$(dirname "$0")/.." && nohup node dev/server.mjs > /tmp/memories-dev.log 2>&1 &
echo $! > /tmp/memories-dev.pid
sleep 1.2
