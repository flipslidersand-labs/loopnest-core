#!/usr/bin/env bash
# Integration tests: webhook security (Issue #125 / M29)
# Tests: GET authz, secret validation, auto-generated secret, empty-secret rejection
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Webhook Security Tests ==="
echo ""

# ── Setup: create a webhook (editor role via AUTH_TOKEN) ──────────────────────

REG_RESP=$(curl -s -X POST "$BASE_URL/webhooks" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/hook","events":["invoice.created"]}')
HOOK_ID=$(echo "$REG_RESP" | jq -r '.data.id // empty')
AUTO_SECRET=$(echo "$REG_RESP" | jq -r '.secret // empty')

check "webhook created" "true" "$([ -n \"$HOOK_ID\" ] && echo true || echo false)"
check "secret auto-generated on POST" "true" "$([ -n \"$AUTO_SECRET\" ] && echo true || echo false)"
check "auto-generated secret >= 64 chars" "true" "$([ ${#AUTO_SECRET} -ge 64 ] && echo true || echo false)"

if [ -z "$HOOK_ID" ]; then
  echo "Cannot proceed without webhook — skipping remaining tests"
  summary
  exit 0
fi

# ── GET endpoints require authentication ──────────────────────────────────────

echo "GET / without auth → 401"
STATUS=$(command curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/webhooks")
check "GET /webhooks without auth → 401" "401" "$STATUS"

echo "GET /:id without auth → 401"
STATUS=$(command curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/webhooks/$HOOK_ID")
check "GET /webhooks/:id without auth → 401" "401" "$STATUS"

echo "GET /deliveries without auth → 401"
STATUS=$(command curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/webhooks/deliveries")
check "GET /webhooks/deliveries without auth → 401" "401" "$STATUS"

# ── GET endpoints work for viewer+ ───────────────────────────────────────────

echo "GET / with auth → 200"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/webhooks")
check "GET /webhooks with auth → 200" "200" "$STATUS"

echo "GET /:id with auth → 200"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/webhooks/$HOOK_ID")
check "GET /webhooks/:id with auth → 200" "200" "$STATUS"

# ── Secret validation: empty string ───────────────────────────────────────────

echo "POST with empty secret → 400"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/webhooks" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/hook2","events":["invoice.created"],"secret":""}')
check "POST with empty secret → 400" "400" "$STATUS"

# ── Secret validation: too short ──────────────────────────────────────────────

echo "POST with short secret → 400"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/webhooks" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/hook3","events":["invoice.created"],"secret":"short"}')
check "POST with secret < 16 chars → 400" "400" "$STATUS"

# ── Secret validation: valid explicit secret ──────────────────────────────────

echo "POST with valid explicit secret → 201"
EXPLICIT_RESP=$(curl -s -X POST "$BASE_URL/webhooks" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/hook4","events":["invoice.created"],"secret":"this-is-a-valid-secret-key-32ch"}')
check "POST with valid explicit secret → id present" \
  "true" "$(echo "$EXPLICIT_RESP" | jq 'has("data") and (.data.id != null)')"
check "POST with explicit secret → secret echoed back" \
  "this-is-a-valid-secret-key-32ch" "$(echo "$EXPLICIT_RESP" | jq -r '.secret // empty')"

# ── PATCH: empty secret rejected ──────────────────────────────────────────────

echo "PATCH with empty secret → 400"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE_URL/webhooks/$HOOK_ID" \
  -H "Content-Type: application/json" \
  -d '{"secret":""}')
check "PATCH with empty secret → 400" "400" "$STATUS"

echo ""
summary
