#!/usr/bin/env bash
# Full quote-to-invoice happy path: CREATE -> SUBMIT -> APPROVE -> INVOICE.
set +e
source "$(dirname "$0")/lib.sh"

echo "=== E2E Workflow Test (CREATE → SUBMIT → APPROVE → INVOICE) ==="
echo ""

CUSTOMER_ID=$(make_customer "E2E Corp")
check "Customer created" "true" "$([[ $CUSTOMER_ID =~ ^[0-9a-f]{8}- ]] && echo true || echo false)"

QUOTE_ID=$(make_quote "$CUSTOMER_ID")
STATUS=$(curl -s "$BASE_URL/workflow/quotes/$QUOTE_ID/status" | jq -r '.data.quote.status')
check "Quote created (draft)" "draft" "$STATUS"

SUBMIT=$(curl -s -X POST "$BASE_URL/workflow/quotes/$QUOTE_ID/submit" \
  -H "Content-Type: application/json" -d '{"userId":"user1"}')
check "Quote submitted (pending_approval)" "pending_approval" "$(echo "$SUBMIT" | jq -r '.data.status')"

APPROVE=$(curl -s -X POST "$BASE_URL/workflow/quotes/$QUOTE_ID/approve" \
  -H "Content-Type: application/json" -d '{"userId":"approver1","notes":"OK"}')
check "Quote approved (approved)" "approved" "$(echo "$APPROVE" | jq -r '.data.status')"

INVOICE=$(curl -s -X POST "$BASE_URL/workflow/quotes/$QUOTE_ID/invoice" \
  -H "Content-Type: application/json" -d '{"userId":"user1"}')
check "Quote final status (invoiced)" "invoiced" "$(echo "$INVOICE" | jq -r '.data.quote.status')"
check "Invoice number issued" "true" \
  "$([[ $(echo "$INVOICE" | jq -r '.data.invoice.invoiceNumber') =~ ^INV- ]] && echo true || echo false)"

summary
