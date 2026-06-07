#!/usr/bin/env bash
# Quote line items: CRUD, auto-recalculation, and state guards.
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Quote Line Items Tests ==="
echo ""

CUST=$(make_customer "Items Corp")
PROD_A=$(make_product "Widget A" 10000)
PROD_B=$(make_product "Widget B" 5000)

QN="QI-$(date +%s)-$RANDOM"
QUOTE=$(curl -s -X POST "$BASE_URL/quotes" \
  -H "Content-Type: application/json" \
  -d "{\"quoteNumber\":\"$QN\",\"customerId\":\"$CUST\",\"createdBy\":\"user1\"}" \
  | jq -r '.data.id')

check "quote created" "true" "$([ -n "$QUOTE" ] && [ "$QUOTE" != "null" ] && echo true || echo false)"

# ── 1. Add first item ────────────────────────────────────────────────────────
echo "Add items"
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/quotes/$QUOTE/items" \
  -H "Content-Type: application/json" \
  -d "{\"productId\":\"$PROD_A\",\"quantity\":3,\"unitPrice\":10000}")
check "add item A → 201" "201" "$(http_code "$R")"
ITEM_A=$(http_body "$R" | jq -r '.data.id')
check "item A lineTotal = 30000" "30000" "$(http_body "$R" | jq -r '.data.lineTotal')"
check "quote subtotal updated" "30000" "$(http_body "$R" | jq -r '.quoteTotals.subtotalAmount')"
check "quote tax = 3000 (10%)" "3000" "$(http_body "$R" | jq -r '.quoteTotals.taxAmount')"
check "quote total = 33000" "33000" "$(http_body "$R" | jq -r '.quoteTotals.totalAmount')"

# ── 2. Add second item ───────────────────────────────────────────────────────
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/quotes/$QUOTE/items" \
  -H "Content-Type: application/json" \
  -d "{\"productId\":\"$PROD_B\",\"quantity\":2,\"unitPrice\":5000}")
check "add item B → 201" "201" "$(http_code "$R")"
ITEM_B=$(http_body "$R" | jq -r '.data.id')
check "quote subtotal after 2 items" "40000" "$(http_body "$R" | jq -r '.quoteTotals.subtotalAmount')"
check "quote total after 2 items" "44000" "$(http_body "$R" | jq -r '.quoteTotals.totalAmount')"

# ── 3. List items ────────────────────────────────────────────────────────────
echo ""
echo "List items"
R=$(curl -s "$BASE_URL/quotes/$QUOTE/items")
check "list returns 2 items" "2" "$(echo "$R" | jq -r '.count')"

# ── 4. Update item quantity ──────────────────────────────────────────────────
echo ""
echo "Update item"
R=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE_URL/quotes/$QUOTE/items/$ITEM_A" \
  -H "Content-Type: application/json" \
  -d '{"quantity":5}')
check "update item → 200" "200" "$(http_code "$R")"
check "item A lineTotal = 50000" "50000" "$(http_body "$R" | jq -r '.data.lineTotal')"
check "quote subtotal recalculated" "60000" "$(http_body "$R" | jq -r '.quoteTotals.subtotalAmount')"
check "quote total recalculated" "66000" "$(http_body "$R" | jq -r '.quoteTotals.totalAmount')"

# ── 5. Delete item ───────────────────────────────────────────────────────────
echo ""
echo "Delete item"
R=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE_URL/quotes/$QUOTE/items/$ITEM_B")
check "delete item → 200" "200" "$(http_code "$R")"
check "subtotal after delete" "50000" "$(http_body "$R" | jq -r '.quoteTotals.subtotalAmount')"
check "total after delete" "55000" "$(http_body "$R" | jq -r '.quoteTotals.totalAmount')"

# ── 6. Validation guards ─────────────────────────────────────────────────────
echo ""
echo "Validation guards"
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/quotes/$QUOTE/items" \
  -H "Content-Type: application/json" \
  -d "{\"productId\":\"$PROD_A\",\"quantity\":0,\"unitPrice\":1000}")
check "quantity=0 → 400" "400" "$(http_code "$R")"

R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/quotes/$QUOTE/items" \
  -H "Content-Type: application/json" \
  -d "{\"quantity\":1,\"unitPrice\":1000}")
check "missing productId → 400" "400" "$(http_code "$R")"

# ── 7. Non-draft quote guard ──────────────────────────────────────────────────
echo ""
echo "Non-draft guard"
curl -s -X POST "$BASE_URL/workflow/quotes/$QUOTE/submit" \
  -H "Content-Type: application/json" -d '{"userId":"user1"}' > /dev/null

R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/quotes/$QUOTE/items" \
  -H "Content-Type: application/json" \
  -d "{\"productId\":\"$PROD_A\",\"quantity\":1,\"unitPrice\":1000}")
check "add item to submitted quote → 409" "409" "$(http_code "$R")"

R=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE_URL/quotes/$QUOTE/items/$ITEM_A")
check "delete item from submitted quote → 409" "409" "$(http_code "$R")"

# ── 8. Full workflow: items → invoice ────────────────────────────────────────
echo ""
echo "Full workflow with items"
CUST2=$(make_customer "Invoice Items Corp")
PROD_C=$(make_product "Service C" 20000)
QN2="QI2-$(date +%s)-$RANDOM"
Q2=$(curl -s -X POST "$BASE_URL/quotes" \
  -H "Content-Type: application/json" \
  -d "{\"quoteNumber\":\"$QN2\",\"customerId\":\"$CUST2\",\"createdBy\":\"user1\"}" \
  | jq -r '.data.id')
curl -s -X POST "$BASE_URL/quotes/$Q2/items" \
  -H "Content-Type: application/json" \
  -d "{\"productId\":\"$PROD_C\",\"quantity\":4,\"unitPrice\":20000}" > /dev/null

QUOTE_TOTAL=$(curl -s "$BASE_URL/quotes/$Q2" | jq -r '.data.totalAmount')
curl -s -X POST "$BASE_URL/workflow/quotes/$Q2/submit" \
  -H "Content-Type: application/json" -d '{"userId":"user1"}' > /dev/null
curl -s -X POST "$BASE_URL/workflow/quotes/$Q2/approve" \
  -H "Content-Type: application/json" -d '{"userId":"approver1","notes":"ok"}' > /dev/null

R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/workflow/quotes/$Q2/invoice" \
  -H "Content-Type: application/json" -d '{"userId":"user1"}')
check "invoiced from item-based quote → 200" "200" "$(http_code "$R")"
INV_TOTAL=$(http_body "$R" | jq -r '.data.invoice.totalAmount')
check "invoice total matches quote total" "$QUOTE_TOTAL" "$INV_TOTAL"

summary
