#!/usr/bin/env bash
# M17: Financial Reporting — monthly P&L, cash flow, revenue-by-customer
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Financial Reports (M17) Tests ==="
echo ""

DIR="$(cd "$(dirname "$0")" && pwd)"

MONTH=$(date -u +"%Y-%m")
TODAY=$(date -u +"%Y-%m-%d")
MONTH_START="${MONTH}-01"

# ── Setup: paid invoice + payment so reports have data ─────────────────────
CUST=$(make_customer "FinRpt Corp")
PROD=$(make_product "FinRpt Widget" 50000)

make_paid_invoice_with_payment() {
  local price="${1:-50000}"
  local qid inv_id
  qid=$(make_quote "$CUST")
  curl -s -X POST "$BASE_URL/quotes/$qid/items" \
    -H "Content-Type: application/json" \
    -d "{\"productId\":\"$PROD\",\"quantity\":1,\"unitPrice\":$price}" > /dev/null
  curl -s -X POST "$BASE_URL/workflow/quotes/$qid/submit"  -H "Content-Type: application/json" -d '{"userId":"fr-user"}' > /dev/null
  curl -s -X POST "$BASE_URL/workflow/quotes/$qid/approve" -H "Content-Type: application/json" -d '{"userId":"fr-approver","notes":"ok"}' > /dev/null
  inv_id=$(curl -s -X POST "$BASE_URL/workflow/quotes/$qid/invoice" \
    -H "Content-Type: application/json" -d '{"userId":"fr-user"}' | jq -r '.data.invoice.invoiceId')
  # Record a payment
  curl -s -X POST "$BASE_URL/invoices/$inv_id/payments" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: fr-pay-$(date +%s%N)" \
    -d "{\"amount\":$price,\"method\":\"bank_transfer\",\"paidOn\":\"$TODAY\"}" > /dev/null
  echo "$inv_id"
}

INV1=$(make_paid_invoice_with_payment 50000)
INV2=$(make_paid_invoice_with_payment 30000)
check "setup: 2 paid invoices" "true" \
  "$([ -n "$INV1" ] && [ "$INV1" != "null" ] && [ -n "$INV2" ] && [ "$INV2" != "null" ] && echo true || echo false)"

# ── 1. GET /api/reports/monthly-summary ──────────────────────────────────────
echo ""
echo "Monthly P&L summary"

R=$(curl -s -w "\n%{http_code}" "$BASE_URL/reports/monthly-summary?month=$MONTH")
check "monthly-summary → 200"          "200" "$(http_code "$R")"
check "has month field"                "true" "$(http_body "$R" | jq '.data | has("month")')"
check "month value correct"            "$MONTH" "$(http_body "$R" | jq -r '.data.month')"
check "has grossRevenue"               "true" "$(http_body "$R" | jq '.data | has("grossRevenue")')"
check "has taxAmount"                  "true" "$(http_body "$R" | jq '.data | has("taxAmount")')"
check "has totalBilled"                "true" "$(http_body "$R" | jq '.data | has("totalBilled")')"
check "has paymentsReceived"           "true" "$(http_body "$R" | jq '.data | has("paymentsReceived")')"
check "has outstandingBalance"         "true" "$(http_body "$R" | jq '.data | has("outstandingBalance")')"
check "has invoiceCount"               "true" "$(http_body "$R" | jq '.data | has("invoiceCount")')"
check "invoiceCount ≥ 2"               "true" "$(http_body "$R" | jq '.data.invoiceCount >= 2')"
check "totalBilled = grossRevenue + taxAmount" "true" \
  "$(http_body "$R" | jq '(.data.totalBilled | . * 100 | round) == ((.data.grossRevenue + .data.taxAmount) * 100 | round)')"

# Defaults to current month when no param
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/reports/monthly-summary")
check "monthly-summary (no param) → 200" "200" "$(http_code "$R")"

# Invalid month format → 400
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/reports/monthly-summary?month=2026")
check "invalid month → 400" "400" "$(http_code "$R")"

# ── 2. GET /api/reports/cash-flow ─────────────────────────────────────────────
echo ""
echo "Cash flow time series"

PAST_30=$(date -u -d "30 days ago" +"%Y-%m-%d" 2>/dev/null || date -u -v-30d +"%Y-%m-%d")
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/reports/cash-flow?from=${PAST_30}&to=${TODAY}")
check "cash-flow → 200"              "200" "$(http_code "$R")"
check "has data array"               "true" "$(http_body "$R" | jq 'has("data")')"
check "has from/to fields"           "true" "$(http_body "$R" | jq 'has("from") and has("to")')"
check "data ≥ 1 row (payments today)" "true" "$(http_body "$R" | jq '.data | length >= 1')"
check "total payments > 0"           "true" \
  "$(http_body "$R" | jq '[.data[].paymentsReceived] | add > 0')"
check "rows have paymentCount"       "true" \
  "$(http_body "$R" | jq '.data[0] | has("paymentCount")')"

# Missing params → 400
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/reports/cash-flow?from=${TODAY}")
check "cash-flow missing to → 400" "400" "$(http_code "$R")"

# from > to → 400
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/reports/cash-flow?from=${TODAY}&to=${PAST_30}")
check "from > to → 400" "400" "$(http_code "$R")"

# ── 3. GET /api/reports/revenue-by-customer ───────────────────────────────────
echo ""
echo "Revenue by customer"

R=$(curl -s -w "\n%{http_code}" "$BASE_URL/reports/revenue-by-customer?month=$MONTH")
check "revenue-by-customer → 200"     "200" "$(http_code "$R")"
check "has data array"                "true" "$(http_body "$R" | jq 'has("data")')"
check "has month field"               "true" "$(http_body "$R" | jq 'has("month")')"
check "data ≥ 1 customer"             "true" "$(http_body "$R" | jq '.data | length >= 1')"
check "has customerId/Name/Revenue"   "true" \
  "$(http_body "$R" | jq '.data[0] | has("customerId") and has("customerName") and has("totalRevenue")')"
check "sorted descending by revenue"  "true" \
  "$(http_body "$R" | jq '([.data[].totalRevenue] as $r | $r == ($r | sort | reverse))')"

# Invalid month → 400
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/reports/revenue-by-customer?month=bad")
check "invalid month → 400" "400" "$(http_code "$R")"

# Default to current month
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/reports/revenue-by-customer")
check "revenue-by-customer (no param) → 200" "200" "$(http_code "$R")"

# ── 4. Viewer RBAC ───────────────────────────────────────────────────────────
echo ""
echo "RBAC: viewer access"

VIEWER_TOKEN=$(node "$DIR/gen-token.mjs" fr-viewer viewer)
for path in "monthly-summary?month=$MONTH" "cash-flow?from=$TODAY&to=$TODAY" "revenue-by-customer?month=$MONTH"; do
  R=$(command curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $VIEWER_TOKEN" \
    "$BASE_URL/reports/$path")
  check "viewer GET /reports/$path → 200" "200" "$(http_code "$R")"
done

summary
