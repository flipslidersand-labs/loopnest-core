#!/usr/bin/env bash
# M06: Tax rate master integration test
set -euo pipefail
source "$(dirname "$0")/_common.sh" 2>/dev/null || true

BASE_URL="${BASE_URL:-http://localhost:3000}"
ADMIN_TOKEN="${ADMIN_TOKEN:-$(cat /tmp/loopnest_admin_token 2>/dev/null || echo '')}"
PASS=0; FAIL=0

pass() { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

auth_header() {
  [ -n "$ADMIN_TOKEN" ] && echo "-H \"Authorization: Bearer $ADMIN_TOKEN\"" || echo ""
}

echo "=== Tax Rates (M06) ==="

# ── Test 1: GET /api/tax-rates — seeded rates exist ───────────────────────────
RATES=$(curl -sf "${BASE_URL}/api/tax-rates" | jq '.data | length')
if [ "$RATES" -ge 2 ]; then
  pass "GET /api/tax-rates → ${RATES} rates (seed OK)"
else
  fail "GET /api/tax-rates → expected ≥2 rates, got $RATES"
fi

# ── Test 2: GET /api/tax-rates/default ────────────────────────────────────────
DEFAULT=$(curl -sf "${BASE_URL}/api/tax-rates/default" | jq -r '.data.rate')
if [ "$DEFAULT" = "0.1" ]; then
  pass "GET /api/tax-rates/default → rate=0.1 (標準税率)"
else
  fail "GET /api/tax-rates/default → expected 0.1, got $DEFAULT"
fi

# ── Test 3: GET /api/tax-rates/:id — individual fetch ─────────────────────────
RATE_ID=$(curl -sf "${BASE_URL}/api/tax-rates" | jq -r '.data[0].id')
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/tax-rates/${RATE_ID}")
if [ "$HTTP" = "200" ]; then
  pass "GET /api/tax-rates/:id → 200"
else
  fail "GET /api/tax-rates/:id → expected 200, got $HTTP"
fi

# ── Test 4: GET /api/tax-rates/<unknown> → 404 ────────────────────────────────
FAKE="00000000-0000-0000-0000-000000000000"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/tax-rates/${FAKE}")
if [ "$HTTP" = "404" ]; then
  pass "GET /api/tax-rates/<unknown> → 404"
else
  fail "GET /api/tax-rates/<unknown> → expected 404, got $HTTP"
fi

# ── Test 5: POST /api/tax-rates — create new rate ────────────────────────────
if [ -n "$ADMIN_TOKEN" ]; then
  NEW=$(curl -sf -X POST "${BASE_URL}/api/tax-rates" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"テスト税率","rate":0.05,"isDefault":false}')
  NEW_ID=$(echo "$NEW" | jq -r '.data.id')
  if [ -n "$NEW_ID" ] && [ "$NEW_ID" != "null" ]; then
    pass "POST /api/tax-rates → created id=$NEW_ID"
  else
    fail "POST /api/tax-rates → creation failed: $NEW"
  fi

  # ── Test 6: DELETE non-default rate ─────────────────────────────────────────
  DEL_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
    "${BASE_URL}/api/tax-rates/${NEW_ID}" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  if [ "$DEL_STATUS" = "204" ]; then
    pass "DELETE /api/tax-rates/:id (non-default) → 204"
  else
    fail "DELETE /api/tax-rates/:id → expected 204, got $DEL_STATUS"
  fi

  # ── Test 7: DELETE default rate → 409 ────────────────────────────────────────
  DEFAULT_ID=$(curl -sf "${BASE_URL}/api/tax-rates/default" | jq -r '.data.id')
  CONFLICT=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
    "${BASE_URL}/api/tax-rates/${DEFAULT_ID}" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  if [ "$CONFLICT" = "409" ]; then
    pass "DELETE default tax rate → 409 CONFLICT"
  else
    fail "DELETE default tax rate → expected 409, got $CONFLICT"
  fi
else
  echo "  SKIP: admin token not available (tests 5-7 skipped)"
fi

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
