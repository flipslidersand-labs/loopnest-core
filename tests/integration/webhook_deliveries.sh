#!/usr/bin/env bash
# M18: Webhook delivery log + manual retry
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Webhook Delivery Log Tests ==="
echo ""

DIR="$(cd "$(dirname "$0")" && pwd)"

MOCK_PORT="${MOCK_WEBHOOK_DELIVERY_PORT:-3994}"
MOCK_URL="http://localhost:$MOCK_PORT"
MOCK_PID=""

start_mock() {
  MOCK_WEBHOOK_PORT=$MOCK_PORT node "$DIR/mock-webhook.mjs" \
    > /tmp/loopnest-mock-webhook-delivery.log 2>&1 &
  MOCK_PID=$!
  until curl -s -m1 -o /dev/null "$MOCK_URL/health"; do
    kill -0 "$MOCK_PID" 2>/dev/null || { echo "mock-webhook failed to start"; cat /tmp/loopnest-mock-webhook-delivery.log; return 1; }
    sleep 0.3
  done
}
stop_mock() { [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null; MOCK_PID=""; }
trap stop_mock EXIT

start_mock || { fail "mock webhook server failed to start"; summary; exit 1; }

# ── Setup: org + webhook + trigger a delivery ────────────────────────────────
ORG=$(curl -s -X POST "$BASE_URL/organizations" \
  -H "Content-Type: application/json" \
  -d '{"name":"WD Test Org","type":"company"}' | jq -r '.data.id')
TOKEN=$(node "$DIR/gen-token.mjs" wd-admin admin 3600 "$ORG")
VIEWER_TOKEN=$(node "$DIR/gen-token.mjs" wd-viewer viewer 3600 "$ORG")

# Register a webhook pointing at the mock
WH_R=$(command curl -s \
  -H "Authorization: Bearer $TOKEN" \
  -X POST "$BASE_URL/webhooks" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$MOCK_URL\",\"events\":[\"*\"],\"secret\":\"wd-secret\"}")
WH_ID=$(echo "$WH_R" | jq -r '.data.id')
check "webhook created for delivery log test" "true" \
  "$([ -n "$WH_ID" ] && [ "$WH_ID" != "null" ] && echo true || echo false)"

# Create customer + quote so we can trigger a delivery
WD_CUST=$(command curl -s -X POST "$BASE_URL/customers" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"WD Corp"}' | jq -r '.data.id')
WD_QID=$(command curl -s -X POST "$BASE_URL/quotes" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"quoteNumber\":\"Q-WD-$(date +%s)-$RANDOM\",\"customerId\":\"$WD_CUST\",\"createdBy\":\"wd-tester\"}" | jq -r '.data.id')

command curl -s -X POST "$BASE_URL/workflow/quotes/$WD_QID/submit" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId":"wd-tester"}' > /dev/null

sleep 1

# ── 1. GET /webhooks/deliveries — list ───────────────────────────────────────
echo "List deliveries"
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/webhooks/deliveries")
check "GET /webhooks/deliveries → 200" "200" "$(http_code "$R")"
check "response has .data array" "true" \
  "$(http_body "$R" | jq 'has("data") and (.data | type == "array")')"
check "response has .total" "true" \
  "$(http_body "$R" | jq 'has("total")')"
check "at least one delivery logged" "true" \
  "$(http_body "$R" | jq '.total >= 1')"

DELIVERY_ID=$(http_body "$R" | jq -r '.data[0].id')
check "delivery id is uuid" "true" \
  "$(echo "$DELIVERY_ID" | grep -qE '^[0-9a-f-]{36}$' && echo true || echo false)"

# ── 2. Delivery record structure ─────────────────────────────────────────────
echo ""
echo "Delivery record structure"
ITEM=$(http_body "$R" | jq '.data[0]')
check "delivery has webhookId"    "true" "$(echo "$ITEM" | jq 'has("webhookId")')"
check "delivery has eventType"    "true" "$(echo "$ITEM" | jq 'has("eventType")')"
check "delivery has payload"      "true" "$(echo "$ITEM" | jq 'has("payload")')"
check "delivery has status"       "true" "$(echo "$ITEM" | jq 'has("status")')"
check "delivery has deliveredAt"  "true" "$(echo "$ITEM" | jq 'has("deliveredAt")')"
check "status is success or failed" "true" \
  "$(echo "$ITEM" | jq '.status == "success" or .status == "failed"')"
check "eventType is quote.submitted" "quote.submitted" \
  "$(echo "$ITEM" | jq -r '.eventType')"

# ── 3. Filter by webhookId ───────────────────────────────────────────────────
echo ""
echo "Filter by webhookId"
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/webhooks/deliveries?webhookId=$WH_ID")
check "filter ?webhookId → 200" "200" "$(http_code "$R")"
check "all results belong to webhook" "true" \
  "$(http_body "$R" | jq --arg id "$WH_ID" '[.data[].webhookId] | all(. == $id)')"

# ── 4. Filter by status ──────────────────────────────────────────────────────
echo ""
echo "Filter by status"
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/webhooks/deliveries?status=success")
check "filter ?status=success → 200" "200" "$(http_code "$R")"

R_BAD=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/webhooks/deliveries?status=bad_value")
check "filter ?status=bad_value → 400" "400" "$(http_code "$R_BAD")"

# ── 5. Filter by eventType ───────────────────────────────────────────────────
echo ""
echo "Filter by eventType"
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/webhooks/deliveries?eventType=quote.submitted")
check "filter ?eventType=quote.submitted → 200" "200" "$(http_code "$R")"
check "all results have expected eventType" "true" \
  "$(http_body "$R" | jq '[.data[].eventType] | all(. == "quote.submitted")')"

# ── 6. Pagination ────────────────────────────────────────────────────────────
echo ""
echo "Pagination"
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/webhooks/deliveries?limit=1&offset=0")
check "?limit=1 → 200" "200" "$(http_code "$R")"
check "?limit=1 returns exactly 1 item" "1" \
  "$(http_body "$R" | jq '.data | length')"

# ── 7. Viewer access ─────────────────────────────────────────────────────────
echo ""
echo "RBAC"
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  "$BASE_URL/webhooks/deliveries")
check "viewer GET /deliveries → 200" "200" "$(http_code "$R")"

# ── 8. Retry — success path ──────────────────────────────────────────────────
echo ""
echo "Retry"

# Grab the first success delivery
SUCCESS_DELIVERY_ID=$(command curl -s \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/webhooks/deliveries?status=success&limit=1" | jq -r '.data[0].id // empty')

if [ -n "$SUCCESS_DELIVERY_ID" ]; then
  R=$(command curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "$BASE_URL/webhooks/deliveries/$SUCCESS_DELIVERY_ID/retry" \
    -H "Content-Type: application/json")
  check "POST /deliveries/:id/retry → 200" "200" "$(http_code "$R")"
  check "retry response has .data.id" "true" \
    "$(http_body "$R" | jq 'has("data") and (.data | has("id"))')"
  check "retry response has status field" "true" \
    "$(http_body "$R" | jq '.data | has("status")')"
else
  echo "(skipped: no success delivery found for retry test)"
fi

# ── 9. Retry — non-existent delivery → 404 ──────────────────────────────────
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  -X POST "$BASE_URL/webhooks/deliveries/00000000-0000-0000-0000-000000000000/retry" \
  -H "Content-Type: application/json")
check "retry unknown delivery → 404" "404" "$(http_code "$R")"

# ── 10. Viewer cannot retry ──────────────────────────────────────────────────
if [ -n "$SUCCESS_DELIVERY_ID" ]; then
  R=$(command curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $VIEWER_TOKEN" \
    -X POST "$BASE_URL/webhooks/deliveries/$SUCCESS_DELIVERY_ID/retry" \
    -H "Content-Type: application/json")
  check "viewer POST retry → 403" "403" "$(http_code "$R")"
fi

stop_mock
summary
