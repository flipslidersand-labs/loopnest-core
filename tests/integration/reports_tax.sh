#!/usr/bin/env bash
# M29 / Issue #107: Tax report — consumption tax summary CSV by period
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Tax Report Tests ==="
echo ""

# ── Setup: org + customer + invoice with tax ──────────────────────────────────
ORG=$(curl -s -X POST "$BASE_URL/organizations" \
  -H "Content-Type: application/json" \
  -d '{"name":"Tax Report Org","type":"company"}' | jq -r '.data.id')
TOKEN=$(node "$(dirname "$0")/gen-token.mjs" tax-admin admin 3600 "$ORG")

CUST=$(curl -s -X POST "$BASE_URL/customers" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Tax Test Customer","email":"taxtest@example.com","type":"business"}' | jq -r '.data.id')

PROD=$(curl -s -X POST "$BASE_URL/products" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Tax Product","unitPrice":10000,"unit":"item","taxRate":0.10}' | jq -r '.data.id')

# Create a quote and invoice to ensure data exists
QUOTE=$(curl -s -X POST "$BASE_URL/quotes" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"customerId\":\"$CUST\",\"currency\":\"JPY\"}" | jq -r '.data.id')

curl -s -X POST "$BASE_URL/quotes/$QUOTE/items" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"productId\":\"$PROD\",\"quantity\":2,\"unitPrice\":10000}" > /dev/null

curl -s -X PATCH "$BASE_URL/quotes/$QUOTE/submit" \
  -H "Authorization: Bearer $TOKEN" > /dev/null

curl -s -X PATCH "$BASE_URL/quotes/$QUOTE/approve" \
  -H "Authorization: Bearer $TOKEN" > /dev/null

curl -s -X POST "$BASE_URL/workflow/create-invoice-from-quote" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"quoteId\":\"$QUOTE\"}" > /dev/null

# ── 1. Missing from → 400 ─────────────────────────────────────────────────────
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/reports/tax?to=2026-12-31")
check "missing from → 400" "400" "$(http_code "$R")"

# ── 2. Missing to → 400 ──────────────────────────────────────────────────────
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/reports/tax?from=2026-01-01")
check "missing to → 400" "400" "$(http_code "$R")"

# ── 3. Invalid date format → 400 ─────────────────────────────────────────────
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/reports/tax?from=2026-01&to=2026-03-31")
check "invalid date format → 400" "400" "$(http_code "$R")"

# ── 4. from > to → 400 ───────────────────────────────────────────────────────
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/reports/tax?from=2026-12-01&to=2026-01-01")
check "from > to → 400" "400" "$(http_code "$R")"

# ── 5. Valid JSON response → 200 ──────────────────────────────────────────────
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/reports/tax?from=2026-01-01&to=2026-12-31")
check "GET /reports/tax → 200" "200" "$(http_code "$R")"
check "response has period" "true" "$(http_body "$R" | jq '.data.period | has("from")' 2>/dev/null)"
check "response has rows array" "true" "$(http_body "$R" | jq '.data.rows | type == "array"' 2>/dev/null)"
check "response has totals" "true" "$(http_body "$R" | jq '.data.totals | has("taxableAmount")' 2>/dev/null)"

# ── 6. CSV format — Content-Type header ──────────────────────────────────────
HDR=$(command curl -s -I \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/reports/tax?from=2026-01-01&to=2026-12-31&format=csv")
check "CSV Content-Type" "true" "$(echo "$HDR" | grep -i 'content-type' | grep -q 'text/csv' && echo true || echo false)"
check "CSV Content-Disposition" "true" "$(echo "$HDR" | grep -i 'content-disposition' | grep -q 'tax_report_' && echo true || echo false)"

# ── 7. CSV body has header row ────────────────────────────────────────────────
CSV=$(command curl -s \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/reports/tax?from=2026-01-01&to=2026-12-31&format=csv")
check "CSV header row" "month,taxRate,taxableAmount,taxAmount,invoiceCount" "$(echo "$CSV" | head -1)"

summary
