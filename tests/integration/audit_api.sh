#!/usr/bin/env bash
# M08: Audit trail query API — logs list/filter, resource history, request logs.
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Audit Trail API Tests ==="
echo ""

DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Setup: drive some auditable workflow events ───────────────────────────────
CUST=$(make_customer "Audit Test Corp")
PROD=$(make_product "Audit Widget" 10000)
QID=$(make_quote "$CUST")
curl -s -X POST "$BASE_URL/quotes/$QID/items" \
  -H "Content-Type: application/json" \
  -d "{\"productId\":\"$PROD\",\"quantity\":1,\"unitPrice\":10000}" > /dev/null
curl -s -X POST "$BASE_URL/workflow/quotes/$QID/submit" \
  -H "Content-Type: application/json" \
  -d '{"userId":"audit-test-user"}' > /dev/null
curl -s -X POST "$BASE_URL/workflow/quotes/$QID/approve" \
  -H "Content-Type: application/json" \
  -d '{"userId":"audit-test-approver","notes":"lgtm"}' > /dev/null
INV_ID=$(curl -s -X POST "$BASE_URL/workflow/quotes/$QID/invoice" \
  -H "Content-Type: application/json" \
  -d '{"userId":"audit-test-user"}' | jq -r '.data.invoice.invoiceId')

check "setup: invoice created" "true" "$([ -n "$INV_ID" ] && [ "$INV_ID" != "null" ] && echo true || echo false)"

# ── 1. GET /api/audit/logs — basic listing ────────────────────────────────────
echo ""
echo "Audit log listing"
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/audit/logs")
check "GET /audit/logs → 200" "200" "$(http_code "$R")"
check "response has data array" "true" "$(http_body "$R" | jq 'has("data")')"
check "response has pagination" "true" "$(http_body "$R" | jq 'has("pagination")')"
TOTAL=$(http_body "$R" | jq '.pagination.total')
check "at least 3 audit entries exist" "true" "$([ "${TOTAL:-0}" -ge 3 ] && echo true || echo false)"

# ── 2. Filter by resourceType=quote ───────────────────────────────────────────
echo ""
echo "Filter by resourceType"
R=$(curl -s "$BASE_URL/audit/logs?resourceType=quote")
check "filter resourceType=quote returns entries" "true" \
  "$(echo "$R" | jq '.pagination.total > 0')"
check "all returned entries are type=quote" "true" \
  "$(echo "$R" | jq '[.data[].resourceType] | map(. == "quote") | all')"

# ── 3. Filter by action ───────────────────────────────────────────────────────
R=$(curl -s "$BASE_URL/audit/logs?action=QUOTE_SUBMITTED")
check "filter action=QUOTE_SUBMITTED returns ≥1" "true" \
  "$(echo "$R" | jq '.pagination.total > 0')"
check "all returned actions are QUOTE_SUBMITTED" "true" \
  "$(echo "$R" | jq '[.data[].action] | map(. == "QUOTE_SUBMITTED") | all')"

# ── 4. Filter by actorId ─────────────────────────────────────────────────────
R=$(curl -s "$BASE_URL/audit/logs?actorId=audit-test-user")
check "filter actorId=audit-test-user returns ≥1" "true" \
  "$(echo "$R" | jq '.pagination.total > 0')"

# ── 5. Filter by resourceId (the specific quote) ─────────────────────────────
echo ""
echo "Filter by resourceId"
R=$(curl -s "$BASE_URL/audit/logs?resourceId=$QID")
check "filter by quoteId returns ≥2 events" "true" \
  "$(echo "$R" | jq '.pagination.total >= 2')"

# ── 6. Date range filter ──────────────────────────────────────────────────────
echo ""
echo "Date range filter"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
PAST=$(date -u -d "1 hour ago" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -v-1H +"%Y-%m-%dT%H:%M:%SZ")
# ISO8601 with Z suffix needs no URL-encoding; pass directly.
R=$(curl -s "$BASE_URL/audit/logs?dateFrom=${PAST}&dateTo=${NOW}")
check "dateFrom/dateTo filter returns results" "true" \
  "$(echo "$R" | jq '.pagination.total > 0')"

# ── 7. Pagination ─────────────────────────────────────────────────────────────
echo ""
echo "Pagination"
R=$(curl -s "$BASE_URL/audit/logs?take=2&skip=0")
check "take=2 returns at most 2 records" "true" \
  "$(echo "$R" | jq '.data | length <= 2')"

# ── 8. GET /api/audit/logs/:resourceType/:resourceId — resource history ───────
echo ""
echo "Resource history"
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/audit/logs/quote/$QID")
check "GET /audit/logs/quote/:id → 200" "200" "$(http_code "$R")"
check "history has count field" "true" "$(http_body "$R" | jq 'has("count")')"
CNT=$(http_body "$R" | jq '.count')
check "quote history has ≥2 events" "true" "$([ "${CNT:-0}" -ge 2 ] && echo true || echo false)"
check "history is ascending (submit before approve)" "true" \
  "$(http_body "$R" | jq '[.data[] | select(.action == "QUOTE_SUBMITTED" or .action == "QUOTE_APPROVED")] | (.[0].action == "QUOTE_SUBMITTED" and .[1].action == "QUOTE_APPROVED")')"

# ── 9. Invoice resource history ───────────────────────────────────────────────
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/audit/logs/invoice/$INV_ID")
check "GET /audit/logs/invoice/:id → 200" "200" "$(http_code "$R")"
check "invoice history has INVOICE_CREATED" "true" \
  "$(http_body "$R" | jq '[.data[].action] | contains(["INVOICE_CREATED"])')"

# ── 10. GET /api/audit/requests ───────────────────────────────────────────────
echo ""
echo "Request logs"
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/audit/requests")
check "GET /audit/requests → 200" "200" "$(http_code "$R")"
check "request logs has data array" "true" "$(http_body "$R" | jq 'has("data")')"
REQ_TOTAL=$(http_body "$R" | jq '.pagination.total')
check "at least 1 request log entry" "true" "$([ "${REQ_TOTAL:-0}" -ge 1 ] && echo true || echo false)"

# ── 11. Request log filter by status_code ────────────────────────────────────
R=$(curl -s "$BASE_URL/audit/requests?statusCode=200")
check "filter statusCode=200 returns results" "true" \
  "$(echo "$R" | jq '.pagination.total > 0')"
check "all status codes are 200" "true" \
  "$(echo "$R" | jq '[.data[].statusCode] | map(. == 200) | all')"

# ── 12. Request log filter by method ─────────────────────────────────────────
R=$(curl -s "$BASE_URL/audit/requests?method=POST")
check "filter method=POST returns results" "true" \
  "$(echo "$R" | jq '.pagination.total > 0')"

# ── 13. Request log filter by path prefix ────────────────────────────────────
R=$(curl -s "$BASE_URL/audit/requests?path=/api/workflow")
check "filter path=/api/workflow returns results" "true" \
  "$(echo "$R" | jq '.pagination.total > 0')"

# ── 14. RBAC: non-admin cannot access audit logs ─────────────────────────────
echo ""
echo "RBAC"
EDITOR_TOKEN=$(node "$DIR/gen-token.mjs" audit-editor editor)
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $EDITOR_TOKEN" \
  "$BASE_URL/audit/logs")
check "editor GET /audit/logs → 403" "403" "$(http_code "$R")"

VIEWER_TOKEN=$(node "$DIR/gen-token.mjs" audit-viewer viewer)
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  "$BASE_URL/audit/requests")
check "viewer GET /audit/requests → 403" "403" "$(http_code "$R")"

# ── 15. take cap: max 100 ─────────────────────────────────────────────────────
echo ""
echo "take cap"
R=$(curl -s "$BASE_URL/audit/logs?take=999")
check "take=999 is capped at 100" "true" \
  "$(echo "$R" | jq '.data | length <= 100')"

summary
