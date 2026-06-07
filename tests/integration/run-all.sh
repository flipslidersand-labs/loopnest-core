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
export JWT_SECRET="${JWT_SECRET:-loopnest_dev_secret}"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'

# Parse host:port out of DATABASE_URL / REDIS_URL for connectivity checks.
PG_HOST="$(printf '%s' "$DATABASE_URL" | sed -E 's#.*@([^:/]+):?([0-9]*)/.*#\1#')"
PG_PORT="$(printf '%s' "$DATABASE_URL" | sed -E 's#.*@[^:/]+:([0-9]+)/.*#\1#')"; PG_PORT="${PG_PORT:-5432}"
REDIS_HOST="$(printf '%s' "$REDIS_URL" | sed -E 's#redis://([^:/]+):?([0-9]*).*#\1#')"
REDIS_PORT="$(printf '%s' "$REDIS_URL" | sed -E 's#redis://[^:/]+:([0-9]+).*#\1#')"; REDIS_PORT="${REDIS_PORT:-6379}"

wait_tcp() { # host port label
  local waited=0
  until (exec 3<>"/dev/tcp/$1/$2") 2>/dev/null; do
    exec 3>&- 2>/dev/null || true
    waited=$((waited + 1))
    [ "$waited" -ge 60 ] && { echo "Timed out waiting for $3 ($1:$2)"; exit 1; }
    sleep 1
  done
  exec 3>&- 2>/dev/null || true
}

# Local dev runs against named docker containers we can start; CI provides
# postgres/redis as service containers already listening on localhost. Manage
# the named containers when present, otherwise just wait for connectivity.
ensure_containers() {
  if [ "${MANAGE_CONTAINERS:-auto}" != "no" ] && command -v docker >/dev/null 2>&1; then
    for c in loopnest-postgres loopnest-redis; do
      if docker inspect "$c" >/dev/null 2>&1 && [ -z "$(docker ps -q -f name="$c")" ]; then
        echo -e "${YELLOW}Starting $c...${NC}"
        docker start "$c" >/dev/null 2>&1
      fi
    done
  fi
  wait_tcp "$PG_HOST" "$PG_PORT" postgres
  wait_tcp "$REDIS_HOST" "$REDIS_PORT" redis
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
  # Fast outbox polling + point exports at the mock accounting API the
  # outbox_dispatch suite manages on :3001.
  EVENT_WORKER_INTERVAL_MS="${EVENT_WORKER_INTERVAL_MS:-1000}" \
  MOCK_ACCOUNTING_API_URL="${MOCK_ACCOUNTING_API_URL:-http://localhost:3991}" \
  OUTBOX_MAX_RETRIES="${OUTBOX_MAX_RETRIES:-50}" \
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

# Generate a long-lived admin token for the test run.
# All suites source lib.sh which injects it via the curl() wrapper.
export AUTH_TOKEN
AUTH_TOKEN=$(node "$ROOT/tests/integration/gen-token.mjs" itest-admin admin 7200)

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
  # auth first; quote_items + invoices before workflow suites; tenancy after auth; outbox_dispatch before rate_limit.
  SUITES=(observability auth tenancy e2e_workflow quote_items invoices outbox_dispatch approvals error_scenarios concurrency idempotency rate_limit)
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
