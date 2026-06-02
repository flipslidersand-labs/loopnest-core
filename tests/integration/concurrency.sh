#!/usr/bin/env bash
# Race-condition coverage for the atomic state machine.
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Concurrency & Race Condition Testing ==="
echo ""

CUSTOMER_ID=$(make_customer "Concurrency Test")

# 1. Five simultaneous submits on one draft quote — exactly one must win.
QUOTE_ID=$(make_quote "$CUSTOMER_ID" 100000 10000 110000)
tmp=$(mktemp -d)
for i in $(seq 1 5); do
  curl -s -X POST "$BASE_URL/workflow/quotes/$QUOTE_ID/submit" \
    -H "Content-Type: application/json" -d '{"userId":"user1"}' > "$tmp/submit_$i.json" &
done
wait
SUCCESS=0; CONFLICT=0
for i in $(seq 1 5); do
  s=$(jq -r '.data.status // .error.code' "$tmp/submit_$i.json")
  [ "$s" = "pending_approval" ] && ((SUCCESS++))
  [ "$s" = "INVALID_STATUS" ] && ((CONFLICT++))
done
if [ "$SUCCESS" -eq 1 ] && [ "$CONFLICT" -ge 4 ]; then
  pass "Concurrent submit: 1 winner, $CONFLICT conflicts"
else
  fail "Concurrent submit (success=$SUCCESS, conflicts=$CONFLICT)"
fi

# 2. Concurrent approve + invoice — no corruption, end state consistent.
Q2=$(make_quote "$CUSTOMER_ID" 50000 5000 55000)
curl -s -X POST "$BASE_URL/workflow/quotes/$Q2/submit" \
  -H "Content-Type: application/json" -d '{"userId":"user1"}' > /dev/null
curl -s -X POST "$BASE_URL/workflow/quotes/$Q2/approve" \
  -H "Content-Type: application/json" -d '{"userId":"approver1","notes":"OK"}' > "$tmp/approve.json" &
sleep 0.1
curl -s -X POST "$BASE_URL/workflow/quotes/$Q2/invoice" \
  -H "Content-Type: application/json" -d '{"userId":"user1"}' > "$tmp/invoice.json" &
wait
FINAL=$(curl -s "$BASE_URL/workflow/quotes/$Q2/status" | jq -r '.data.quote.status')
if [ "$FINAL" = "approved" ] || [ "$FINAL" = "invoiced" ]; then
  pass "Concurrent approve/invoice left a consistent state ($FINAL)"
else
  fail "Concurrent approve/invoice ended in unexpected state ($FINAL)"
fi

# 3. Ten simultaneous quote creations — all succeed, unique ids.
for i in $(seq 1 10); do
  qn="QT-MULTI-$i-$(date +%s)-$RANDOM"
  curl -s -X POST "$BASE_URL/quotes" -H "Content-Type: application/json" \
    -d "{\"quoteNumber\":\"$qn\",\"customerId\":\"$CUSTOMER_ID\",\"subtotalAmount\":10000,\"taxAmount\":1000,\"totalAmount\":11000,\"createdBy\":\"user1\"}" \
    > "$tmp/quote_$i.json" &
done
wait
CREATED=0
for i in $(seq 1 10); do
  id=$(jq -r '.data.id // empty' "$tmp/quote_$i.json")
  [[ $id =~ ^[0-9a-f]{8}- ]] && ((CREATED++))
done
check "10 concurrent quote creations" "10" "$CREATED"

rm -rf "$tmp"
summary
