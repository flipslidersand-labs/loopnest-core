#!/usr/bin/env bash
# M07: Discount management integration test
set -euo pipefail
source "$(dirname "$0")/_common.sh" 2>/dev/null || true

BASE_URL="${BASE_URL:-http://localhost:3000}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
PASS=0; FAIL=0

pass() { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo "=== Discounts (M07) ==="

if [ -z "$ADMIN_TOKEN" ]; then
  echo "  SKIP: ADMIN_TOKEN not set"
  echo "Results: 0 passed, 0 failed"
  exit 0
fi

AUTH="-H \"Authorization: Bearer $ADMIN_TOKEN\""

# ── Setup: create a quote ───────────────────────────────────────────────────
CUSTOMER=$(curl -sf -X POST "${BASE_URL}/api/customers" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Discount Test Co","phone":"03-0000-0000"}' | jq -r '.data.id')

PRODUCT=$(curl -sf -X POST "${BASE_URL}/api/products" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sku":"DSC-001","name":"Discount Test Product","category":"laptop","unitPrice":10000,"stockQuantity":100}' | jq -r '.data.id')

QUOTE=$(curl -sf -X POST "${BASE_URL}/api/quotes" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"customerId\":\"$CUSTOMER\",\"quoteNumber\":\"QUO-DISC-$(date +%s)\",\"subtotalAmount\":100000,\"taxAmount\":10000,\"totalAmount\":110000,\"createdBy\":\"test\"}" | jq -r '.data.id')

if [ -z "$QUOTE" ] || [ "$QUOTE" = "null" ]; then
  fail "Setup: failed to create test quote"
  echo "Results: ${PASS} passed, ${FAIL} failed"
  exit 1
fi
echo "  Setup: quote=$QUOTE (subtotal=100,000)"

# ── Test 1: Apply percentage discount ────────────────────────────────────────
RESP=$(curl -sf -X POST "${BASE_URL}/api/workflow/quotes/${QUOTE}/discount" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"discountType":"percentage","discountValue":10}' 2>&1 || echo "ERROR")
DISC_AMT=$(echo "$RESP" | jq -r '.data.discountAmount // empty' 2>/dev/null)
if [ "$DISC_AMT" = "10000" ]; then
  pass "POST .../discount (percentage 10%) → discountAmount=10000"
else
  fail "POST .../discount → expected 10000, got '$DISC_AMT'"
fi

# ── Test 2: Apply fixed discount ─────────────────────────────────────────────
RESP=$(curl -sf -X POST "${BASE_URL}/api/workflow/quotes/${QUOTE}/discount" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"discountType":"fixed","discountValue":5000}')
DISC_AMT=$(echo "$RESP" | jq -r '.data.discountAmount // empty')
DISC_TYPE=$(echo "$RESP" | jq -r '.data.discountType // empty')
if [ "$DISC_AMT" = "5000" ] && [ "$DISC_TYPE" = "fixed" ]; then
  pass "POST .../discount (fixed 5000) → discountAmount=5000"
else
  fail "POST .../discount (fixed) → expected 5000/fixed, got $DISC_AMT/$DISC_TYPE"
fi

# ── Test 3: Validation — invalid type ────────────────────────────────────────
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/api/workflow/quotes/${QUOTE}/discount" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"discountType":"invalid","discountValue":10}')
if [ "$HTTP" = "400" ]; then
  pass "POST .../discount (invalid type) → 400"
else
  fail "POST .../discount (invalid type) → expected 400, got $HTTP"
fi

# ── Test 4: Validation — percentage > 100 ─────────────────────────────────────
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/api/workflow/quotes/${QUOTE}/discount" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"discountType":"percentage","discountValue":150}')
if [ "$HTTP" = "400" ]; then
  pass "POST .../discount (percentage > 100) → 400"
else
  fail "POST .../discount (percentage > 100) → expected 400, got $HTTP"
fi

# ── Test 5: Clear discount ────────────────────────────────────────────────────
RESP=$(curl -sf -X DELETE "${BASE_URL}/api/workflow/quotes/${QUOTE}/discount" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
DISC_CLEARED=$(echo "$RESP" | jq '.data.discountAmount')
if [ "$DISC_CLEARED" = "null" ]; then
  pass "DELETE .../discount → discountAmount=null (cleared)"
else
  fail "DELETE .../discount → expected null, got $DISC_CLEARED"
fi

# ── Test 6: Invoice carries discount ─────────────────────────────────────────
# Apply discount, submit, approve, invoice — check discount_amount on invoice
curl -sf -X POST "${BASE_URL}/api/workflow/quotes/${QUOTE}/discount" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"discountType":"fixed","discountValue":20000}' > /dev/null

curl -sf -X POST "${BASE_URL}/api/workflow/quotes/${QUOTE}/submit" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"userId":"user1"}' > /dev/null

curl -sf -X POST "${BASE_URL}/api/workflow/quotes/${QUOTE}/approve" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"userId":"approver1"}' > /dev/null

INV_RESP=$(curl -sf -X POST "${BASE_URL}/api/workflow/quotes/${QUOTE}/invoice" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"userId":"user1"}')
INVOICE_ID=$(echo "$INV_RESP" | jq -r '.data.invoice.invoiceId // empty')
# InvoiceCreationResult (the workflow response) doesn't carry discountAmount;
# fetch the persisted invoice to see the value actually written to the DB.
INV_DISC=$(curl -sf "${BASE_URL}/api/invoices/${INVOICE_ID}" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.data.discountAmount // empty')
if [ "$INV_DISC" = "20000" ]; then
  pass "Invoice.discountAmount=20000 carried from quote"
else
  fail "Invoice.discountAmount → expected 20000, got '$INV_DISC'"
fi

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
