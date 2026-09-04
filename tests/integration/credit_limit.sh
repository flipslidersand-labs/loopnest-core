#!/usr/bin/env bash
# M08: Customer credit limit integration test
set -euo pipefail
source "$(dirname "$0")/_common.sh" 2>/dev/null || true

BASE_URL="${BASE_URL:-http://localhost:3000}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
PASS=0; FAIL=0

pass() { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo "=== Credit Limit (M08) ==="

if [ -z "$ADMIN_TOKEN" ]; then
  echo "  SKIP: ADMIN_TOKEN not set"
  echo "Results: 0 passed, 0 failed"
  exit 0
fi

AUTH_H="-H \"Authorization: Bearer $ADMIN_TOKEN\""

# ── Setup ───────────────────────────────────────────────────────────────────
CUSTOMER=$(curl -sf -X POST "${BASE_URL}/api/customers" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Credit Test Co","phone":"03-1234-5678"}' | jq -r '.data.id')

if [ -z "$CUSTOMER" ] || [ "$CUSTOMER" = "null" ]; then
  fail "Setup: failed to create customer"
  exit 1
fi
echo "  Setup: customer=$CUSTOMER"

# ── Test 1: credit-status defaults ──────────────────────────────────────────
STATUS=$(curl -sf "${BASE_URL}/api/customers/${CUSTOMER}/credit-status")
IS_UNLIMITED=$(echo "$STATUS" | jq -r '.data.isUnlimited')
if [ "$IS_UNLIMITED" = "true" ]; then
  pass "GET /credit-status → isUnlimited=true (no limit set)"
else
  fail "GET /credit-status → expected isUnlimited=true, got: $IS_UNLIMITED"
fi

# ── Test 2: PATCH credit-limit ───────────────────────────────────────────────
PATCHED=$(curl -sf -X PATCH "${BASE_URL}/api/customers/${CUSTOMER}/credit-limit" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"creditLimit":100000}')
LIMIT=$(echo "$PATCHED" | jq -r '.data.creditLimit')
if [ "$LIMIT" = "100000" ]; then
  pass "PATCH /credit-limit → creditLimit=100000"
else
  fail "PATCH /credit-limit → expected 100000, got $LIMIT"
fi

# ── Test 3: credit-status after limit set ───────────────────────────────────
STATUS=$(curl -sf "${BASE_URL}/api/customers/${CUSTOMER}/credit-status")
IS_UNLIMITED=$(echo "$STATUS" | jq -r '.data.isUnlimited')
AVAIL=$(echo "$STATUS" | jq -r '.data.creditAvailable')
if [ "$IS_UNLIMITED" = "false" ] && [ "$AVAIL" = "100000" ]; then
  pass "GET /credit-status → isUnlimited=false, creditAvailable=100000"
else
  fail "GET /credit-status → expected false/100000, got $IS_UNLIMITED/$AVAIL"
fi

# ── Test 4: validation — negative limit ────────────────────────────────────
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH \
  "${BASE_URL}/api/customers/${CUSTOMER}/credit-limit" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"creditLimit":-500}')
if [ "$HTTP" = "400" ]; then
  pass "PATCH /credit-limit (negative) → 400"
else
  fail "PATCH /credit-limit (negative) → expected 400, got $HTTP"
fi

# ── Test 5: invoice blocked when over limit ──────────────────────────────────
# Set a very low limit (¥1) so any invoice will exceed it
curl -sf -X PATCH "${BASE_URL}/api/customers/${CUSTOMER}/credit-limit" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"creditLimit":1}' > /dev/null

PRODUCT=$(curl -sf -X POST "${BASE_URL}/api/products" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sku":"CL-TEST-001","name":"Credit Limit Test","category":"laptop","unitPrice":50000,"stockQuantity":10}' | jq -r '.data.id')

QUOTE=$(curl -sf -X POST "${BASE_URL}/api/quotes" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"customerId\":\"$CUSTOMER\",\"quoteNumber\":\"QUO-CL-$(date +%s)\",\"subtotalAmount\":50000,\"taxAmount\":5000,\"totalAmount\":55000,\"createdBy\":\"test\"}" | jq -r '.data.id')

curl -sf -X POST "${BASE_URL}/api/workflow/quotes/${QUOTE}/submit" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"userId":"user1"}' > /dev/null
curl -sf -X POST "${BASE_URL}/api/workflow/quotes/${QUOTE}/approve" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"userId":"approver1"}' > /dev/null

HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "${BASE_URL}/api/workflow/quotes/${QUOTE}/invoice" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"userId":"user1"}')
if [ "$HTTP" = "422" ]; then
  pass "Invoice blocked by credit limit → 422 CREDIT_LIMIT_EXCEEDED"
else
  fail "Invoice blocked by credit limit → expected 422, got $HTTP"
fi

# ── Test 6: null limit = unlimited ──────────────────────────────────────────
curl -sf -X PATCH "${BASE_URL}/api/customers/${CUSTOMER}/credit-limit" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"creditLimit":null}' > /dev/null
STATUS=$(curl -sf "${BASE_URL}/api/customers/${CUSTOMER}/credit-status")
IS_UNLIMITED=$(echo "$STATUS" | jq -r '.data.isUnlimited')
if [ "$IS_UNLIMITED" = "true" ]; then
  pass "PATCH creditLimit=null → isUnlimited=true"
else
  fail "PATCH creditLimit=null → expected isUnlimited=true, got $IS_UNLIMITED"
fi

# ── Test 7: invoice succeeds with unlimited credit ───────────────────────────
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "${BASE_URL}/api/workflow/quotes/${QUOTE}/invoice" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"userId":"user1"}')
if [ "$HTTP" = "200" ] || [ "$HTTP" = "201" ]; then
  pass "Invoice succeeds with unlimited credit → $HTTP"
else
  fail "Invoice with unlimited credit → expected 200/201, got $HTTP"
fi

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
