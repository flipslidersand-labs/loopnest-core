#!/usr/bin/env bash
# Error-path coverage: invalid states, missing resources, constraint violations.
# State conflicts return 409; bad input / missing fields return 400/404.
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Error Scenario Testing ==="
echo ""

CUSTOMER_ID=$(make_customer "Error Test Corp")
QUOTE_ID=$(make_quote "$CUSTOMER_ID" 100000 10000 110000)

# 1. Duplicate submit — second one loses the state transition (409).
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/workflow/quotes/$QUOTE_ID/submit" \
  -H "Content-Type: application/json" -d '{"userId":"user1"}')
check "Submit quote first time" "200" "$(http_code "$R")"
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/workflow/quotes/$QUOTE_ID/submit" \
  -H "Content-Type: application/json" -d '{"userId":"user1"}')
check "Submit quote second time (409)" "409" "$(http_code "$R")"

# 2. Approve a draft quote (wrong state).
Q2=$(make_quote "$CUSTOMER_ID" 50000 5000 55000)
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/workflow/quotes/$Q2/approve" \
  -H "Content-Type: application/json" -d '{"userId":"approver1","notes":"x"}')
check "Approve draft quote (409)" "409" "$(http_code "$R")"

# 3. Reject then approve — approve on a rejected quote fails.
Q3=$(make_quote "$CUSTOMER_ID" 75000 7500 82500)
curl -s -X POST "$BASE_URL/workflow/quotes/$Q3/submit" \
  -H "Content-Type: application/json" -d '{"userId":"user1"}' > /dev/null
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/workflow/quotes/$Q3/reject" \
  -H "Content-Type: application/json" -d '{"userId":"user1","reason":"Quality"}')
check "Reject quote" "200" "$(http_code "$R")"
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/workflow/quotes/$Q3/approve" \
  -H "Content-Type: application/json" -d '{"userId":"approver1","notes":"x"}')
check "Approve rejected quote (409)" "409" "$(http_code "$R")"

# 4. Non-existent / malformed quote id.
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/workflow/quotes/invalid-id/submit" \
  -H "Content-Type: application/json" -d '{"userId":"user1"}')
check "Submit non-existent quote (404)" "404" "$(http_code "$R")"

# 5. Foreign key violation — customer that does not exist.
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/quotes" \
  -H "Content-Type: application/json" \
  -d '{"quoteNumber":"QT-NOCUST","customerId":"00000000-0000-0000-0000-000000000000","subtotalAmount":1000,"taxAmount":100,"totalAmount":1100,"createdBy":"user1"}')
check "Create quote, missing customer (400)" "400" "$(http_code "$R")"

# 6. Missing required fields.
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/quotes" \
  -H "Content-Type: application/json" -d "{\"customerId\":\"$CUSTOMER_ID\"}")
check "Create quote, missing fields (400)" "400" "$(http_code "$R")"

# 7. Invoice a draft quote.
Q4=$(make_quote "$CUSTOMER_ID" 30000 3000 33000)
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/workflow/quotes/$Q4/invoice" \
  -H "Content-Type: application/json" -d '{"userId":"user1"}')
check "Invoice draft quote (409)" "409" "$(http_code "$R")"

# 8. Full workflow then double-invoice.
curl -s -X POST "$BASE_URL/workflow/quotes/$QUOTE_ID/approve" \
  -H "Content-Type: application/json" -d '{"userId":"approver1","notes":"OK"}' > /dev/null
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/workflow/quotes/$QUOTE_ID/invoice" \
  -H "Content-Type: application/json" -d '{"userId":"user1"}')
check "Create invoice first time" "200" "$(http_code "$R")"
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/workflow/quotes/$QUOTE_ID/invoice" \
  -H "Content-Type: application/json" -d '{"userId":"user1"}')
check "Create invoice second time (409)" "409" "$(http_code "$R")"

summary
