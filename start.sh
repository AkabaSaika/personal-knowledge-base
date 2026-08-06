#!/bin/bash
# 一键启动：重建索引 → 启动本地静态服务 → 打开浏览器
# 用 HTTP 而非直接双击 html：Chrome 在 file:// 下会阻止加载 3D 模型等二进制资源。
set -u
cd "$(dirname "$0")"

echo "▸ 重建索引 …"
python3 scripts/build_index.py || echo "▸ 索引重建失败，继续用旧索引启动。"

PORT=8923

is_kb() {
  curl -sf --max-time 2 "http://127.0.0.1:$1/" | grep -q "个人知识库"
}

for _ in 1 2 3 4 5; do
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    if is_kb "$PORT"; then
      echo "▸ 端口 $PORT 已有知识库服务在运行，直接打开浏览器。"
      open "http://127.0.0.1:$PORT/"
      exit 0
    fi
    PORT=$((PORT + 1)) # 端口被其他程序占用，顺延重试
  else
    break
  fi
done

echo "▸ 服务地址 http://127.0.0.1:$PORT/ （按 Ctrl+C 停止）"
(sleep 0.8 && open "http://127.0.0.1:$PORT/") &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
