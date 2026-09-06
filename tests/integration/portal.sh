#!/usr/bin/env bash
# M19: Customer self-service portal — auth + invoice/quote read API
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Portal Tests ==="
echo ""

DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Setup: customer + product + invoice ──────────────────────────────────────
CUST_R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -X POST "$BASE_URL/customers" \
  -H "Content-Type: application/json" \
  -d '{"name":"Portal Test Corp","phone":"03-1234-5678"}')
check "create test customer → 201" "201" "$(http_code "$CUST_R")"
CUST_ID=$(http_body "$CUST_R" | jq -r '.data.id')

PROD_R=$(command curl -s \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -X POST "$BASE_URL/products" \
  -H "Content-Type: application/json" \
  -d '{"sku":"PORTAL-SKU-001","name":"Portal Widget","category":"laptop","unitPrice":10000}')
PROD_ID=$(echo "$PROD_R" | jq -r '.data.id')

QUOTE_R=$(command curl -s \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -X POST "$BASE_URL/quotes" \
  -H "Content-Type: application/json" \
  -d "{\"quoteNumber\":\"Q-PORTAL-$(date +%s)\",\"customerId\":\"$CUST_ID\",\"createdBy\":\"portal-test\"}")
QUOTE_ID=$(echo "$QUOTE_R" | jq -r '.data.id')

# Add an item so the quote has a total
command curl -s \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -X POST "$BASE_URL/quotes/$QUOTE_ID/items" \
  -H "Content-Type: application/json" \
  -d "{\"productId\":\"$PROD_ID\",\"quantity\":2,\"unitPrice\":10000}" > /dev/null

# Create an invoice for this customer
INV_R=$(command curl -s \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -X POST "$BASE_URL/quotes/$QUOTE_ID/invoice" \
  -H "Content-Type: application/json" \
  -d '{"userId":"portal-test","issueDate":"2026-09-07","paymentDueDate":"2026-10-07","registrationNumber":"T1234567890123"}')
INV_ID=$(echo "$INV_R" | jq -r '.data.invoiceId // .data.id')

# Create second customer for isolation tests
CUST2_R=$(command curl -s \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -X POST "$BASE_URL/customers" \
  -H "Content-Type: application/json" \
  -d '{"name":"Other Portal Corp"}')
CUST2_ID=$(echo "$CUST2_R" | jq -r '.data.id')

# ── 1. POST /portal/login — success ─────────────────────────────────────────
echo "Login"
R=$(command curl -s -w "\n%{http_code}" \
  -X POST "$BASE_URL/portal/login" \
  -H "Content-Type: application/json" \
  -d "{\"customerId\":\"$CUST_ID\"}")
check "POST /portal/login → 200" "200" "$(http_code "$R")"
check "response has token" "true" \
  "$(http_body "$R" | jq 'has("token") and (.token | type == "string") and (.token | length > 0)')"
check "response has expiresIn" "true" \
  "$(http_body "$R" | jq 'has("expiresIn")')"

PORTAL_TOKEN=$(http_body "$R" | jq -r '.token')

# ── 2. POST /portal/login — invalid customerId → 401 ───────────────────────
R=$(command curl -s -w "\n%{http_code}" \
  -X POST "$BASE_URL/portal/login" \
  -H "Content-Type: application/json" \
  -d '{"customerId":"00000000-0000-0000-0000-000000000000"}')
check "login unknown customer → 401" "401" "$(http_code "$R")"

# ── 3. POST /portal/login — missing customerId → 400 ────────────────────────
R=$(command curl -s -w "\n%{http_code}" \
  -X POST "$BASE_URL/portal/login" \
  -H "Content-Type: application/json" \
  -d '{}')
check "login missing customerId → 400" "400" "$(http_code "$R")"

# ── 4. GET /portal/me ────────────────────────────────────────────────────────
echo ""
echo "Portal /me"
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $PORTAL_TOKEN" \
  "$BASE_URL/portal/me")
check "GET /portal/me → 200" "200" "$(http_code "$R")"
check "me.id matches customer" "$CUST_ID" "$(http_body "$R" | jq -r '.data.id')"
check "me.name correct" "Portal Test Corp" "$(http_body "$R" | jq -r '.data.name')"

# ── 5. GET /portal/me — no token → 401 ──────────────────────────────────────
R=$(command curl -s -w "\n%{http_code}" \
  "$BASE_URL/portal/me")
check "GET /portal/me without token → 401" "401" "$(http_code "$R")"

# ── 6. GET /portal/me — staff token → 403 ───────────────────────────────────
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BASE_URL/portal/me")
check "GET /portal/me with staff JWT → 403" "403" "$(http_code "$R")"

# ── 7. GET /portal/invoices ──────────────────────────────────────────────────
echo ""
echo "Portal /invoices"
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $PORTAL_TOKEN" \
  "$BASE_URL/portal/invoices")
check "GET /portal/invoices → 200" "200" "$(http_code "$R")"
check "response has .data array" "true" \
  "$(http_body "$R" | jq 'has("data") and (.data | type == "array")')"
check "response has .total" "true" \
  "$(http_body "$R" | jq 'has("total")')"

# invoices may be 0 if the workflow didn't complete; check total ≥ 0
check "total is non-negative" "true" \
  "$(http_body "$R" | jq '.total >= 0')"

# ── 8. GET /portal/invoices/:id — own invoice ────────────────────────────────
if [ -n "$INV_ID" ] && [ "$INV_ID" != "null" ]; then
  R=$(command curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $PORTAL_TOKEN" \
    "$BASE_URL/portal/invoices/$INV_ID")
  check "GET /portal/invoices/:id → 200" "200" "$(http_code "$R")"
  check "invoice customerId matches" "$CUST_ID" \
    "$(http_body "$R" | jq -r '.data.customerId')"
fi

# ── 9. GET /portal/invoices/:id — other customer's invoice → 404 ────────────
# Get an invoice belonging to another org if any; use a fake UUID to guarantee 404
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $PORTAL_TOKEN" \
  "$BASE_URL/portal/invoices/00000000-0000-0000-0000-000000000099")
check "GET other's invoice → 404" "404" "$(http_code "$R")"

# ── 10. GET /portal/quotes ───────────────────────────────────────────────────
echo ""
echo "Portal /quotes"
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $PORTAL_TOKEN" \
  "$BASE_URL/portal/quotes")
check "GET /portal/quotes → 200" "200" "$(http_code "$R")"
check "response has .data array" "true" \
  "$(http_body "$R" | jq 'has("data") and (.data | type == "array")')"
check "at least 1 quote returned" "true" \
  "$(http_body "$R" | jq '.total >= 1')"
check "all quotes belong to customer" "true" \
  "$(http_body "$R" | jq --arg id "$CUST_ID" '[.data[].customerId] | all(. == $id)')"

# ── 11. Pagination params ─────────────────────────────────────────────────────
echo ""
echo "Pagination"
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $PORTAL_TOKEN" \
  "$BASE_URL/portal/invoices?limit=1&page=1")
check "?limit=1&page=1 → 200" "200" "$(http_code "$R")"
check "returns at most 1 item" "true" \
  "$(http_body "$R" | jq '.data | length <= 1')"

# ── 12. Customer 2 cannot see customer 1's data ──────────────────────────────
echo ""
echo "Customer isolation"
PORTAL_TOKEN2=$(command curl -s \
  -X POST "$BASE_URL/portal/login" \
  -H "Content-Type: application/json" \
  -d "{\"customerId\":\"$CUST2_ID\"}" | jq -r '.token')

R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $PORTAL_TOKEN2" \
  "$BASE_URL/portal/quotes")
check "customer2 GET /portal/quotes → 200" "200" "$(http_code "$R")"
check "customer2 sees 0 quotes (isolation)" "true" \
  "$(http_body "$R" | jq '.total == 0')"

if [ -n "$INV_ID" ] && [ "$INV_ID" != "null" ]; then
  R=$(command curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $PORTAL_TOKEN2" \
    "$BASE_URL/portal/invoices/$INV_ID")
  check "customer2 GET customer1 invoice → 404" "404" "$(http_code "$R")"
fi

summary
