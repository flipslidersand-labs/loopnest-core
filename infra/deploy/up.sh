#!/usr/bin/env bash
# Bring up the LoopNest Core stack from scratch.
#
#   infra/deploy/up.sh             # infra (postgres+redis) + migrations
#   infra/deploy/up.sh --with-api  # also build & run the API container
#   infra/deploy/up.sh --fresh     # wipe volumes first (DESTROYS DATA)
#
# Uses docker-compose v1 or the docker compose v2 plugin, whichever exists.
# Migrations are applied with infra/migrations/run.sh (idempotent).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

DB_URL="postgres://loopnest:loopnest_dev_password@localhost:5432/omni_local"
WITH_API=0
FRESH=0
for arg in "$@"; do
  case "$arg" in
    --with-api) WITH_API=1 ;;
    --fresh) FRESH=1 ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# Pick a compose command.
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "Neither 'docker compose' nor 'docker-compose' is available." >&2
  exit 1
fi
echo "Using: $COMPOSE"

if [ "$FRESH" = "1" ]; then
  echo "Wiping volumes..."
  $COMPOSE down -v
fi

echo "Starting infra (postgres, redis)..."
$COMPOSE up -d postgres redis

echo "Waiting for postgres to be healthy..."
until [ "$(docker inspect -f '{{.State.Health.Status}}' loopnest-postgres 2>/dev/null)" = "healthy" ]; do
  sleep 1
done
echo "Waiting for redis to be healthy..."
until [ "$(docker inspect -f '{{.State.Health.Status}}' loopnest-redis 2>/dev/null)" = "healthy" ]; do
  sleep 1
done

echo "Applying migrations..."
DATABASE_URL="$DB_URL" bash infra/migrations/run.sh

if [ "$WITH_API" = "1" ]; then
  echo "Building API image..."
  docker build -f apps/api/Dockerfile -t loopnest-api .
  echo "Starting API container..."
  docker rm -f loopnest-api >/dev/null 2>&1 || true
  docker run -d --name loopnest-api \
    --network host \
    -e DATABASE_URL="$DB_URL" \
    -e REDIS_HOST=localhost -e REDIS_PORT=6379 \
    -e PORT=3000 \
    loopnest-api
  echo "Waiting for API /health..."
  until curl -s -m 2 -o /dev/null http://localhost:3000/health; do sleep 1; done
  echo "API up at http://localhost:3000"
fi

echo "✅ Stack is up."
