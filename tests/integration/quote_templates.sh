#!/usr/bin/env bash
# M10: Quote templates integration test
set -euo pipefail
source "$(dirname "$0")/_common.sh" 2>/dev/null || true

BASE_URL="${BASE_URL:-http://localhost:3000}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
PASS=0; FAIL=0

pass() { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo "=== Quote Templates (M10) ==="

if [ -z "$ADMIN_TOKEN" ]; then
  echo "  SKIP: ADMIN_TOKEN not set"
  echo "Results: 0 passed, 0 failed"
  exit 0
fi

# ── Setup: create a customer and product ──────────────────────────────────────
CUSTOMER=$(curl -sf -X POST "${BASE_URL}/api/customers" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Template Test Co","phone":"03-0000-1111"}' | jq -r '.data.id')

PRODUCT=$(curl -sf -X POST "${BASE_URL}/api/products" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sku":"TPL-001","name":"Template Product","category":"laptop","unitPrice":10000,"stockQuantity":100}' | jq -r '.data.id')

echo "  Setup: customer=$CUSTOMER product=$PRODUCT"

# ── Test 1: GET /api/quote-templates (initially empty or existing) ────────────
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/quote-templates" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
if [ "$HTTP" = "200" ]; then
  pass "GET /api/quote-templates → 200"
else
  fail "GET /api/quote-templates → expected 200, got $HTTP"
fi

# ── Test 2: POST /api/quote-templates — create ────────────────────────────────
TMPL=$(curl -sf -X POST "${BASE_URL}/api/quote-templates" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Standard Package\",\"description\":\"Default consulting package\",\"items\":[{\"productId\":\"$PRODUCT\",\"quantity\":3,\"unitPrice\":10000}]}")
TMPL_ID=$(echo "$TMPL" | jq -r '.data.id')
if [ -n "$TMPL_ID" ] && [ "$TMPL_ID" != "null" ]; then
  pass "POST /api/quote-templates → created id=$TMPL_ID"
else
  fail "POST /api/quote-templates → creation failed: $TMPL"
fi

# ── Test 3: GET /api/quote-templates/:id ─────────────────────────────────────
FETCHED=$(curl -sf "${BASE_URL}/api/quote-templates/${TMPL_ID}" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
ITEM_COUNT=$(echo "$FETCHED" | jq '.data.items | length')
if [ "$ITEM_COUNT" = "1" ]; then
  pass "GET /api/quote-templates/:id → 1 item returned"
else
  fail "GET /api/quote-templates/:id → expected 1 item, got $ITEM_COUNT"
fi

# ── Test 4: validation — missing items ───────────────────────────────────────
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/api/quote-templates" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Empty","items":[]}')
if [ "$HTTP" = "400" ]; then
  pass "POST /api/quote-templates (empty items) → 400"
else
  fail "POST /api/quote-templates (empty items) → expected 400, got $HTTP"
fi

# ── Test 5: POST /api/workflow/quote-templates/:id/apply ──────────────────────
APPLY=$(curl -sf -X POST \
  "${BASE_URL}/api/workflow/quote-templates/${TMPL_ID}/apply" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"customerId\":\"$CUSTOMER\"}")
QUOTE_ID=$(echo "$APPLY" | jq -r '.data.id')
QUOTE_NUM=$(echo "$APPLY" | jq -r '.data.quoteNumber')
SUBTOTAL=$(echo "$APPLY" | jq -r '.data.subtotalAmount')
if [ -n "$QUOTE_ID" ] && [ "$QUOTE_ID" != "null" ]; then
  pass "POST .../apply → quote $QUOTE_NUM created (subtotal=$SUBTOTAL)"
else
  fail "POST .../apply → expected quote, got: $(echo "$APPLY" | jq -c .)"
fi

# ── Test 6: applied quote has items ──────────────────────────────────────────
ITEM_C=$(echo "$APPLY" | jq '.data.items | length')
if [ "$ITEM_C" = "1" ]; then
  pass "Applied quote has 1 item"
else
  fail "Applied quote items → expected 1, got $ITEM_C"
fi

# ── Test 7: subtotal = qty * unitPrice ────────────────────────────────────────
# 3 items × ¥10,000 = ¥30,000
if [ "$SUBTOTAL" = "30000" ]; then
  pass "Applied quote subtotal = 30000 (3 × 10000)"
else
  fail "Applied quote subtotal → expected 30000, got $SUBTOTAL"
fi

# ── Test 8: GET /api/quote-templates — list includes new template ─────────────
LIST_COUNT=$(curl -sf "${BASE_URL}/api/quote-templates" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.data | length')
if [ "$LIST_COUNT" -ge 1 ]; then
  pass "GET /api/quote-templates → $LIST_COUNT template(s)"
else
  fail "GET /api/quote-templates → expected ≥1, got $LIST_COUNT"
fi

# ── Test 9: DELETE template ───────────────────────────────────────────────────
DEL_HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
  "${BASE_URL}/api/quote-templates/${TMPL_ID}" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
if [ "$DEL_HTTP" = "204" ]; then
  pass "DELETE /api/quote-templates/:id → 204"
else
  fail "DELETE /api/quote-templates/:id → expected 204, got $DEL_HTTP"
fi

# ── Test 10: GET after delete → 404 ──────────────────────────────────────────
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/quote-templates/${TMPL_ID}" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
if [ "$HTTP" = "404" ]; then
  pass "GET deleted template → 404"
else
  fail "GET deleted template → expected 404, got $HTTP"
fi

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
