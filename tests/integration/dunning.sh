#!/usr/bin/env bash
# M15: Dunning management integration tests
set -euo pipefail
source "$(dirname "$0")/lib.sh" 2>/dev/null || true

BASE_URL="${BASE_URL:-http://localhost:3000/api}"
PASS=0; FAIL=0
pass() { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo "=== Dunning Management (M15) ==="

# ── Test 1: GET /api/dunning-rules — seeded rules exist ─────────────────────
RULES=$(curl -sf "${BASE_URL}/dunning-rules" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" | jq '.data | length')
if [ "$RULES" -ge 5 ]; then
  pass "GET /dunning-rules → seeded rules returned (${RULES})"
else
  fail "GET /dunning-rules → expected ≥5 seeded rules, got ${RULES}"
fi

# ── Test 2: GET with ?active=true ────────────────────────────────────────────
ACTIVE=$(curl -sf "${BASE_URL}/dunning-rules?active=true" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" | jq '.data | length')
if [ "$ACTIVE" -ge 1 ]; then
  pass "GET /dunning-rules?active=true → ${ACTIVE} active rule(s)"
else
  fail "GET /dunning-rules?active=true → expected ≥1"
fi

# ── Test 3: POST create a custom rule ────────────────────────────────────────
NEW_RULE=$(curl -sf -X POST "${BASE_URL}/dunning-rules" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test rule","daysOverdue":45,"action":"warning","messageTemplate":"Test {{invoice_number}}"}')
RULE_ID=$(echo "$NEW_RULE" | jq -r '.data.id')
if [ -n "$RULE_ID" ] && [ "$RULE_ID" != "null" ]; then
  pass "POST /dunning-rules → created rule id=${RULE_ID}"
else
  fail "POST /dunning-rules → $(echo "$NEW_RULE")"
fi

# ── Test 4: GET by id ────────────────────────────────────────────────────────
GOT=$(curl -sf "${BASE_URL}/dunning-rules/${RULE_ID}" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" | jq -r '.data.name')
if [ "$GOT" = "Test rule" ]; then
  pass "GET /dunning-rules/:id → name correct"
else
  fail "GET /dunning-rules/:id → got ${GOT}"
fi

# ── Test 5: POST validation — missing name ───────────────────────────────────
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/dunning-rules" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"daysOverdue":5}')
if [ "$HTTP" = "400" ]; then
  pass "POST missing name → 400"
else
  fail "POST missing name → expected 400, got ${HTTP}"
fi

# ── Test 6: POST validation — invalid action ─────────────────────────────────
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/dunning-rules" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name":"bad","daysOverdue":5,"action":"nuke"}')
if [ "$HTTP" = "400" ]; then
  pass "POST invalid action → 400"
else
  fail "POST invalid action → expected 400, got ${HTTP}"
fi

# ── Test 7: POST duplicate (same daysOverdue + action) → 409 ─────────────────
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/dunning-rules" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name":"dup","daysOverdue":45,"action":"warning"}')
if [ "$HTTP" = "409" ]; then
  pass "POST duplicate rule → 409"
else
  fail "POST duplicate rule → expected 409, got ${HTTP}"
fi

# ── Test 8: PATCH update rule ────────────────────────────────────────────────
PATCHED=$(curl -sf -X PATCH "${BASE_URL}/dunning-rules/${RULE_ID}" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name":"Updated rule","isActive":false}')
P_NAME=$(echo "$PATCHED" | jq -r '.data.name')
P_ACTIVE=$(echo "$PATCHED" | jq -r '.data.isActive')
if [ "$P_NAME" = "Updated rule" ] && [ "$P_ACTIVE" = "false" ]; then
  pass "PATCH /dunning-rules/:id → name+isActive updated"
else
  fail "PATCH /dunning-rules/:id → got name=${P_NAME} isActive=${P_ACTIVE}"
fi

# ── Test 9: GET /invoices/:id/dunning-logs — endpoint smoke test ──────────────
# Use a deterministic UUID; endpoint returns [] for unknown invoiceId (no FK check on SELECT)
FAKE_INV_ID="00000000-0000-0000-0000-000000000099"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
  "${BASE_URL}/invoices/${FAKE_INV_ID}/dunning-logs" \
  -H "Authorization: Bearer ${AUTH_TOKEN}")
if [ "$HTTP" = "200" ]; then
  pass "GET /invoices/:id/dunning-logs → 200"
else
  fail "GET /invoices/:id/dunning-logs → expected 200, got ${HTTP}"
fi

# ── Test 10: DELETE rule ─────────────────────────────────────────────────────
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
  "${BASE_URL}/dunning-rules/${RULE_ID}" \
  -H "Authorization: Bearer ${AUTH_TOKEN}")
if [ "$HTTP" = "204" ]; then
  pass "DELETE /dunning-rules/:id → 204"
else
  fail "DELETE /dunning-rules/:id → expected 204, got ${HTTP}"
fi

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
