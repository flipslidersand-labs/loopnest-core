#!/usr/bin/env bash
# Idempotency-Key middleware behavior on the workflow endpoints.
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Idempotency Key Testing ==="
echo ""

CUSTOMER_ID=$(make_customer "Idem Test")

# 1. Replay with same key + same body returns the cached response.
QUOTE_ID=$(make_quote "$CUSTOMER_ID" 50000 5000 55000)
KEY="idem-$(uuidgen)"
R1=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/workflow/quotes/$QUOTE_ID/submit" \
  -H "Content-Type: application/json" -H "Idempotency-Key: $KEY" -d '{"userId":"user1"}')
R2=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/workflow/quotes/$QUOTE_ID/submit" \
  -H "Content-Type: application/json" -H "Idempotency-Key: $KEY" -d '{"userId":"user1"}')
check "First request 200" "200" "$(http_code "$R1")"
check "Replay returns 200 (not 409)" "200" "$(http_code "$R2")"
check "Replay body identical" "$(http_body "$R1")" "$(http_body "$R2")"

# 2. Same key, different body -> 422.
R3=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/workflow/quotes/$QUOTE_ID/submit" \
  -H "Content-Type: application/json" -H "Idempotency-Key: $KEY" -d '{"userId":"someone-else"}')
check "Different body → 422" "422" "$(http_code "$R3")"
check "Error code IDEMPOTENCY_KEY_CONFLICT" "IDEMPOTENCY_KEY_CONFLICT" \
  "$(http_body "$R3" | jq -r '.error.code')"

# 3. No key -> normal state-conflict path (409) still applies.
R4=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/workflow/quotes/$QUOTE_ID/submit" \
  -H "Content-Type: application/json" -d '{"userId":"user1"}')
check "No key, state conflict → 409" "409" "$(http_code "$R4")"

# 4. Fresh key on a new quote works.
Q2=$(make_quote "$CUSTOMER_ID" 30000 3000 33000)
R5=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/workflow/quotes/$Q2/submit" \
  -H "Content-Type: application/json" -H "Idempotency-Key: idem-$(uuidgen)" -d '{"userId":"user1"}')
check "Fresh key on new quote → 200" "200" "$(http_code "$R5")"

# 5. Concurrent retries with one key (network-flap) -> no double-submit.
Q3=$(make_quote "$CUSTOMER_ID" 10000 1000 11000)
KEY3="idem-$(uuidgen)"
tmp=$(mktemp -d)
for i in $(seq 1 5); do
  curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/workflow/quotes/$Q3/submit" \
    -H "Content-Type: application/json" -H "Idempotency-Key: $KEY3" -d '{"userId":"user1"}' \
    > "$tmp/code_$i.txt" &
done
wait
ok=0; inflight=0
for i in $(seq 1 5); do
  c=$(cat "$tmp/code_$i.txt")
  [ "$c" = "200" ] && ((ok++))
  [ "$c" = "409" ] && ((inflight++))
done
FINAL=$(curl -s "$BASE_URL/workflow/quotes/$Q3/status" | jq -r '.data.quote.status')
check "Concurrent retries: no double-submit" "pending_approval" "$FINAL"
echo "  (concurrent results: $ok x 200, $inflight x 409)"
rm -rf "$tmp"

summary
