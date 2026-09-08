#!/usr/bin/env bash
# Integration tests: cursor-based pagination (Issue #103 / M26)
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Cursor-based Pagination Tests ==="
echo ""

jq_val() { echo "$1" | jq -r "$2"; }

# ── Cursor pagination on invoices ─────────────────────────────────────────────

echo "GET /api/invoices?limit=2 (cursor mode)"

R=$(curl -s "$BASE_URL/invoices?limit=2")
check "invoices first page data array" \
  "$(jq_val "$R" '.data | type')" "array"
check "invoices first page pagination object" \
  "$(jq_val "$R" '.pagination | type')" "object"
check "invoices first page limit=2 in response" \
  "$(jq_val "$R" '.pagination.limit')" "2"
check "invoices first page nextCursor field present" \
  "$(jq_val "$R" '.pagination | has("nextCursor")')" "true"

NEXT=$(jq_val "$R" '.pagination.nextCursor')

if [ "$NEXT" != "null" ] && [ -n "$NEXT" ]; then
  echo "GET /api/invoices?limit=2&cursor=<next>"
  R2=$(curl -s "$BASE_URL/invoices?limit=2&cursor=${NEXT}")
  check "invoices second page data array" \
    "$(jq_val "$R2" '.data | type')" "array"
  check "invoices second page has nextCursor" \
    "$(jq_val "$R2" '.pagination | has("nextCursor")')" "true"
else
  pass "invoices: only one page (nextCursor=null)"
fi

echo "GET /api/invoices?limit=5&cursor=INVALID (bad cursor ignored)"
R3=$(curl -s "$BASE_URL/invoices?limit=5&cursor=INVALID_CURSOR__")
check "invalid cursor returns array not 400" \
  "$(jq_val "$R3" '.data | type')" "array"

# ── Cursor pagination on customers ────────────────────────────────────────────

echo ""
echo "GET /api/customers?limit=2 (cursor mode)"

RC=$(curl -s "$BASE_URL/customers?limit=2")
check "customers first page data array" \
  "$(jq_val "$RC" '.data | type')" "array"
check "customers first page pagination.nextCursor present" \
  "$(jq_val "$RC" '.pagination | has("nextCursor")')" "true"
check "customers first page limit=2" \
  "$(jq_val "$RC" '.pagination.limit')" "2"

NC=$(jq_val "$RC" '.pagination.nextCursor')
if [ "$NC" != "null" ] && [ -n "$NC" ]; then
  RC2=$(curl -s "$BASE_URL/customers?limit=2&cursor=${NC}")
  check "customers second page data array" \
    "$(jq_val "$RC2" '.data | type')" "array"
else
  pass "customers: only one page"
fi

# ── Cursor pagination on payments ─────────────────────────────────────────────

echo ""
echo "GET /api/payments?limit=2 (cursor mode)"

RP=$(curl -s "$BASE_URL/payments?limit=2")
check "payments first page data array" \
  "$(jq_val "$RP" '.data | type')" "array"
check "payments first page pagination.nextCursor present" \
  "$(jq_val "$RP" '.pagination | has("nextCursor")')" "true"

NP=$(jq_val "$RP" '.pagination.nextCursor')
if [ "$NP" != "null" ] && [ -n "$NP" ]; then
  RP2=$(curl -s "$BASE_URL/payments?limit=2&cursor=${NP}")
  check "payments second page data array" \
    "$(jq_val "$RP2" '.data | type')" "array"
else
  pass "payments: only one page"
fi

# ── Backward compat — legacy skip/take still returns old shape ────────────────

echo ""
echo "GET /api/invoices?skip=0&take=5 (legacy)"

RL=$(curl -s "$BASE_URL/invoices?skip=0&take=5")
check "legacy skip/take returns data array" \
  "$(jq_val "$RL" '.data | type')" "array"
check "legacy response has total field (old shape)" \
  "$(jq_val "$RL" '.pagination | has("total")')" "true"

echo ""
summary
