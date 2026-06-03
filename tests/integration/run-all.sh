#!/usr/bin/env bash
# Boot the API against the local docker stack and run every integration suite.
#
# Usage:
#   tests/integration/run-all.sh              # build, start server, run all suites
#   SKIP_BUILD=1 tests/integration/run-all.sh # reuse existing dist + running server
#   tests/integration/run-all.sh rate_limit   # run a single named suite
#
# Requires: docker (loopnest-postgres, loopnest-redis), node, jq, uuidgen.
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export DATABASE_URL="${DATABASE_URL:-postgres://loopnest:loopnest_dev_password@localhost:5432/omni_local}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export BASE_URL="${BASE_URL:-http://localhost:3000/api}"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'

ensure_containers() {
  for c in loopnest-postgres loopnest-redis; do
    if [ -z "$(docker ps -q -f name="$c")" ]; then
      echo -e "${YELLOW}Starting $c...${NC}"
      docker start "$c" >/dev/null 2>&1
    fi
  done
  # Wait for health.
  for c in loopnest-postgres loopnest-redis; do
    until [ "$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null)" = "healthy" ]; do
      sleep 1
    done
  done
}

apply_migrations() {
  echo "Applying migrations (idempotent)..."
  DATABASE_URL="$DATABASE_URL" bash "$ROOT/infra/migrations/run.sh" >/dev/null
}

SERVER_PID=""
start_server() {
  # Already up?
  if curl -s -m 2 -o /dev/null "http://localhost:3000/health"; then
    echo "Server already running."
    return
  fi
  echo "Starting API server..."
  node apps/api/dist/src/server.js > /tmp/loopnest-itest-server.log 2>&1 &
  SERVER_PID=$!
  until curl -s -m 2 -o /dev/null "http://localhost:3000/health"; do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo -e "${RED}Server failed to start. Log:${NC}"; tail -20 /tmp/loopnest-itest-server.log
      exit 1
    fi
    sleep 1
  done
}

cleanup() { [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null; }
trap cleanup EXIT

ensure_containers
apply_migrations

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "Building..."
  npm --prefix packages/bizcore-db run build >/dev/null 2>&1 || { echo "bizcore-db build failed"; exit 1; }
  npm --prefix apps/api run build >/dev/null 2>&1 || { echo "api build failed"; exit 1; }
fi

start_server

DIR="$(dirname "$0")"
if [ "$#" -gt 0 ]; then
  SUITES=("$@")
else
  SUITES=(observability e2e_workflow error_scenarios concurrency idempotency rate_limit)
fi

TOTAL_FAIL=0
for suite in "${SUITES[@]}"; do
  echo ""
  echo "################################################################"
  echo "# $suite"
  echo "################################################################"
  bash "$DIR/$suite.sh"
  [ $? -ne 0 ] && ((TOTAL_FAIL++))
done

echo ""
echo "================================================================"
if [ "$TOTAL_FAIL" -eq 0 ]; then
  echo -e "${GREEN}✅ All integration suites passed${NC}"
  exit 0
else
  echo -e "${RED}❌ $TOTAL_FAIL suite(s) failed${NC}"
  exit 1
fi
