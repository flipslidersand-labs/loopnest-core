#!/usr/bin/env bash
# Sliding-window rate limiter on the workflow bucket (60 req / 60s).
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Rate Limiting Tests ==="
echo ""

# 1. RateLimit-* headers on a normal request.
HEADERS=$(curl -s -D - -o /dev/null "$BASE_URL/customers?take=1")
check "RateLimit-Limit header present" "1" "$(echo "$HEADERS" | grep -ic 'ratelimit-limit')"
check "RateLimit-Remaining header present" "1" "$(echo "$HEADERS" | grep -ic 'ratelimit-remaining')"

# 2. Hammer the workflow bucket past its 60/min cap. A non-existent quote
#    returns 404 quickly but still counts against the limit.
echo ""
echo "Workflow rate limit (60/min) → 429 after threshold"
FAKE="00000000-0000-0000-0000-000000000000"
blocked=0
for i in $(seq 1 75); do
  c=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/workflow/quotes/$FAKE/submit" \
    -H "Content-Type: application/json" -d '{"userId":"user1"}')
  [ "$c" = "429" ] && ((blocked++))
done
echo "  429 responses: $blocked / 75"
if [ "$blocked" -ge 10 ]; then
  pass "Rate limit triggered ($blocked blocked)"
else
  fail "Rate limit under-triggered ($blocked blocked, expected >=10)"
fi

# 3. 429 carries Retry-After.
RA=$(curl -s -D - -o /dev/null -X POST "$BASE_URL/workflow/quotes/$FAKE/submit" \
  -H "Content-Type: application/json" -d '{"userId":"user1"}' | grep -ic 'retry-after')
check "Retry-After header on 429" "1" "$RA"

summary
