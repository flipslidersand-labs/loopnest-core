#!/usr/bin/env bash
# Shared helpers for LoopNest Core integration tests.
# Source this from each test script: `source "$(dirname "$0")/lib.sh"`

BASE_URL="${BASE_URL:-http://localhost:3000/api}"

# Transparently inject the auth token into every curl call.
# auth.sh bypasses this for specific token scenarios using `command curl`.
AUTH_TOKEN="${AUTH_TOKEN:-}"
curl() {
  if [ -n "$AUTH_TOKEN" ]; then
    command curl -H "Authorization: Bearer $AUTH_TOKEN" "$@"
  else
    command curl "$@"
  fi
}

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0

# check <name> <expected> <actual>
check() {
  local name=$1 expected=$2 actual=$3
  if [ "$expected" = "$actual" ]; then
    echo -e "${GREEN}✓${NC} $name"
    ((PASS++))
  else
    echo -e "${RED}✗${NC} $name (expected: $expected, actual: $actual)"
    ((FAIL++))
  fi
}

# pass/fail with a free-form message
pass() { echo -e "${GREEN}✓${NC} $1"; ((PASS++)); }
fail() { echo -e "${RED}✗${NC} $1"; ((FAIL++)); }

# Split a `curl -w "\n%{http_code}"` response into body / code.
http_code() { echo "$1" | tail -1; }
http_body() { echo "$1" | sed '$d'; }

summary() {
  echo ""
  echo "=== Results ==="
  echo -e "${GREEN}Passed: $PASS${NC}"
  echo -e "${RED}Failed: $FAIL${NC}"
  [ "$FAIL" -eq 0 ] && return 0 || return 1
}

# Create a customer, echo its id.
make_customer() {
  local name="${1:-Test Corp}"
  curl -s -X POST "$BASE_URL/customers" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"phone\":\"0123456789\",\"address\":\"123 Test St\"}" \
    | jq -r '.data.id'
}

# make_quote <customerId> [subtotal] [tax] [total]  -> echoes quote id
make_quote() {
  local customer_id=$1
  local subtotal="${2:-150000}" tax="${3:-15000}" total="${4:-165000}"
  local qn="QT-$(date +%s)-$RANDOM"
  curl -s -X POST "$BASE_URL/quotes" \
    -H "Content-Type: application/json" \
    -d "{\"quoteNumber\":\"$qn\",\"customerId\":\"$customer_id\",\"subtotalAmount\":$subtotal,\"taxAmount\":$tax,\"totalAmount\":$total,\"createdBy\":\"user1\"}" \
    | jq -r '.data.id'
}

# Drive a quote all the way to invoiced, echo the invoiceId.
make_invoice() {
  local customer_id qid invoice
  customer_id=$(make_customer "Outbox Corp")
  qid=$(make_quote "$customer_id")
  curl -s -X POST "$BASE_URL/workflow/quotes/$qid/submit" \
    -H "Content-Type: application/json" -d '{"userId":"user1"}' > /dev/null
  curl -s -X POST "$BASE_URL/workflow/quotes/$qid/approve" \
    -H "Content-Type: application/json" -d '{"userId":"approver1","notes":"ok"}' > /dev/null
  invoice=$(curl -s -X POST "$BASE_URL/workflow/quotes/$qid/invoice" \
    -H "Content-Type: application/json" -d '{"userId":"user1"}')
  # echo "<quoteId> <invoiceId>"
  echo "$qid $(echo "$invoice" | jq -r '.data.invoice.invoiceId')"
}

# Run a query against the app database; echoes a single scalar.
PSQL_URL="${DATABASE_URL:-postgres://loopnest:loopnest_dev_password@localhost:5432/omni_local}"
db_scalar() { psql "$PSQL_URL" -tA -c "$1" 2>/dev/null; }
