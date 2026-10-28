#!/bin/sh
# macOS / Linux 启动脚本：./start.sh [文件夹路径]
cd "$(dirname "$0")"
python3 server.py "$@"
