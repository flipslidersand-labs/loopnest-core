#!/usr/bin/env bash
# M04: PDF invoice generation integration test
set -euo pipefail
source "$(dirname "$0")/_common.sh" 2>/dev/null || true

BASE_URL="${BASE_URL:-http://localhost:3000}"
PASS=0; FAIL=0

pass() { echo "  ✓ $1"; ((PASS++)); }
fail() { echo "  ✗ $1"; ((FAIL++)); }

echo "=== PDF Invoice (M04) ==="

# ── Prerequisite: get an existing invoice ────────────────────────────────────
INVOICES=$(curl -sf "${BASE_URL}/api/invoices?take=1" | jq -r '.data[0].id // empty')

if [ -z "$INVOICES" ]; then
  echo "  SKIP: no invoices found (run the full workflow suite first)"
  exit 0
fi
INVOICE_ID="$INVOICES"

# ── Test 1: PDF download returns 200 with correct content-type ────────────────
HTTP_CODE=$(curl -sf -o /tmp/test_invoice.pdf -w "%{http_code}" \
  "${BASE_URL}/api/invoices/${INVOICE_ID}/pdf")

if [ "$HTTP_CODE" = "200" ]; then
  pass "GET /api/invoices/:id/pdf → 200"
else
  fail "GET /api/invoices/:id/pdf → expected 200, got $HTTP_CODE"
fi

# ── Test 2: Response is a valid PDF (magic bytes %PDF) ────────────────────────
MAGIC=$(xxd /tmp/test_invoice.pdf 2>/dev/null | head -1 | grep -o '25 50 44 46' || true)
if [ "$MAGIC" = "25 50 44 46" ]; then
  pass "Response body starts with %PDF magic bytes"
else
  fail "Response body does not look like a PDF"
fi

# ── Test 3: Non-existent invoice returns 404 ─────────────────────────────────
FAKE_ID="00000000-0000-0000-0000-000000000000"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/invoices/${FAKE_ID}/pdf")
if [ "$STATUS" = "404" ]; then
  pass "GET /api/invoices/<unknown>/pdf → 404"
else
  fail "GET /api/invoices/<unknown>/pdf → expected 404, got $STATUS"
fi

# ── Test 4: Content-Disposition header is set ─────────────────────────────────
CD=$(curl -sI "${BASE_URL}/api/invoices/${INVOICE_ID}/pdf" | grep -i 'content-disposition' | tr -d '\r' || true)
if echo "$CD" | grep -qi 'attachment'; then
  pass "Content-Disposition: attachment present"
else
  fail "Content-Disposition header missing or wrong: '$CD'"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
