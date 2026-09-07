#!/usr/bin/env bash
# M22: Customer Statement of Account — JSON + PDF endpoints.
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Customer Statement Tests ==="
echo ""

DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Setup: one invoice + payment ───────────────────────────────────────────────
echo "Setup"
read -r _ INV_ID <<<"$(make_invoice)"
check "invoice created" "true" "$([ -n "$INV_ID" ] && [ "$INV_ID" != "null" ] && echo true || echo false)"

# Get customer id from invoice
CUST_ID=$(curl -s "$BASE_URL/invoices/$INV_ID" | jq -r '.data.customerId')
check "customer id retrieved" "true" "$([ -n "$CUST_ID" ] && [ "$CUST_ID" != "null" ] && echo true || echo false)"

# Record a payment against the invoice
curl -s -X POST "$BASE_URL/invoices/$INV_ID/payments" \
  -H "Content-Type: application/json" \
  -d '{"amount":165000,"method":"bank_transfer","paidOn":"'"$(date +%Y-%m-%d)"'","reference":"PAY-STMT-TEST"}' \
  > /dev/null

# ── 1. GET /api/customers/:id/statement ────────────────────────────────────────
echo "JSON statement"
TODAY=$(date +%Y-%m-%d)
MONTH_START=$(date +%Y-%m-01)
R=$(curl -s -w "\n%{http_code}" \
  "$BASE_URL/customers/$CUST_ID/statement?from=$MONTH_START&to=$TODAY")
check "GET /customers/:id/statement → 200" "200" "$(http_code "$R")"
check "customer.id matches" "$CUST_ID" "$(http_body "$R" | jq -r '.data.customer.id')"
check "period.from present" "true" "$(http_body "$R" | jq '.data.period.from != null')"
check "period.to present"   "true" "$(http_body "$R" | jq '.data.period.to != null')"
check "transactions is array" "true" "$(http_body "$R" | jq '.data.transactions | type == "array"')"
check "has ≥1 transaction"   "true" "$(http_body "$R" | jq '.data.transactions | length >= 1')"
check "closingBalance is number" "true" "$(http_body "$R" | jq '.data.closingBalance | type == "number"')"

# ── 2. Invoice appears as debit ───────────────────────────────────────────────
echo "Transaction types"
INV_TXN=$(http_body "$R" | jq '[.data.transactions[] | select(.type=="invoice")] | .[0]')
check "invoice transaction present" "invoice" "$(echo "$INV_TXN" | jq -r '.type')"
check "invoice debit > 0"           "true"    "$(echo "$INV_TXN" | jq '.debit > 0')"
check "invoice credit = 0"          "0"       "$(echo "$INV_TXN" | jq '.credit')"

PAY_TXN=$(http_body "$R" | jq '[.data.transactions[] | select(.type=="payment")] | .[0]')
check "payment transaction present" "payment" "$(echo "$PAY_TXN" | jq -r '.type')"
check "payment credit > 0"          "true"    "$(echo "$PAY_TXN" | jq '.credit > 0')"
check "payment debit = 0"           "0"       "$(echo "$PAY_TXN" | jq '.debit')"

# ── 3. Transactions ordered by date ──────────────────────────────────────────
echo "Order"
DATES=$(http_body "$R" | jq '[.data.transactions[].date]')
SORTED=$(echo "$DATES" | jq 'sort')
check "transactions ordered by date" "$SORTED" "$DATES"

# ── 4. GET /api/customers/:id/statement/pdf ───────────────────────────────────
echo "PDF"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE_URL/customers/$CUST_ID/statement/pdf?from=$MONTH_START&to=$TODAY")
check "GET /customers/:id/statement/pdf → 200" "200" "$HTTP_CODE"

CONTENT_TYPE=$(curl -s -o /dev/null -w "%{content_type}" \
  "$BASE_URL/customers/$CUST_ID/statement/pdf?from=$MONTH_START&to=$TODAY")
check "Content-Type is application/pdf" "application/pdf" "$CONTENT_TYPE"

# ── 5. Invalid date params ────────────────────────────────────────────────────
echo "Validation"
R=$(curl -s -w "\n%{http_code}" \
  "$BASE_URL/customers/$CUST_ID/statement?from=not-a-date&to=$TODAY")
check "invalid date → 400" "400" "$(http_code "$R")"

# ── 6. Non-existent customer → 404 ───────────────────────────────────────────
echo "Not found"
R=$(curl -s -w "\n%{http_code}" \
  "$BASE_URL/customers/00000000-0000-0000-0000-000000000000/statement")
check "unknown customer → 404" "404" "$(http_code "$R")"

summary
