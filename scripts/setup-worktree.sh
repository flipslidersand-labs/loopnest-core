#!/usr/bin/env bash
# Run once after `git worktree add` to restore pnpm workspace symlinks.
# Without this, @loopnest/* packages cannot be resolved in isolated worktrees
# because pnpm stores symlinks under the monorepo root node_modules.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Installing pnpm workspace dependencies in worktree…"
pnpm install --frozen-lockfile
echo "Done. You can now run tsc --noEmit from any workspace package."
