#!/usr/bin/env bash
# M09: Reporting/Analytics API — summary, revenue, quote pipeline, invoice aging.
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Reporting / Analytics Tests ==="
echo ""

DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Setup: create some data so the reports have something to aggregate ────────
CUST=$(make_customer "Reports Test Corp")
PROD=$(make_product "Reports Widget" 20000)

make_paid_invoice() {
  local qid inv_id
  qid=$(make_quote "$CUST")
  curl -s -X POST "$BASE_URL/quotes/$qid/items" \
    -H "Content-Type: application/json" \
    -d "{\"productId\":\"$PROD\",\"quantity\":2,\"unitPrice\":20000}" > /dev/null
  curl -s -X POST "$BASE_URL/workflow/quotes/$qid/submit"  -H "Content-Type: application/json" -d '{"userId":"rpt-user"}' > /dev/null
  curl -s -X POST "$BASE_URL/workflow/quotes/$qid/approve" -H "Content-Type: application/json" -d '{"userId":"rpt-approver","notes":"ok"}' > /dev/null
  inv_id=$(curl -s -X POST "$BASE_URL/workflow/quotes/$qid/invoice" \
    -H "Content-Type: application/json" -d '{"userId":"rpt-user"}' | jq -r '.data.invoice.invoiceId')
  curl -s -X POST "$BASE_URL/workflow/invoices/$inv_id/mark-paid" \
    -H "Content-Type: application/json" > /dev/null
  echo "$inv_id"
}

INV1=$(make_paid_invoice)
INV2=$(make_paid_invoice)
check "setup: 2 paid invoices" "true" \
  "$([ -n "$INV1" ] && [ "$INV1" != "null" ] && [ -n "$INV2" ] && [ "$INV2" != "null" ] && echo true || echo false)"

# Also leave one invoice in 'issued' state for aging tests
QID3=$(make_quote "$CUST")
curl -s -X POST "$BASE_URL/quotes/$QID3/items" \
  -H "Content-Type: application/json" \
  -d "{\"productId\":\"$PROD\",\"quantity\":1,\"unitPrice\":20000}" > /dev/null
curl -s -X POST "$BASE_URL/workflow/quotes/$QID3/submit"  -H "Content-Type: application/json" -d '{"userId":"rpt-user"}' > /dev/null
curl -s -X POST "$BASE_URL/workflow/quotes/$QID3/approve" -H "Content-Type: application/json" -d '{"userId":"rpt-approver","notes":"ok"}' > /dev/null
curl -s -X POST "$BASE_URL/workflow/quotes/$QID3/invoice" -H "Content-Type: application/json" -d '{"userId":"rpt-user"}' > /dev/null

# ── 1. GET /api/reports/summary ───────────────────────────────────────────────
echo ""
echo "Summary dashboard"
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/reports/summary")
check "GET /reports/summary → 200" "200" "$(http_code "$R")"
check "has totalCustomers"    "true" "$(http_body "$R" | jq 'has("data") and (.data | has("totalCustomers"))')"
check "has activeQuotes"      "true" "$(http_body "$R" | jq '.data | has("activeQuotes")')"
check "has outstandingAmount" "true" "$(http_body "$R" | jq '.data | has("outstandingAmount")')"
check "has paidThisMonth"     "true" "$(http_body "$R" | jq '.data | has("paidThisMonth")')"
check "totalCustomers ≥ 1"    "true" "$(http_body "$R" | jq '.data.totalCustomers >= 1')"
check "paidThisMonth > 0"     "true" "$(http_body "$R" | jq '.data.paidThisMonth > 0')"
check "outstandingAmount ≥ 0" "true" "$(http_body "$R" | jq '.data.outstandingAmount >= 0')"

# ── 2. GET /api/reports/revenue ───────────────────────────────────────────────
echo ""
echo "Revenue report"
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/reports/revenue")
check "GET /reports/revenue → 200" "200" "$(http_code "$R")"
check "has data array"  "true" "$(http_body "$R" | jq 'has("data")')"
check "has period field" "true" "$(http_body "$R" | jq 'has("period")')"
check "default period=month" "month" "$(http_body "$R" | jq -r '.period')"
check "revenue ≥ 1 row this month" "true" "$(http_body "$R" | jq '.data | length >= 1')"
REVENUE=$(http_body "$R" | jq '[.data[].revenue] | add // 0')
check "total revenue > 0" "true" "$(echo "$REVENUE" | jq '. > 0')"

# period=quarter
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/reports/revenue?period=quarter")
check "period=quarter → 200" "200" "$(http_code "$R")"
check "quarter period field" "quarter" "$(http_body "$R" | jq -r '.period')"

# period=year
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/reports/revenue?period=year")
check "period=year → 200" "200" "$(http_code "$R")"

# invalid period
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/reports/revenue?period=decade")
check "invalid period → 400" "400" "$(http_code "$R")"

# date range filter
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
PAST=$(date -u -d "24 hours ago" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -v-24H +"%Y-%m-%dT%H:%M:%SZ")
R=$(curl -s "$BASE_URL/reports/revenue?dateFrom=${PAST}&dateTo=${NOW}")
check "revenue dateFrom/dateTo filter → has data" "true" \
  "$(echo "$R" | jq '.data | length >= 1')"

# ── 3. GET /api/reports/quotes ────────────────────────────────────────────────
echo ""
echo "Quote pipeline"
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/reports/quotes")
check "GET /reports/quotes → 200" "200" "$(http_code "$R")"
check "has byStatus"       "true" "$(http_body "$R" | jq '.data | has("byStatus")')"
check "has total"          "true" "$(http_body "$R" | jq '.data | has("total")')"
check "has conversionRate" "true" "$(http_body "$R" | jq '.data | has("conversionRate")')"
check "total > 0"          "true" "$(http_body "$R" | jq '.data.total > 0')"
check "invoiced count ≥ 2" "true" "$(http_body "$R" | jq '(.data.byStatus.invoiced // 0) >= 2')"
check "conversionRate 0-100" "true" \
  "$(http_body "$R" | jq '.data.conversionRate >= 0 and .data.conversionRate <= 100')"

# ── 4. GET /api/reports/invoices ──────────────────────────────────────────────
echo ""
echo "Invoice aging"
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/reports/invoices")
check "GET /reports/invoices → 200" "200" "$(http_code "$R")"
check "has byStatus"      "true" "$(http_body "$R" | jq '.data | has("byStatus")')"
check "has overdueCount"  "true" "$(http_body "$R" | jq '.data | has("overdueCount")')"
check "has overdueAmount" "true" "$(http_body "$R" | jq '.data | has("overdueAmount")')"
check "paid count ≥ 2"    "true" \
  "$(http_body "$R" | jq '(.data.byStatus.paid.count // 0) >= 2')"
check "paid totalAmount > 0" "true" \
  "$(http_body "$R" | jq '(.data.byStatus.paid.totalAmount // 0) > 0')"
check "issued count ≥ 1"  "true" \
  "$(http_body "$R" | jq '(.data.byStatus.issued.count // 0) >= 1')"

# ── 5. RBAC: viewer can access reports ───────────────────────────────────────
echo ""
echo "RBAC"
VIEWER_TOKEN=$(node "$DIR/gen-token.mjs" rpt-viewer viewer)
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  "$BASE_URL/reports/summary")
check "viewer GET /reports/summary → 200" "200" "$(http_code "$R")"

R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  "$BASE_URL/reports/revenue")
check "viewer GET /reports/revenue → 200" "200" "$(http_code "$R")"

# ── 6. Org-scoped reports ─────────────────────────────────────────────────────
echo ""
echo "Org-scoped reports"
ORG_X=$(curl -s -X POST "$BASE_URL/organizations" \
  -H "Content-Type: application/json" \
  -d '{"name":"Reports Org X","type":"company"}' | jq -r '.data.id')
TOKEN_X=$(node "$DIR/gen-token.mjs" org-x-user admin 3600 "$ORG_X")

# Admin (no orgId) sees all data
ADMIN_TOTAL=$(curl -s "$BASE_URL/reports/quotes" | jq '.data.total')
# Org-X (new, no data) sees 0
ORG_X_TOTAL=$(command curl -s -H "Authorization: Bearer $TOKEN_X" \
  "$BASE_URL/reports/quotes" | jq '.data.total')
check "org-X sees 0 quotes (isolated)" "0" "$ORG_X_TOTAL"
check "admin sees all quotes (unscoped)" "true" "$([ "${ADMIN_TOTAL:-0}" -gt 0 ] && echo true || echo false)"

summary
