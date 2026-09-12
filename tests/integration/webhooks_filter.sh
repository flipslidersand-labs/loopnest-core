#!/usr/bin/env bash
# M28 / Issue #105: Webhook event-type filtering & contract pause/resume delivery
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Webhook Filter Tests ==="
echo ""

DIR="$(cd "$(dirname "$0")" && pwd)"

MOCK_PORT="${MOCK_WEBHOOK_PORT2:-3994}"
MOCK_URL="http://localhost:$MOCK_PORT"
MOCK_PID=""

start_mock() {
  MOCK_WEBHOOK_PORT=$MOCK_PORT node "$DIR/mock-webhook.mjs" \
    > /tmp/loopnest-mock-wh-filter.log 2>&1 &
  MOCK_PID=$!
  until curl -s -m1 -o /dev/null "$MOCK_URL/health"; do
    kill -0 "$MOCK_PID" 2>/dev/null || { echo "mock-webhook failed to start"; cat /tmp/loopnest-mock-wh-filter.log; return 1; }
    sleep 0.3
  done
}
stop_mock() {
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null
  MOCK_PID=""
}
trap stop_mock EXIT

start_mock || { fail "mock webhook server failed to start"; summary; exit 1; }

# ── Org + token ────────────────────────────────────────────────────────────────
ORG=$(curl -s -X POST "$BASE_URL/organizations" \
  -H "Content-Type: application/json" \
  -d '{"name":"WH Filter Org","type":"company"}' | jq -r '.data.id')
TOKEN=$(node "$DIR/gen-token.mjs" wh-filter-admin admin 3600 "$ORG")

# ── 1. GET /event-types returns all valid types ───────────────────────────────
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/webhooks/event-types")
check "GET /webhooks/event-types → 200" "200" "$(http_code "$R")"
check "event-types count = 14" "14" "$(http_body "$R" | jq '.data | length')"
check "contract.paused present" "true" "$(http_body "$R" | jq '.data | contains(["contract.paused"])')"
check "contract.resumed present" "true" "$(http_body "$R" | jq '.data | contains(["contract.resumed"])')"

# ── 2. POST /webhooks rejects unknown event type ──────────────────────────────
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  -X POST "$BASE_URL/webhooks" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$MOCK_URL\",\"events\":[\"invoice.created\",\"unknown.event\"]}")
check "POST with invalid event → 400" "400" "$(http_code "$R")"
check "error mentions invalid type" "true" "$(http_body "$R" | jq -r '.message' | grep -qi 'unknown.event' && echo true || echo false)"

# ── 3. POST /webhooks with valid events ───────────────────────────────────────
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  -X POST "$BASE_URL/webhooks" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$MOCK_URL\",\"events\":[\"contract.paused\",\"contract.resumed\"],\"secret\":\"filter-secret-abcdef12\"}")
check "POST with valid events → 201" "201" "$(http_code "$R")"
WH_ID=$(http_body "$R" | jq -r '.data.id')
check "webhook id returned" "true" "$([ -n "$WH_ID" ] && [ "$WH_ID" != "null" ] && echo true || echo false)"
check "events stored correctly" "2" "$(http_body "$R" | jq '.data.events | length')"

# ── 4. PATCH /webhooks/:id rejects invalid event on update ───────────────────
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  -X PATCH "$BASE_URL/webhooks/$WH_ID" \
  -H "Content-Type: application/json" \
  -d '{"events":["invoice.paid","bad.type"]}')
check "PATCH with invalid event → 400" "400" "$(http_code "$R")"

# ── 5. PATCH /webhooks/:id with valid events succeeds ────────────────────────
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  -X PATCH "$BASE_URL/webhooks/$WH_ID" \
  -H "Content-Type: application/json" \
  -d '{"events":["contract.paused","contract.resumed","invoice.created"]}')
check "PATCH with valid events → 200" "200" "$(http_code "$R")"
check "updated events count = 3" "3" "$(http_body "$R" | jq '.data.events | length')"

# ── 6. contract.paused event fired on pause ───────────────────────────────────
CUST=$(curl -s -X POST "$BASE_URL/customers" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"WH Filter Customer","email":"wf@example.com","type":"business"}' | jq -r '.data.id')

CONTRACT_R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  -X POST "$BASE_URL/recurring-contracts" \
  -H "Content-Type: application/json" \
  -d "{\"customerId\":\"$CUST\",\"name\":\"WH Filter Contract\",\"intervalUnit\":\"month\",\"intervalValue\":1,\"amount\":1000,\"startsAt\":\"2026-01-01\"}")
check "create contract → 201" "201" "$(http_code "$CONTRACT_R")"
CONTRACT_ID=$(http_body "$CONTRACT_R" | jq -r '.data.id')

# Reset mock received list before pause
curl -s -X DELETE "$MOCK_URL/received" >/dev/null 2>&1

# Pause the contract (should trigger contract.paused webhook)
PAUSE_R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  -X PATCH "$BASE_URL/recurring-contracts/$CONTRACT_ID/pause" \
  -H "Content-Type: application/json" \
  -d '{"reason":"billing review"}')
check "pause contract → 200" "200" "$(http_code "$PAUSE_R")"

# Give EventWorker a moment to dispatch
sleep 2

MOCK_RECEIVED=$(curl -s "$MOCK_URL/received")
check "contract.paused delivered to webhook" "true" \
  "$(echo "$MOCK_RECEIVED" | jq '[.items[].body.event] | contains(["contract.paused"])' 2>/dev/null || echo false)"

# Resume and check contract.resumed
curl -s -X DELETE "$MOCK_URL/received" >/dev/null 2>&1

RESUME_R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  -X PATCH "$BASE_URL/recurring-contracts/$CONTRACT_ID/resume" \
  -H "Content-Type: application/json")
check "resume contract → 200" "200" "$(http_code "$RESUME_R")"

sleep 2

MOCK_RECEIVED=$(curl -s "$MOCK_URL/received")
check "contract.resumed delivered to webhook" "true" \
  "$(echo "$MOCK_RECEIVED" | jq '[.items[].body.event] | contains(["contract.resumed"])' 2>/dev/null || echo false)"

summary
