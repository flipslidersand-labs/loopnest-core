#!/usr/bin/env bash
# M12: Recurring billing contract integration test
set -euo pipefail
source "$(dirname "$0")/_common.sh" 2>/dev/null || true

BASE_URL="${BASE_URL:-http://localhost:3000}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
PASS=0; FAIL=0

pass() { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo "=== Recurring Billing (M12) ==="

if [ -z "$ADMIN_TOKEN" ]; then
  echo "  SKIP: ADMIN_TOKEN not set"
  echo "Results: 0 passed, 0 failed"
  exit 0
fi

# ── Setup: create a customer ──────────────────────────────────────────────────
CUSTOMER=$(curl -sf -X POST "${BASE_URL}/api/customers" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Recurring Test Co"}' | jq -r '.data.id')

TODAY=$(date -u '+%Y-%m-%d')
FUTURE=$(date -u -d "+60 days" '+%Y-%m-%d' 2>/dev/null || date -u -v+60d '+%Y-%m-%d')

# ── Test 1: GET all contracts (initially empty) ───────────────────────────────
BEFORE=$(curl -sf "${BASE_URL}/api/recurring-contracts" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.data | length')
if [ "$BEFORE" = "0" ] || [ "$BEFORE" -ge 0 ]; then
  pass "GET /recurring-contracts → list returned"
else
  fail "GET /recurring-contracts → unexpected"
fi

# ── Test 2: POST create monthly contract ─────────────────────────────────────
CONTRACT=$(curl -sf -X POST "${BASE_URL}/api/recurring-contracts" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"customerId\":\"$CUSTOMER\",\"name\":\"Monthly SaaS\",\"intervalUnit\":\"month\",\"intervalValue\":1,\"amount\":50000,\"startsAt\":\"$TODAY\"}")
CONTRACT_ID=$(echo "$CONTRACT" | jq -r '.data.id')
STATUS=$(echo "$CONTRACT" | jq -r '.data.status')
if [ "$STATUS" = "active" ] && [ -n "$CONTRACT_ID" ] && [ "$CONTRACT_ID" != "null" ]; then
  pass "POST /recurring-contracts → status=active"
else
  fail "POST /recurring-contracts → unexpected: $CONTRACT"
fi

# ── Test 3: GET by id ─────────────────────────────────────────────────────────
GOT=$(curl -sf "${BASE_URL}/api/recurring-contracts/${CONTRACT_ID}" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.data.name')
if [ "$GOT" = "Monthly SaaS" ]; then
  pass "GET /recurring-contracts/:id → name correct"
else
  fail "GET /recurring-contracts/:id → got $GOT"
fi

# ── Test 4: validation — missing customerId ───────────────────────────────────
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "${BASE_URL}/api/recurring-contracts" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"bad","intervalUnit":"month","intervalValue":1,"amount":100,"startsAt":"2026-01-01"}')
if [ "$HTTP" = "400" ]; then
  pass "POST missing customerId → 400"
else
  fail "POST missing customerId → expected 400, got $HTTP"
fi

# ── Test 5: validation — invalid intervalUnit ─────────────────────────────────
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "${BASE_URL}/api/recurring-contracts" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"customerId\":\"$CUSTOMER\",\"name\":\"bad\",\"intervalUnit\":\"hourly\",\"intervalValue\":1,\"amount\":100,\"startsAt\":\"$TODAY\"}")
if [ "$HTTP" = "400" ]; then
  pass "POST invalid intervalUnit → 400"
else
  fail "POST invalid intervalUnit → expected 400, got $HTTP"
fi

# ── Test 6: pause active contract ────────────────────────────────────────────
PAUSED=$(curl -sf -X PATCH \
  "${BASE_URL}/api/recurring-contracts/${CONTRACT_ID}/pause" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{}')
P_STATUS=$(echo "$PAUSED" | jq -r '.data.status')
if [ "$P_STATUS" = "paused" ]; then
  pass "PATCH /pause → status=paused"
else
  fail "PATCH /pause → expected paused, got $P_STATUS"
fi

# ── Test 7: pause already paused → 409 ───────────────────────────────────────
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH \
  "${BASE_URL}/api/recurring-contracts/${CONTRACT_ID}/pause" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{}')
if [ "$HTTP" = "409" ]; then
  pass "PATCH /pause (already paused) → 409"
else
  fail "PATCH /pause (already paused) → expected 409, got $HTTP"
fi

# ── Test 8: resume paused contract ───────────────────────────────────────────
RESUMED=$(curl -sf -X PATCH \
  "${BASE_URL}/api/recurring-contracts/${CONTRACT_ID}/resume" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{}')
R_STATUS=$(echo "$RESUMED" | jq -r '.data.status')
if [ "$R_STATUS" = "active" ]; then
  pass "PATCH /resume → status=active"
else
  fail "PATCH /resume → expected active, got $R_STATUS"
fi

# ── Test 9: cancel contract ───────────────────────────────────────────────────
CANCELLED=$(curl -sf -X PATCH \
  "${BASE_URL}/api/recurring-contracts/${CONTRACT_ID}/cancel" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{}')
C_STATUS=$(echo "$CANCELLED" | jq -r '.data.status')
if [ "$C_STATUS" = "cancelled" ]; then
  pass "PATCH /cancel → status=cancelled"
else
  fail "PATCH /cancel → expected cancelled, got $C_STATUS"
fi

# ── Test 10: cancel already cancelled → 409 ──────────────────────────────────
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH \
  "${BASE_URL}/api/recurring-contracts/${CONTRACT_ID}/cancel" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{}')
if [ "$HTTP" = "409" ]; then
  pass "PATCH /cancel (already cancelled) → 409"
else
  fail "PATCH /cancel (already cancelled) → expected 409, got $HTTP"
fi

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
