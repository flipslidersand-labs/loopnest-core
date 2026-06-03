#!/usr/bin/env bash
# Apply all SQL migrations in lexical order against the target database.
#
# Every migration is written to be idempotent (CREATE ... IF NOT EXISTS,
# CREATE SEQUENCE IF NOT EXISTS), so re-running is safe.
#
# Connection comes from DATABASE_URL, e.g.
#   postgres://loopnest:loopnest_dev_password@localhost:5432/omni_local
# or from the individual PG* env vars that psql understands.
#
# Usage:
#   DATABASE_URL=postgres://... infra/migrations/run.sh
#   infra/migrations/run.sh /path/to/other/migrations
set -euo pipefail

MIGRATIONS_DIR="${1:-$(cd "$(dirname "$0")" && pwd)}"
DATABASE_URL="${DATABASE_URL:-postgres://loopnest:loopnest_dev_password@localhost:5432/omni_local}"

echo "Applying migrations from: $MIGRATIONS_DIR"

shopt -s nullglob
files=("$MIGRATIONS_DIR"/[0-9]*.sql)
if [ ${#files[@]} -eq 0 ]; then
  echo "No migration files found." >&2
  exit 1
fi

for f in "${files[@]}"; do
  echo "  → $(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "✅ Migrations applied (${#files[@]} files)"
