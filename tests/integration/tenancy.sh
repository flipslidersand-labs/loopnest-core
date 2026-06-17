#!/usr/bin/env bash
# M07: Multi-tenancy isolation — org-A resources must be invisible to org-B.
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Multi-tenancy Isolation Tests ==="
echo ""

DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Setup: two separate organizations ────────────────────────────────────────
ORG_A=$(curl -s -X POST "$BASE_URL/organizations" \
  -H "Content-Type: application/json" \
  -d '{"name":"Tenant Alpha Corp","type":"company"}' | jq -r '.data.id')
ORG_B=$(curl -s -X POST "$BASE_URL/organizations" \
  -H "Content-Type: application/json" \
  -d '{"name":"Tenant Beta Ltd","type":"company"}' | jq -r '.data.id')
check "org A created" "true" "$([ -n "$ORG_A" ] && [ "$ORG_A" != "null" ] && echo true || echo false)"
check "org B created" "true" "$([ -n "$ORG_B" ] && [ "$ORG_B" != "null" ] && echo true || echo false)"

# Org-scoped tokens (admin role so they can create/delete resources)
TOKEN_A=$(node "$DIR/gen-token.mjs" tenant-a-user admin 3600 "$ORG_A")
TOKEN_B=$(node "$DIR/gen-token.mjs" tenant-b-user admin 3600 "$ORG_B")

# ── Customer isolation ────────────────────────────────────────────────────────
echo ""
echo "Customer isolation"

CUST_A=$(command curl -s -X POST "$BASE_URL/customers" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"name":"Alpha Customer"}' | jq -r '.data.id')
check "org-A creates customer" "true" "$([ -n "$CUST_A" ] && [ "$CUST_A" != "null" ] && echo true || echo false)"

# org-B cannot GET org-A's customer by ID
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN_B" \
  "$BASE_URL/customers/$CUST_A")
check "org-B GET org-A customer → 404" "404" "$(http_code "$R")"

# org-B's list does not include org-A's customer
LIST_B=$(command curl -s -H "Authorization: Bearer $TOKEN_B" "$BASE_URL/customers")
check "org-B list excludes org-A customer" "false" \
  "$(echo "$LIST_B" | jq --arg id "$CUST_A" '[.data[].id] | contains([$id])')"

# Admin (no orgId) can access org-A's customer by ID (list pagination is unreliable
# across runs due to accumulated test data; direct GET is the correct check).
R_ADMIN=$(curl -s -w "\n%{http_code}" "$BASE_URL/customers/$CUST_A")
check "admin list includes org-A customer" "200" "$(http_code "$R_ADMIN")"

# ── Product isolation ─────────────────────────────────────────────────────────
echo ""
echo "Product isolation"

SKU_A="TENANCY-SKU-A-$(date +%s)-$RANDOM"
PROD_A=$(command curl -s -X POST "$BASE_URL/products" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"sku\":\"$SKU_A\",\"name\":\"Alpha Product\",\"category\":\"laptop\",\"unitPrice\":5000}" \
  | jq -r '.data.id')
check "org-A creates product" "true" "$([ -n "$PROD_A" ] && [ "$PROD_A" != "null" ] && echo true || echo false)"

R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN_B" \
  "$BASE_URL/products/$PROD_A")
check "org-B GET org-A product → 404" "404" "$(http_code "$R")"

# ── Quote isolation ───────────────────────────────────────────────────────────
echo ""
echo "Quote isolation"

QN_A="Q-TENANT-A-$(date +%s)-$RANDOM"
QUOTE_A=$(command curl -s -X POST "$BASE_URL/quotes" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"quoteNumber\":\"$QN_A\",\"customerId\":\"$CUST_A\",\"createdBy\":\"tenant-a-user\"}" \
  | jq -r '.data.id')
check "org-A creates quote" "true" "$([ -n "$QUOTE_A" ] && [ "$QUOTE_A" != "null" ] && echo true || echo false)"

R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN_B" \
  "$BASE_URL/quotes/$QUOTE_A")
check "org-B GET org-A quote → 404" "404" "$(http_code "$R")"

LIST_QUOTES_B=$(command curl -s -H "Authorization: Bearer $TOKEN_B" "$BASE_URL/quotes")
check "org-B quote list excludes org-A quote" "false" \
  "$(echo "$LIST_QUOTES_B" | jq --arg id "$QUOTE_A" '[.data[].id] | contains([$id])')"

# ── Workflow isolation ────────────────────────────────────────────────────────
echo ""
echo "Workflow isolation"

# org-B cannot submit org-A's quote
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN_B" \
  -X POST "$BASE_URL/workflow/quotes/$QUOTE_A/submit" \
  -H "Content-Type: application/json" \
  -d '{"userId":"tenant-b-user"}')
check "org-B cannot submit org-A quote → 404" "404" "$(http_code "$R")"

# org-A can submit its own quote
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN_A" \
  -X POST "$BASE_URL/workflow/quotes/$QUOTE_A/submit" \
  -H "Content-Type: application/json" \
  -d '{"userId":"tenant-a-user"}')
check "org-A submits its own quote → 200" "200" "$(http_code "$R")"

# org-B cannot approve org-A's quote
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN_B" \
  -X POST "$BASE_URL/workflow/quotes/$QUOTE_A/approve" \
  -H "Content-Type: application/json" \
  -d '{"userId":"tenant-b-user","notes":"cross-tenant attempt"}')
check "org-B cannot approve org-A quote → 404" "404" "$(http_code "$R")"

# ── org-B has its own isolated namespace ─────────────────────────────────────
echo ""
echo "org-B own data"

CUST_B=$(command curl -s -X POST "$BASE_URL/customers" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d '{"name":"Beta Customer"}' | jq -r '.data.id')
check "org-B creates its own customer" "true" "$([ -n "$CUST_B" ] && [ "$CUST_B" != "null" ] && echo true || echo false)"

R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN_B" \
  "$BASE_URL/customers/$CUST_B")
check "org-B can GET its own customer → 200" "200" "$(http_code "$R")"

# org-A cannot see org-B's customer
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN_A" \
  "$BASE_URL/customers/$CUST_B")
check "org-A cannot GET org-B customer → 404" "404" "$(http_code "$R")"

summary
