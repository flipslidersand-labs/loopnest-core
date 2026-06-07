#!/usr/bin/env bash
# Invoice management: list/filter, and status lifecycle (issued → sent → paid / cancelled).
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Invoice Management Tests ==="
echo ""

# ── Setup: two fully-invoiced quotes ────────────────────────────────────────
make_invoiced_quote() {
  local label="$1"
  local cust prod qn qid
  cust=$(make_customer "$label Corp")
  prod=$(make_product "$label Widget" 50000)
  qn="INV-TEST-$(date +%s)-$RANDOM"
  qid=$(make_quote "$cust")
  curl -s -X POST "$BASE_URL/quotes/$qid/items" \
    -H "Content-Type: application/json" \
    -d "{\"productId\":\"$prod\",\"quantity\":2,\"unitPrice\":50000}" > /dev/null
  curl -s -X POST "$BASE_URL/workflow/quotes/$qid/submit" \
    -H "Content-Type: application/json" -d '{"userId":"u1"}' > /dev/null
  curl -s -X POST "$BASE_URL/workflow/quotes/$qid/approve" \
    -H "Content-Type: application/json" -d '{"userId":"approver1","notes":"ok"}' > /dev/null
  curl -s -X POST "$BASE_URL/workflow/quotes/$qid/invoice" \
    -H "Content-Type: application/json" -d '{"userId":"u1"}' | jq -r '.data.invoice.invoiceId'
}

INV_A=$(make_invoiced_quote "Alpha")
INV_B=$(make_invoiced_quote "Beta")
check "invoice A created" "true" "$([ -n "$INV_A" ] && [ "$INV_A" != "null" ] && echo true || echo false)"
check "invoice B created" "true" "$([ -n "$INV_B" ] && [ "$INV_B" != "null" ] && echo true || echo false)"

# ── 1. List invoices ─────────────────────────────────────────────────────────
echo ""
echo "List invoices"
R=$(curl -s "$BASE_URL/invoices")
check "GET /invoices returns data array" "true" "$(echo "$R" | jq 'has("data")')"
COUNT=$(echo "$R" | jq '.pagination.total')
check "at least 2 invoices total" "true" "$([ "${COUNT:-0}" -ge 2 ] && echo true || echo false)"

# ── 2. Get by ID ─────────────────────────────────────────────────────────────
echo ""
echo "Get by ID"
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/invoices/$INV_A")
check "GET /invoices/:id → 200" "200" "$(http_code "$R")"
check "invoice id matches" "$INV_A" "$(http_body "$R" | jq -r '.data.id')"
check "initial status is issued" "issued" "$(http_body "$R" | jq -r '.data.status')"
check "paidAt is null initially" "null" "$(http_body "$R" | jq -r '.data.paidAt')"
INV_NUM=$(http_body "$R" | jq -r '.data.invoiceNumber')

# ── 3. Get by invoice number ─────────────────────────────────────────────────
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/invoices/number/$INV_NUM")
check "GET /invoices/number/:n → 200" "200" "$(http_code "$R")"
check "invoice number matches" "$INV_NUM" "$(http_body "$R" | jq -r '.data.invoiceNumber')"

# ── 4. Filter by status ──────────────────────────────────────────────────────
echo ""
echo "Filter"
R=$(curl -s "$BASE_URL/invoices?status=issued")
ISSUED_COUNT=$(echo "$R" | jq '.pagination.total')
check "filter status=issued returns >0" "true" "$([ "${ISSUED_COUNT:-0}" -ge 2 ] && echo true || echo false)"

# ── 5. Status lifecycle: issued → sent → paid ────────────────────────────────
echo ""
echo "Status transitions (issued → sent → paid)"
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/workflow/invoices/$INV_A/send" \
  -H "Content-Type: application/json")
check "mark sent → 200" "200" "$(http_code "$R")"
check "status is sent" "sent" "$(http_body "$R" | jq -r '.data.status')"

R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/workflow/invoices/$INV_A/send" \
  -H "Content-Type: application/json")
check "re-send → 409" "409" "$(http_code "$R")"

R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/workflow/invoices/$INV_A/mark-paid" \
  -H "Content-Type: application/json")
check "mark paid → 200" "200" "$(http_code "$R")"
check "status is paid" "paid" "$(http_body "$R" | jq -r '.data.status')"
check "paidAt set" "true" "$(http_body "$R" | jq '.data.paidAt != null')"

R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/workflow/invoices/$INV_A/mark-paid" \
  -H "Content-Type: application/json")
check "re-pay → 409" "409" "$(http_code "$R")"

# ── 6. Cancel — paid invoice cannot be cancelled ─────────────────────────────
echo ""
echo "Cancel guards"
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/workflow/invoices/$INV_A/cancel" \
  -H "Content-Type: application/json")
check "cancel paid invoice → 409" "409" "$(http_code "$R")"

# ── 7. Cancel a fresh issued invoice ────────────────────────────────────────
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/workflow/invoices/$INV_B/cancel" \
  -H "Content-Type: application/json")
check "cancel issued invoice → 200" "200" "$(http_code "$R")"
check "status is cancelled" "cancelled" "$(http_body "$R" | jq -r '.data.status')"

R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/workflow/invoices/$INV_B/cancel" \
  -H "Content-Type: application/json")
check "re-cancel → 409" "409" "$(http_code "$R")"

# ── 8. Filter reflects state changes ────────────────────────────────────────
echo ""
echo "Filter after transitions"
PAID_COUNT=$(curl -s "$BASE_URL/invoices?status=paid" | jq '.pagination.total')
check "filter status=paid ≥1" "true" "$([ "${PAID_COUNT:-0}" -ge 1 ] && echo true || echo false)"
CANCELLED_COUNT=$(curl -s "$BASE_URL/invoices?status=cancelled" | jq '.pagination.total')
check "filter status=cancelled ≥1" "true" "$([ "${CANCELLED_COUNT:-0}" -ge 1 ] && echo true || echo false)"

# ── 9. RBAC: viewer cannot perform transitions ───────────────────────────────
echo ""
echo "RBAC"
DIR="$(cd "$(dirname "$0")" && pwd)"
VIEWER_TOKEN=$(node "$DIR/gen-token.mjs" viewer-user viewer)
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -X POST "$BASE_URL/workflow/invoices/$INV_A/send" \
  -H "Content-Type: application/json")
check "viewer cannot send invoice → 403" "403" "$(http_code "$R")"

# ── 10. 404 on unknown invoice ───────────────────────────────────────────────
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/invoices/00000000-0000-0000-0000-000000000000")
check "unknown invoice → 404" "404" "$(http_code "$R")"

summary
