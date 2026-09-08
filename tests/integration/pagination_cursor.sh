#!/usr/bin/env bash
# Integration tests: cursor-based pagination (Issue #103 / M26)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

BASE="${API_BASE:-http://localhost:3000}"

# ── helpers ────────────────────────────────────────────────────────────────────

auth_header() { echo "Authorization: Bearer $(token_for viewer)"; }

jq_val() { echo "$1" | jq -r "$2"; }

# ── test: cursor pagination on invoices ───────────────────────────────────────

section "Cursor pagination — /api/invoices"

# 1. First page (limit=2)
R=$(curl -sf -H "$(auth_header)" "$BASE/api/invoices?limit=2")
check "invoices first page returns data array" \
  "$(jq_val "$R" '.data | type')" "array"
check "invoices first page returns pagination object" \
  "$(jq_val "$R" '.pagination | type')" "object"
check "invoices first page limit=2 in response" \
  "$(jq_val "$R" '.pagination.limit')" "2"

NEXT=$(jq_val "$R" '.pagination.nextCursor')

if [ "$NEXT" != "null" ] && [ -n "$NEXT" ]; then
  # 2. Second page using cursor
  R2=$(curl -sf -H "$(auth_header)" "$BASE/api/invoices?limit=2&cursor=${NEXT}")
  check "invoices second page returns data array" \
    "$(jq_val "$R2" '.data | type')" "array"
  check "invoices second page has pagination.nextCursor field" \
    "$(jq_val "$R2" '.pagination | has("nextCursor")')" "true"
  pass "cursor pagination second page OK"
else
  pass "first page is last page (nextCursor=null) — fewer than 2 invoices in DB"
fi

# 3. Bad cursor is silently ignored (falls back to first page)
R3=$(curl -sf -H "$(auth_header)" "$BASE/api/invoices?limit=5&cursor=INVALID_BASE64!!!")
check "invalid cursor returns data array (not 400)" \
  "$(jq_val "$R3" '.data | type')" "array"

# ── test: cursor pagination on customers ──────────────────────────────────────

section "Cursor pagination — /api/customers"

RC=$(curl -sf -H "$(auth_header)" "$BASE/api/customers?limit=2")
check "customers first page returns data array" \
  "$(jq_val "$RC" '.data | type')" "array"
check "customers first page has pagination.nextCursor" \
  "$(jq_val "$RC" '.pagination | has("nextCursor")')" "true"
check "customers first page limit=2" \
  "$(jq_val "$RC" '.pagination.limit')" "2"

NC=$(jq_val "$RC" '.pagination.nextCursor')
if [ "$NC" != "null" ] && [ -n "$NC" ]; then
  RC2=$(curl -sf -H "$(auth_header)" "$BASE/api/customers?limit=2&cursor=${NC}")
  check "customers second page data array" \
    "$(jq_val "$RC2" '.data | type')" "array"
  pass "customer cursor page 2 OK"
else
  pass "customers: first page is last"
fi

# ── test: cursor pagination on payments ───────────────────────────────────────

section "Cursor pagination — /api/payments"

RP=$(curl -sf -H "$(auth_header)" "$BASE/api/payments?limit=2")
check "payments first page returns data array" \
  "$(jq_val "$RP" '.data | type')" "array"
check "payments pagination.nextCursor present" \
  "$(jq_val "$RP" '.pagination | has("nextCursor")')" "true"

NP=$(jq_val "$RP" '.pagination.nextCursor')
if [ "$NP" != "null" ] && [ -n "$NP" ]; then
  RP2=$(curl -sf -H "$(auth_header)" "$BASE/api/payments?limit=2&cursor=${NP}")
  check "payments second page data array" \
    "$(jq_val "$RP2" '.data | type')" "array"
  pass "payment cursor page 2 OK"
else
  pass "payments: first page is last"
fi

# ── test: backward-compat (skip/take still works) ─────────────────────────────

section "Backward compat — legacy skip/take"

RL=$(curl -sf -H "$(auth_header)" "$BASE/api/invoices?skip=0&take=5")
check "legacy skip/take returns data array" \
  "$(jq_val "$RL" '.data | type')" "array"
check "legacy skip/take response has total (old shape)" \
  "$(jq_val "$RL" '.pagination | has("total")')" "true"

summary
