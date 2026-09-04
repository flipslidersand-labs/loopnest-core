#!/usr/bin/env bash
# M05: PDF quote generation integration test
set -euo pipefail
source "$(dirname "$0")/_common.sh" 2>/dev/null || true

BASE_URL="${BASE_URL:-http://localhost:3000}"
PASS=0; FAIL=0

pass() { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo "=== PDF Quote (M05) ==="

QUOTE_ID=$(curl -sf "${BASE_URL}/api/quotes?take=1" | jq -r '.data[0].id // empty')

if [ -z "$QUOTE_ID" ]; then
  echo "  SKIP: no quotes found (run the full workflow suite first)"
  exit 0
fi

HTTP_CODE=$(curl -sf -o /tmp/test_quote.pdf -w "%{http_code}" \
  "${BASE_URL}/api/quotes/${QUOTE_ID}/pdf")

if [ "$HTTP_CODE" = "200" ]; then
  pass "GET /api/quotes/:id/pdf → 200"
else
  fail "GET /api/quotes/:id/pdf → expected 200, got $HTTP_CODE"
fi

MAGIC=$(head -c 4 /tmp/test_quote.pdf 2>/dev/null)
if [ "$MAGIC" = "%PDF" ]; then
  pass "Response body starts with %PDF magic bytes"
else
  fail "Response body does not look like a PDF"
fi

FAKE_ID="00000000-0000-0000-0000-000000000000"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/quotes/${FAKE_ID}/pdf")
if [ "$STATUS" = "404" ]; then
  pass "GET /api/quotes/<unknown>/pdf → 404"
else
  fail "GET /api/quotes/<unknown>/pdf → expected 404, got $STATUS"
fi

CD=$(curl -sI "${BASE_URL}/api/quotes/${QUOTE_ID}/pdf" | grep -i 'content-disposition' | tr -d '\r' || true)
if echo "$CD" | grep -qi 'attachment'; then
  pass "Content-Disposition: attachment present"
else
  fail "Content-Disposition header missing or wrong: '$CD'"
fi

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
