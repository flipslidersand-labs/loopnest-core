#!/usr/bin/env bash
# Integration tests for bulk invoice operations (M25 — Issue #101)
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Bulk Invoice Operations Tests ==="
echo ""

# ── Setup ──────────────────────────────────────────────────────────────────────

CUST=$(make_customer "BulkTest Corp")
check "customer created" "true" "$([ -n "$CUST" ] && [ "$CUST" != "null" ] && echo true || echo false)"

# ── bulk-create ────────────────────────────────────────────────────────────────

echo ""
echo "POST /api/invoices/bulk-create"

BULK_BODY=$(jq -n --arg cid "$CUST" '{
  items: [
    { customerId: $cid, lineItems: [{ quantity: 2, unitPrice: 1000 }], dueDate: "2026-12-31" },
    { customerId: $cid, lineItems: [{ quantity: 1, unitPrice: 5000 }] }
  ]
}')
BCREATE=$(curl -s -X POST "$BASE_URL/invoices/bulk-create" \
  -H "Content-Type: application/json" -d "$BULK_BODY")

check "bulk-create: 2 created" "2"      "$(echo "$BCREATE" | jq '.created | length')"
check "bulk-create: 0 failed"  "0"      "$(echo "$BCREATE" | jq '.failed | length')"
check "bulk-create: status=issued" '"issued"' "$(echo "$BCREATE" | jq '.created[0].status')"
check "bulk-create: dueDate set" '"2026-12-31"' "$(echo "$BCREATE" | jq '.created[0].paymentDueDate')"

ID1=$(echo "$BCREATE" | jq -r '.created[0].id')
ID2=$(echo "$BCREATE" | jq -r '.created[1].id')

# ── bulk-status: send ──────────────────────────────────────────────────────────

echo ""
echo "POST /api/invoices/bulk-status (send)"

SEND_BODY=$(jq -n --argjson ids "[\"$ID1\",\"$ID2\"]" '{ ids: $ids, action: "send" }')
BSEND=$(curl -s -X POST "$BASE_URL/invoices/bulk-status" \
  -H "Content-Type: application/json" -d "$SEND_BODY")

check "bulk-status send: 2 succeeded" "2" "$(echo "$BSEND" | jq '.succeeded | length')"
check "bulk-status send: 0 failed"    "0" "$(echo "$BSEND" | jq '.failed | length')"

# ── bulk-status: void ──────────────────────────────────────────────────────────

echo ""
echo "POST /api/invoices/bulk-status (void)"

VOID_BODY=$(jq -n --argjson ids "[\"$ID1\"]" '{ ids: $ids, action: "void" }')
BVOID=$(curl -s -X POST "$BASE_URL/invoices/bulk-status" \
  -H "Content-Type: application/json" -d "$VOID_BODY")

check "bulk-status void: 1 succeeded" "1" "$(echo "$BVOID" | jq '.succeeded | length')"
check "bulk-status void: 0 failed"    "0" "$(echo "$BVOID" | jq '.failed | length')"

# Re-void cancelled invoice should fail gracefully (partial success)
BVOID2=$(curl -s -X POST "$BASE_URL/invoices/bulk-status" \
  -H "Content-Type: application/json" -d "$VOID_BODY")

check "bulk-status re-void: 0 succeeded" "0" "$(echo "$BVOID2" | jq '.succeeded | length')"
check "bulk-status re-void: 1 failed"    "1" "$(echo "$BVOID2" | jq '.failed | length')"

# ── validation ─────────────────────────────────────────────────────────────────

echo ""
echo "Validation"

EMPTY_STATUS=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/invoices/bulk-create" \
  -H "Content-Type: application/json" -d '{"items":[]}' | tail -1)
check "bulk-create empty items → 400" "400" "$EMPTY_STATUS"

BAD_ACTION_STATUS=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/invoices/bulk-status" \
  -H "Content-Type: application/json" \
  -d "{\"ids\":[\"$ID2\"],\"action\":\"delete\"}" | tail -1)
check "bulk-status bad action → 400" "400" "$BAD_ACTION_STATUS"

# ── export CSV ─────────────────────────────────────────────────────────────────

echo ""
echo "GET /api/invoices/export"

CSV=$(curl -s "$BASE_URL/invoices/export")
check "export: CSV header present" "true" "$(echo "$CSV" | head -1 | grep -q 'id,number,customer_id' && echo true || echo false)"

CSV_FILTERED=$(curl -s "$BASE_URL/invoices/export?status=cancelled")
check "export: filtered CSV has header" "true" "$(echo "$CSV_FILTERED" | head -1 | grep -q 'id,number,customer_id' && echo true || echo false)"
check "export: cancelled row present" "true" "$(echo "$CSV_FILTERED" | grep -q 'cancelled' && echo true || echo false)"

summary
