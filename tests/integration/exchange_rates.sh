#!/usr/bin/env bash
# M16: Exchange rate CRUD integration test
set -euo pipefail
source "$(dirname "$0")/_common.sh" 2>/dev/null || true

BASE_URL="${BASE_URL:-http://localhost:3000}"
ADMIN_TOKEN="${ADMIN_TOKEN:-$(cat /tmp/loopnest_admin_token 2>/dev/null || echo '')}"
PASS=0; FAIL=0

pass() { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo "=== Exchange Rates (M16) ==="

# ── Test 1: GET /api/exchange-rates — initially empty ─────────────────────────
RATES=$(curl -sf "${BASE_URL}/api/exchange-rates" | jq '.data | length')
if [ "$RATES" -ge 0 ]; then
  pass "GET /api/exchange-rates → ${RATES} rates (OK)"
else
  fail "GET /api/exchange-rates → unexpected response"
fi

# ── Test 2: POST /api/exchange-rates — create USD rate ────────────────────────
HTTP=$(curl -s -o /tmp/ex_usd.json -w "%{http_code}" \
  -X POST "${BASE_URL}/api/exchange-rates" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -d '{"currencyCode":"USD","rateToJpy":155.5,"effectiveDate":"2026-09-05"}')
if [ "$HTTP" = "201" ]; then
  pass "POST /api/exchange-rates USD → 201"
else
  fail "POST /api/exchange-rates USD → expected 201, got $HTTP"
fi

# ── Test 3: GET /api/exchange-rates/USD — fetch back ──────────────────────────
RATE=$(curl -sf "${BASE_URL}/api/exchange-rates/USD" | jq -r '.data.rateToJpy')
if [ "$RATE" = "155.5" ]; then
  pass "GET /api/exchange-rates/USD → rateToJpy=155.5"
else
  fail "GET /api/exchange-rates/USD → expected 155.5, got $RATE"
fi

# ── Test 4: POST — upsert (update existing) ───────────────────────────────────
HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${BASE_URL}/api/exchange-rates" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -d '{"currencyCode":"USD","rateToJpy":156.0,"effectiveDate":"2026-09-05"}')
if [ "$HTTP" = "201" ]; then
  pass "POST /api/exchange-rates USD upsert → 201"
else
  fail "POST /api/exchange-rates USD upsert → expected 201, got $HTTP"
fi

UPDATED=$(curl -sf "${BASE_URL}/api/exchange-rates/USD" | jq -r '.data.rateToJpy')
if [ "$UPDATED" = "156" ] || [ "$UPDATED" = "156.0" ]; then
  pass "GET /api/exchange-rates/USD after upsert → rateToJpy=156"
else
  fail "GET /api/exchange-rates/USD after upsert → expected 156, got $UPDATED"
fi

# ── Test 5: GET /api/exchange-rates/:code — 404 for unknown ───────────────────
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/exchange-rates/XYZ")
if [ "$HTTP" = "404" ]; then
  pass "GET /api/exchange-rates/XYZ → 404"
else
  fail "GET /api/exchange-rates/XYZ → expected 404, got $HTTP"
fi

# ── Test 6: POST — validation error (invalid code length) ─────────────────────
HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${BASE_URL}/api/exchange-rates" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -d '{"currencyCode":"US","rateToJpy":155.0,"effectiveDate":"2026-09-05"}')
if [ "$HTTP" = "400" ]; then
  pass "POST invalid currencyCode (2 chars) → 400"
else
  fail "POST invalid currencyCode → expected 400, got $HTTP"
fi

# ── Test 7: POST — requires admin ─────────────────────────────────────────────
# Use command curl to bypass the _common.sh token-injection shim
HTTP=$(command curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${BASE_URL}/api/exchange-rates" \
  -H "Content-Type: application/json" \
  -d '{"currencyCode":"EUR","rateToJpy":165.0,"effectiveDate":"2026-09-05"}')
if [ "$HTTP" = "401" ] || [ "$HTTP" = "403" ]; then
  pass "POST without auth → 401/403"
else
  fail "POST without auth → expected 401/403, got $HTTP"
fi

echo ""
echo "Exchange Rates: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
