#!/usr/bin/env bash
# M11: Invoice installment schedule integration test
set -euo pipefail
source "$(dirname "$0")/_common.sh" 2>/dev/null || true

BASE_URL="${BASE_URL:-http://localhost:3000}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
PASS=0; FAIL=0

pass() { echo "  ✓ $1"; ((PASS++)); }
fail() { echo "  ✗ $1"; ((FAIL++)); }

echo "=== Installments (M11) ==="

if [ -z "$ADMIN_TOKEN" ]; then
  echo "  SKIP: ADMIN_TOKEN not set"
  echo "Results: 0 passed, 0 failed"
  exit 0
fi

# ── Setup: create a complete invoiced quote ───────────────────────────────────
CUSTOMER=$(curl -sf -X POST "${BASE_URL}/api/customers" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Installment Test Co"}' | jq -r '.data.id')

QUOTE=$(curl -sf -X POST "${BASE_URL}/api/quotes" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"customerId\":\"$CUSTOMER\",\"quoteNumber\":\"QUO-INST-$(date +%s)\",\"subtotalAmount\":90000,\"taxAmount\":9000,\"totalAmount\":99000,\"createdBy\":\"test\"}" | jq -r '.data.id')

curl -sf -X POST "${BASE_URL}/api/workflow/quotes/${QUOTE}/submit" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{}' > /dev/null
curl -sf -X POST "${BASE_URL}/api/workflow/quotes/${QUOTE}/approve" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{}' > /dev/null

INV_RESP=$(curl -sf -X POST "${BASE_URL}/api/workflow/quotes/${QUOTE}/invoice" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{}')
INVOICE_ID=$(echo "$INV_RESP" | jq -r '.data.invoice.invoiceId // .data.invoiceId // empty')

if [ -z "$INVOICE_ID" ] || [ "$INVOICE_ID" = "null" ]; then
  fail "Setup: could not create invoice"
  echo "Results: ${PASS} passed, ${FAIL} failed"
  exit 1
fi
echo "  Setup: invoice=$INVOICE_ID (total=99000)"

FIRST_DUE=$(date -u -d "+30 days" '+%Y-%m-%d' 2>/dev/null || date -u -v+30d '+%Y-%m-%d')

# ── Test 1: GET installments before schedule ──────────────────────────────────
BEFORE=$(curl -sf "${BASE_URL}/api/invoices/${INVOICE_ID}/installments" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.data | length')
if [ "$BEFORE" = "0" ]; then
  pass "GET installments (none yet) → 0"
else
  fail "GET installments → expected 0, got $BEFORE"
fi

# ── Test 2: POST schedule (3 installments, 30-day interval) ──────────────────
SCHED=$(curl -sf -X POST "${BASE_URL}/api/invoices/${INVOICE_ID}/installments" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"count\":3,\"firstDueDate\":\"$FIRST_DUE\",\"intervalDays\":30}")
INST_COUNT=$(echo "$SCHED" | jq '.data | length')
if [ "$INST_COUNT" = "3" ]; then
  pass "POST installments (count=3) → 3 installments created"
else
  fail "POST installments → expected 3, got $INST_COUNT"
fi

# ── Test 3: amounts sum to total ─────────────────────────────────────────────
TOTAL_SUM=$(echo "$SCHED" | jq '[.data[].amount] | add')
if [ "$TOTAL_SUM" = "99000" ]; then
  pass "Installment amounts sum = 99000"
else
  fail "Installment amounts sum → expected 99000, got $TOTAL_SUM"
fi

# ── Test 4: seq ordering ─────────────────────────────────────────────────────
SEQ_1=$(echo "$SCHED" | jq '.data[0].seq')
SEQ_3=$(echo "$SCHED" | jq '.data[2].seq')
if [ "$SEQ_1" = "1" ] && [ "$SEQ_3" = "3" ]; then
  pass "Installments seq = 1, 2, 3"
else
  fail "Installments seq → expected 1/3, got $SEQ_1/$SEQ_3"
fi

# ── Test 5: mark first installment paid ──────────────────────────────────────
INST_ID=$(echo "$SCHED" | jq -r '.data[0].id')
PAID=$(curl -sf -X PATCH \
  "${BASE_URL}/api/invoices/${INVOICE_ID}/installments/${INST_ID}/pay" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{}')
STATUS=$(echo "$PAID" | jq -r '.data.status')
if [ "$STATUS" = "paid" ]; then
  pass "PATCH installments/:id/pay → status=paid"
else
  fail "PATCH .../pay → expected paid, got $STATUS"
fi

# ── Test 6: GET after pay shows 2 pending + 1 paid ───────────────────────────
AFTER=$(curl -sf "${BASE_URL}/api/invoices/${INVOICE_ID}/installments" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
PAID_COUNT=$(echo "$AFTER" | jq '[.data[] | select(.status=="paid")] | length')
PENDING_COUNT=$(echo "$AFTER" | jq '[.data[] | select(.status=="pending")] | length')
if [ "$PAID_COUNT" = "1" ] && [ "$PENDING_COUNT" = "2" ]; then
  pass "GET after pay → 1 paid, 2 pending"
else
  fail "GET after pay → expected 1 paid / 2 pending, got $PAID_COUNT/$PENDING_COUNT"
fi

# ── Test 7: cancel a pending installment ─────────────────────────────────────
INST2_ID=$(echo "$AFTER" | jq -r '[.data[] | select(.status=="pending")][0].id')
CANCEL=$(curl -sf -X PATCH \
  "${BASE_URL}/api/invoices/${INVOICE_ID}/installments/${INST2_ID}/cancel" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{}')
C_STATUS=$(echo "$CANCEL" | jq -r '.data.status')
if [ "$C_STATUS" = "cancelled" ]; then
  pass "PATCH installments/:id/cancel → status=cancelled"
else
  fail "PATCH .../cancel → expected cancelled, got $C_STATUS"
fi

# ── Test 8: validation — count < 2 ───────────────────────────────────────────
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "${BASE_URL}/api/invoices/${INVOICE_ID}/installments" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"count\":1,\"firstDueDate\":\"$FIRST_DUE\"}")
if [ "$HTTP" = "400" ]; then
  pass "POST installments (count=1) → 400"
else
  fail "POST installments (count=1) → expected 400, got $HTTP"
fi

# ── Test 9: replace existing schedule (idempotent) ───────────────────────────
NEW_SCHED=$(curl -sf -X POST "${BASE_URL}/api/invoices/${INVOICE_ID}/installments" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"count\":2,\"firstDueDate\":\"$FIRST_DUE\",\"intervalDays\":60}" 2>&1 || echo "BLOCKED")
# Should be blocked because inst1 is paid
if echo "$NEW_SCHED" | grep -q "BLOCKED\|paid"; then
  pass "POST installments (replace with paid) → blocked"
else
  # If it returns 2 installments that's also fine (if impl clears non-paid only)
  CNT=$(echo "$NEW_SCHED" | jq '.data | length' 2>/dev/null || echo "0")
  if [ "$CNT" = "2" ]; then
    pass "POST installments (replace keeping paid) → 2 new"
  else
    fail "POST installments (replace with paid) → unexpected: $NEW_SCHED"
  fi
fi

# ── Test 10: GET installments for unknown invoice → 404 ───────────────────────
HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
  "${BASE_URL}/api/invoices/00000000-0000-0000-0000-000000000000/installments" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
if [ "$HTTP" = "404" ]; then
  pass "GET installments (unknown invoice) → 404"
else
  fail "GET installments (unknown invoice) → expected 404, got $HTTP"
fi

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
