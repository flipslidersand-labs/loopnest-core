#!/usr/bin/env bash
# M27: invoice line-item discounts — discount_pct / discount_amt per quote item.
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Invoice Line-Item Discount Tests ==="
echo ""

# ── Setup: customer + product ────────────────────────────────────────────────
echo "Setup"
CUST_ID=$(make_customer "Discount Test Corp")
check "customer created" "true" "$([ -n "$CUST_ID" ] && [ "$CUST_ID" != "null" ] && echo true || echo false)"

PROD_ID=$(make_product "Widget A" 10000)
check "product created" "true" "$([ -n "$PROD_ID" ] && [ "$PROD_ID" != "null" ] && echo true || echo false)"

# ── Create quote and add item with discountPct ────────────────────────────────
echo ""
echo "Quote item with discountPct"
QN="QT-DISC-$(date +%s)-$RANDOM"
QUOTE=$(curl -s -X POST "$BASE_URL/quotes" \
  -H "Content-Type: application/json" \
  -d "{\"quoteNumber\":\"$QN\",\"customerId\":\"$CUST_ID\",\"subtotalAmount\":0,\"taxAmount\":0,\"totalAmount\":0,\"createdBy\":\"user1\"}")
QID=$(echo "$QUOTE" | jq -r '.data.id')
check "quote created" "true" "$([ -n "$QID" ] && [ "$QID" != "null" ] && echo true || echo false)"

# Add item: qty=2, unitPrice=10000, discountPct=10 → lineTotal = 2*10000*(1-0.10) = 18000
ITEM=$(curl -s -X POST "$BASE_URL/quotes/$QID/items" \
  -H "Content-Type: application/json" \
  -d "{\"productId\":\"$PROD_ID\",\"quantity\":2,\"unitPrice\":10000,\"discountPct\":10}")
check "item discountPct accepted" "10" "$(echo "$ITEM" | jq -r '.data.discountPct')"
check "lineTotal reflects discountPct" "18000" "$(echo "$ITEM" | jq -r '.data.lineTotal')"

# ── Validate: both discountPct and discountAmt rejected ──────────────────────
echo ""
echo "Validation"
BAD=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/quotes/$QID/items" \
  -H "Content-Type: application/json" \
  -d "{\"productId\":\"$PROD_ID\",\"quantity\":1,\"unitPrice\":5000,\"discountPct\":5,\"discountAmt\":100}")
check "both discount fields → 400" "400" "$BAD"

# ── Issue invoice and check items have discount fields ───────────────────────
echo ""
echo "Invoice items"
curl -s -X POST "$BASE_URL/workflow/quotes/$QID/submit" \
  -H "Content-Type: application/json" -d '{"userId":"user1"}' > /dev/null
curl -s -X POST "$BASE_URL/workflow/quotes/$QID/approve" \
  -H "Content-Type: application/json" -d '{"userId":"approver1","notes":"ok"}' > /dev/null
INV=$(curl -s -X POST "$BASE_URL/workflow/quotes/$QID/invoice" \
  -H "Content-Type: application/json" -d '{"userId":"user1"}')
INV_ID=$(echo "$INV" | jq -r '.data.invoice.invoiceId')
check "invoice created" "true" "$([ -n "$INV_ID" ] && [ "$INV_ID" != "null" ] && echo true || echo false)"

DETAIL=$(curl -s "$BASE_URL/invoices/$INV_ID")
check "items array present" "true" "$(echo "$DETAIL" | jq 'has("data") and (.data | has("items"))')"
check "items count = 1" "1" "$(echo "$DETAIL" | jq '.data.items | length')"
check "item discountPct carried over" "10" "$(echo "$DETAIL" | jq '.data.items[0].discountPct')"
check "item lineTotal in invoice = 18000" "18000" "$(echo "$DETAIL" | jq '.data.items[0].lineTotal')"

# ── discountAmt path ─────────────────────────────────────────────────────────
echo ""
echo "discountAmt path"
CUST2=$(make_customer "Discount Amt Corp")
QN2="QT-DAMT-$(date +%s)-$RANDOM"
QUOTE2=$(curl -s -X POST "$BASE_URL/quotes" \
  -H "Content-Type: application/json" \
  -d "{\"quoteNumber\":\"$QN2\",\"customerId\":\"$CUST2\",\"subtotalAmount\":0,\"taxAmount\":0,\"totalAmount\":0,\"createdBy\":\"user1\"}")
QID2=$(echo "$QUOTE2" | jq -r '.data.id')

# qty=1, unitPrice=5000, discountAmt=500 → lineTotal = 5000 - 500 = 4500
ITEM2=$(curl -s -X POST "$BASE_URL/quotes/$QID2/items" \
  -H "Content-Type: application/json" \
  -d "{\"productId\":\"$PROD_ID\",\"quantity\":1,\"unitPrice\":5000,\"discountAmt\":500}")
check "item discountAmt accepted" "500" "$(echo "$ITEM2" | jq -r '.data.discountAmt')"
check "lineTotal reflects discountAmt" "4500" "$(echo "$ITEM2" | jq -r '.data.lineTotal')"

summary
