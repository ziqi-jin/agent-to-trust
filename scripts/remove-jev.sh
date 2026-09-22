#!/usr/bin/env bash
# 摘除 Jev 判官交叉校验（幂等）。用法：bash scripts/remove-jev.sh [--dry-run]
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DRY=""
[ "${1:-}" = "--dry-run" ] && DRY="echo"

run() { if [ -n "$DRY" ]; then echo "DRY: $*"; else eval "$@"; fi; }

run "rm -rf '$REPO/packages/jev'"
run "rm -f '$REPO/apps/dashboard/components/JevCrosscheck.tsx'"
run "rm -f '$REPO/apps/dashboard/public/labs/jev-crosscheck.json'"
run "rmdir '$REPO/apps/dashboard/public/labs' '$REPO/apps/dashboard/public' 2>/dev/null || true"
run "rm -f '$REPO/docs/jev.md'"
run "rm -f '$REPO/experiments/jev-judge-crosscheck/report.md'"
run "rmdir '$REPO/experiments/jev-judge-crosscheck' 2>/dev/null || true"

cat <<'EOF'
[手动确认项]
1. apps/dashboard/app/page.tsx：删除 `import { JevCrosscheck } ...` 与 `<JevCrosscheck />` 两行
2. package.json (root)：从 test/typecheck 脚本移除 `@a2t/jev`
3. README.md / README.zh-CN.md：删除「Jev cross-check / 判官交叉校验」节
4. CHANGELOG.md：删除 Added — Jev judge cross-check 条目
5. packages/sdk/package.json：keywords 去掉 jev/typesafe（可选）
6. 去 topics：gh repo edit ziqi-jin/agent-to-trust --remove-topic jev,typesafe,llm-evaluation,llm
7. 重跑：npm test（确认全绿）
EOF
