#!/usr/bin/env bash
# M11: Search API — cross-resource full-text search with org-scoping, type filter, and pagination.
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Search Tests ==="
echo ""

# ── Seed data ─────────────────────────────────────────────────────────────────
# Use a unique suffix so test data doesn't collide with other suites.
SUFFIX="SRCH$(date +%s)"

CUST_ID=$(curl -s -X POST "$BASE_URL/customers" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Acme ${SUFFIX} Corp\",\"address\":\"123 ${SUFFIX} Avenue\",\"phone\":\"0112345678\"}" \
  | jq -r '.data.id')
check "customer seed" "true" "$([ -n "$CUST_ID" ] && [ "$CUST_ID" != "null" ] && echo true || echo false)"

PROD_ID=$(curl -s -X POST "$BASE_URL/products" \
  -H "Content-Type: application/json" \
  -d "{\"sku\":\"SKU-${SUFFIX}\",\"name\":\"Thunderbolt ${SUFFIX} Hub\",\"category\":\"laptop\",\"unitPrice\":29800}" \
  | jq -r '.data.id')
check "product seed" "true" "$([ -n "$PROD_ID" ] && [ "$PROD_ID" != "null" ] && echo true || echo false)"

QID=$(curl -s -X POST "$BASE_URL/quotes" \
  -H "Content-Type: application/json" \
  -d "{\"quoteNumber\":\"Q-${SUFFIX}\",\"customerId\":\"$CUST_ID\",\"createdBy\":\"searcher-${SUFFIX}\",\"notes\":\"Note for ${SUFFIX} project\"}" \
  | jq -r '.data.id')
check "quote seed" "true" "$([ -n "$QID" ] && [ "$QID" != "null" ] && echo true || echo false)"

echo ""

# ── 1. Basic full-text match across all types ─────────────────────────────────
echo "Basic search"
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/search?q=${SUFFIX}")
check "GET /search → 200" "200" "$(http_code "$R")"

BODY=$(http_body "$R")
check "returns data array" "true" "$(echo "$BODY" | jq 'has("data")')"
check "returns pagination" "true" "$(echo "$BODY" | jq 'has("pagination")')"
check "returns query echo" "${SUFFIX}" "$(echo "$BODY" | jq -r '.query')"
check "finds ≥3 results (customer+product+quote)" "true" \
  "$(echo "$BODY" | jq '.pagination.total >= 3')"

TYPES_FOUND=$(echo "$BODY" | jq '[.data[].type] | unique | sort | join(",")')
check "all three resource types returned" '"customer,product,quote"' "$TYPES_FOUND"

# ── 2. Customer match by name ─────────────────────────────────────────────────
echo ""
echo "Customer match"
R=$(curl -s "$BASE_URL/search?q=${SUFFIX}&types=customer")
check "customer result has correct id" "$CUST_ID" \
  "$(echo "$R" | jq -r '.data[] | select(.type=="customer") | .id')"
check "customer title is name" "Acme ${SUFFIX} Corp" \
  "$(echo "$R" | jq -r '.data[] | select(.type=="customer") | .title')"

# ── 3. Product match by name / sku ────────────────────────────────────────────
echo ""
echo "Product match"
R=$(curl -s "$BASE_URL/search?q=${SUFFIX}&types=product")
check "product result has correct id" "$PROD_ID" \
  "$(echo "$R" | jq -r '.data[] | select(.type=="product") | .id')"
check "product title is name" "Thunderbolt ${SUFFIX} Hub" \
  "$(echo "$R" | jq -r '.data[] | select(.type=="product") | .title')"
check "product excerpt contains sku" "true" \
  "$(echo "$R" | jq --arg s "SKU-${SUFFIX}" '.data[] | select(.type=="product") | .excerpt | contains($s)')"

# ── 4. Quote match by quote_number ───────────────────────────────────────────
echo ""
echo "Quote match"
R=$(curl -s "$BASE_URL/search?q=Q-${SUFFIX}&types=quote")
check "quote result has correct id" "$QID" \
  "$(echo "$R" | jq -r '.data[] | select(.type=="quote") | .id')"
check "quote title is quote_number" "Q-${SUFFIX}" \
  "$(echo "$R" | jq -r '.data[] | select(.type=="quote") | .title')"

# ── 5. type filter — single type ─────────────────────────────────────────────
echo ""
echo "Type filter"
R=$(curl -s "$BASE_URL/search?q=${SUFFIX}&types=product")
ONLY_TYPES=$(echo "$R" | jq '[.data[].type] | unique | join(",")')
check "types=product returns only products" '"product"' "$ONLY_TYPES"

R=$(curl -s "$BASE_URL/search?q=${SUFFIX}&types=customer,quote")
MULTI_TYPES=$(echo "$R" | jq '[.data[].type] | unique | sort | join(",")')
check "types=customer,quote excludes products" '"customer,quote"' "$MULTI_TYPES"

# ── 6. Unknown type is ignored gracefully ────────────────────────────────────
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/search?q=${SUFFIX}&types=bogus")
check "unknown type → 200 empty results" "200" "$(http_code "$R")"
check "unknown type → total 0" "0" "$(http_body "$R" | jq '.pagination.total')"

# ── 7. Pagination ─────────────────────────────────────────────────────────────
echo ""
echo "Pagination"
R=$(curl -s "$BASE_URL/search?q=${SUFFIX}&take=1&skip=0")
check "take=1 returns 1 result" "1" "$(echo "$R" | jq '.data | length')"
check "total ≥ 3 even with take=1" "true" "$(echo "$R" | jq '.pagination.total >= 3')"
check "pagination.take=1" "1" "$(echo "$R" | jq '.pagination.take')"

R=$(curl -s "$BASE_URL/search?q=${SUFFIX}&take=100")
check "take capped at 50" "50" "$(echo "$R" | jq '.pagination.take')"

R=$(curl -s "$BASE_URL/search?q=${SUFFIX}&take=2&skip=2")
check "skip=2 offsets correctly" "2" "$(echo "$R" | jq '.pagination.skip')"

# ── 8. Validation ─────────────────────────────────────────────────────────────
echo ""
echo "Validation"
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/search")
check "missing q → 400" "400" "$(http_code "$R")"

# q longer than 200 chars → 400
LONG_Q=$(printf '%0.s_' {1..201})
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/search?q=${LONG_Q}")
check "q >200 chars → 400" "400" "$(http_code "$R")"

# Empty q string → 400
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/search?q=")
check "empty q → 400" "400" "$(http_code "$R")"

# ── 9. No match returns empty results ────────────────────────────────────────
echo ""
echo "No match"
R=$(curl -s "$BASE_URL/search?q=xyzzy_no_match_loopnest_$(date +%s)")
check "no-match total=0" "0" "$(echo "$R" | jq '.pagination.total')"
check "no-match data=[]" "0" "$(echo "$R" | jq '.data | length')"

# ── 10. Org isolation ─────────────────────────────────────────────────────────
echo ""
echo "Org isolation"
ORG_A=$(curl -s -X POST "$BASE_URL/organizations" \
  -H "Content-Type: application/json" \
  -d '{"name":"Search Org A","type":"company"}' | jq -r '.data.id')
ORG_B=$(curl -s -X POST "$BASE_URL/organizations" \
  -H "Content-Type: application/json" \
  -d '{"name":"Search Org B","type":"company"}' | jq -r '.data.id')
TOKEN_A=$(node "$(dirname "$0")/gen-token.mjs" search-a-admin admin 3600 "$ORG_A")
TOKEN_B=$(node "$(dirname "$0")/gen-token.mjs" search-b-admin admin 3600 "$ORG_B")

# Seed a customer under org A
ISO_SUFFIX="SISO$(date +%s)"
command curl -s -X POST "$BASE_URL/customers" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"OrgA ${ISO_SUFFIX} Customer\",\"phone\":\"0000000000\"}" > /dev/null

# Org A can find its own customer
R_A=$(command curl -s "$BASE_URL/search?q=${ISO_SUFFIX}" -H "Authorization: Bearer $TOKEN_A")
check "org A finds its customer" "1" "$(echo "$R_A" | jq '.pagination.total')"

# Org B cannot find org A's customer
R_B=$(command curl -s "$BASE_URL/search?q=${ISO_SUFFIX}" -H "Authorization: Bearer $TOKEN_B")
check "org B sees 0 results for org A data" "0" "$(echo "$R_B" | jq '.pagination.total')"

# ── 11. RBAC ─────────────────────────────────────────────────────────────────
echo ""
echo "RBAC"
VIEWER_TOK=$(node "$(dirname "$0")/gen-token.mjs" search-viewer viewer 3600)
R=$(command curl -s -w "\n%{http_code}" "$BASE_URL/search?q=${SUFFIX}" \
  -H "Authorization: Bearer $VIEWER_TOK")
check "viewer can search → 200" "200" "$(http_code "$R")"

R=$(command curl -s -w "\n%{http_code}" "$BASE_URL/search?q=${SUFFIX}")
check "unauthenticated → 401" "401" "$(http_code "$R")"

summary
