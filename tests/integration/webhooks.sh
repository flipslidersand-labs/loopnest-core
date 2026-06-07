#!/usr/bin/env bash
# M10: Webhook delivery — CRUD registration, event delivery, HMAC signature.
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Webhook Tests ==="
echo ""

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"

MOCK_PORT="${MOCK_WEBHOOK_PORT:-3993}"
MOCK_URL="http://localhost:$MOCK_PORT"
MOCK_PID=""

start_mock() {
  MOCK_WEBHOOK_PORT=$MOCK_PORT node "$DIR/mock-webhook.mjs" \
    > /tmp/loopnest-mock-webhook.log 2>&1 &
  MOCK_PID=$!
  until curl -s -m1 -o /dev/null "$MOCK_URL/health"; do
    kill -0 "$MOCK_PID" 2>/dev/null || { echo "mock-webhook failed to start"; cat /tmp/loopnest-mock-webhook.log; return 1; }
    sleep 0.3
  done
}
stop_mock() {
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null
  MOCK_PID=""
}
trap stop_mock EXIT

start_mock || { fail "mock webhook server failed to start"; summary; exit 1; }

# ── Org + token for scoped tests ─────────────────────────────────────────────
ORG=$(curl -s -X POST "$BASE_URL/organizations" \
  -H "Content-Type: application/json" \
  -d '{"name":"Webhook Test Org","type":"company"}' | jq -r '.data.id')
TOKEN=$(node "$DIR/gen-token.mjs" wh-admin admin 3600 "$ORG")

# ── 1. CRUD: register ─────────────────────────────────────────────────────────
echo "CRUD"
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  -X POST "$BASE_URL/webhooks" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$MOCK_URL\",\"events\":[\"quote.submitted\",\"invoice.created\"],\"secret\":\"test-secret-123\"}")
check "POST /webhooks → 201" "201" "$(http_code "$R")"
WH_ID=$(http_body "$R" | jq -r '.data.id')
check "webhook id returned" "true" "$([ -n "$WH_ID" ] && [ "$WH_ID" != "null" ] && echo true || echo false)"
check "isActive=true on create" "true" "$(http_body "$R" | jq '.data.isActive')"
check "events stored" "2" "$(http_body "$R" | jq '.data.events | length')"

# bad URL
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  -X POST "$BASE_URL/webhooks" \
  -H "Content-Type: application/json" \
  -d '{"url":"not-a-url","events":["*"]}')
check "invalid URL → 400" "400" "$(http_code "$R")"

# missing events
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  -X POST "$BASE_URL/webhooks" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$MOCK_URL\",\"events\":[]}")
check "empty events → 400" "400" "$(http_code "$R")"

# ── 2. GET list ───────────────────────────────────────────────────────────────
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/webhooks")
check "GET /webhooks → 200" "200" "$(http_code "$R")"
check "list includes registered hook" "true" \
  "$(http_body "$R" | jq --arg id "$WH_ID" '[.data[].id] | contains([$id])')"

# ── 3. GET by id ──────────────────────────────────────────────────────────────
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/webhooks/$WH_ID")
check "GET /webhooks/:id → 200" "200" "$(http_code "$R")"
check "url matches" "$MOCK_URL" "$(http_body "$R" | jq -r '.data.url')"

# ── 4. PATCH ──────────────────────────────────────────────────────────────────
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  -X PATCH "$BASE_URL/webhooks/$WH_ID" \
  -H "Content-Type: application/json" \
  -d '{"events":["*"]}')
check "PATCH /webhooks/:id → 200" "200" "$(http_code "$R")"
check "events updated to wildcard" "1" "$(http_body "$R" | jq '.data.events | length')"

# ── 5. Org isolation: other org cannot see this webhook ───────────────────────
echo ""
echo "Org isolation"
OTHER_ORG=$(curl -s -X POST "$BASE_URL/organizations" \
  -H "Content-Type: application/json" \
  -d '{"name":"Other Org","type":"company"}' | jq -r '.data.id')
TOKEN_OTHER=$(node "$DIR/gen-token.mjs" other-admin admin 3600 "$OTHER_ORG")

R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN_OTHER" \
  "$BASE_URL/webhooks/$WH_ID")
check "other org GET webhook → 404" "404" "$(http_code "$R")"

LIST_OTHER=$(command curl -s -H "Authorization: Bearer $TOKEN_OTHER" "$BASE_URL/webhooks")
check "other org list excludes webhook" "false" \
  "$(echo "$LIST_OTHER" | jq --arg id "$WH_ID" '[.data[].id] | contains([$id])')"

# ── 6. Webhook delivery ───────────────────────────────────────────────────────
echo ""
echo "Delivery"

# Clear any previously received items
curl -s -X DELETE "$MOCK_URL/received" > /dev/null

# Register a wildcard webhook with a secret
R=$(command curl -s -X POST "$BASE_URL/webhooks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$MOCK_URL\",\"events\":[\"*\"],\"secret\":\"wh-secret-abc\"}")
WH_DELIVERY_ID=$(echo "$R" | jq -r '.data.id')

# Create customer + quote with the ORG-SCOPED token so organization_id is set.
# The global admin token has no orgId, so resources created via make_customer/make_quote
# have organization_id = NULL and assertOrgOwnsQuote would return 404.
WH_CUST=$(command curl -s -X POST "$BASE_URL/customers" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Webhook Delivery Corp"}' | jq -r '.data.id')
WH_QID=$(command curl -s -X POST "$BASE_URL/quotes" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"quoteNumber\":\"Q-WH-$(date +%s)-$RANDOM\",\"customerId\":\"$WH_CUST\",\"createdBy\":\"wh-test-user\"}" | jq -r '.data.id')

# Trigger quote.submitted
command curl -s -X POST "$BASE_URL/workflow/quotes/$WH_QID/submit" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId":"wh-test-user"}' > /dev/null

# Give the fire-and-forget delivery a moment to complete
sleep 1

RECV=$(curl -s "$MOCK_URL/received")
check "webhook delivery received ≥1 item" "true" \
  "$(echo "$RECV" | jq '.count >= 1')"
check "event type is quote.submitted" "true" \
  "$(echo "$RECV" | jq '[.items[].body.event] | contains(["quote.submitted"])')"
check "payload has quoteId" "true" \
  "$(echo "$RECV" | jq '[.items[] | select(.body.event=="quote.submitted")] | .[0].body.data.quoteId != null')"

# ── 7. HMAC signature ─────────────────────────────────────────────────────────
echo ""
echo "HMAC signature"
SIG=$(echo "$RECV" | jq -r '[.items[] | select(.body.event=="quote.submitted")] | .[0].headers["x-loopnest-signature"] // ""')
check "X-LoopNest-Signature header present" "true" "$([ -n "$SIG" ] && [ "$SIG" != "null" ] && echo true || echo false)"
check "signature starts with sha256=" "true" "$(echo "$SIG" | grep -q '^sha256=' && echo true || echo false)"

# ── 8. No delivery after deactivate ──────────────────────────────────────────
echo ""
echo "Deactivation"
# Deactivate both registered hooks so no active webhook is left for this org.
command curl -s -X PATCH "$BASE_URL/webhooks/$WH_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"isActive":false}' > /dev/null
command curl -s -X PATCH "$BASE_URL/webhooks/$WH_DELIVERY_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"isActive":false}' > /dev/null

curl -s -X DELETE "$MOCK_URL/received" > /dev/null

# trigger another event (org-scoped resources so the submit reaches the route)
WH_CUST2=$(command curl -s -X POST "$BASE_URL/customers" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Webhook Deactivate Corp"}' | jq -r '.data.id')
WH_QID2=$(command curl -s -X POST "$BASE_URL/quotes" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"quoteNumber\":\"Q-WH-DEACT-$(date +%s)-$RANDOM\",\"customerId\":\"$WH_CUST2\",\"createdBy\":\"wh-test-user\"}" | jq -r '.data.id')
command curl -s -X POST "$BASE_URL/workflow/quotes/$WH_QID2/submit" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId":"wh-test-user"}' > /dev/null
sleep 1

RECV2=$(curl -s "$MOCK_URL/received")
check "no delivery after deactivation" "0" "$(echo "$RECV2" | jq '.count')"

# ── 9. DELETE ─────────────────────────────────────────────────────────────────
echo ""
echo "DELETE"
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  -X DELETE "$BASE_URL/webhooks/$WH_ID")
check "DELETE /webhooks/:id → 200" "200" "$(http_code "$R")"

R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/webhooks/$WH_ID")
check "GET after delete → 404" "404" "$(http_code "$R")"

# ── 10. RBAC ──────────────────────────────────────────────────────────────────
echo ""
echo "RBAC"
VIEWER_TOKEN=$(node "$DIR/gen-token.mjs" wh-viewer viewer 3600 "$ORG")
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  "$BASE_URL/webhooks")
check "viewer GET /webhooks → 200" "200" "$(http_code "$R")"

R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -X POST "$BASE_URL/webhooks" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$MOCK_URL\",\"events\":[\"*\"]}")
check "viewer POST /webhooks → 403" "403" "$(http_code "$R")"

stop_mock
summary
