#!/usr/bin/env bash
# M13: Payments & Accounts Receivable — record/partial/reverse payments,
# invoice status transitions, RBAC, idempotency, org isolation, AR aging.
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Payments & Accounts Receivable Tests ==="
echo ""

DIR="$(cd "$(dirname "$0")" && pwd)"

# Each make_invoice yields a fresh 'issued' invoice with total 165000.
INV_TOTAL=165000

invoice_status() { curl -s "$BASE_URL/invoices/$1" | jq -r '.data.status'; }

# ── 1. Full payment → invoice 'paid' ─────────────────────────────────────────
echo "Full payment"
read -r _ INV1 <<<"$(make_invoice)"
check "setup invoice issued" "issued" "$(invoice_status "$INV1")"

R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/invoices/$INV1/payments" \
  -H "Content-Type: application/json" \
  -d "{\"amount\":$INV_TOTAL,\"method\":\"bank_transfer\"}")
check "POST full payment → 201" "201" "$(http_code "$R")"
check "balance status = paid" "paid" "$(http_body "$R" | jq -r '.balance.status')"
check "outstanding = 0" "0" "$(http_body "$R" | jq -r '.balance.outstanding')"
check "invoice now paid" "paid" "$(invoice_status "$INV1")"
check "paid_at stamped" "f" \
  "$(db_scalar "SELECT paid_at IS NULL FROM finance.invoices WHERE id='$INV1'")"

# ── 2. Partial payments accumulate → 'paid' ──────────────────────────────────
echo ""
echo "Partial payments"
read -r _ INV2 <<<"$(make_invoice)"
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/invoices/$INV2/payments" \
  -H "Content-Type: application/json" -d '{"amount":100000,"method":"bank_transfer"}')
check "partial 1 → 201" "201" "$(http_code "$R")"
check "status partially_paid" "partially_paid" "$(http_body "$R" | jq -r '.balance.status')"
check "outstanding 65000" "65000" "$(http_body "$R" | jq -r '.balance.outstanding')"
check "invoice partially_paid" "partially_paid" "$(invoice_status "$INV2")"

R=$(curl -s "$BASE_URL/invoices/$INV2/payments")
check "history has 1 payment" "1" "$(echo "$R" | jq '.data | length')"
check "history paidTotal 100000" "100000" "$(echo "$R" | jq -r '.balance.paidTotal')"

R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/invoices/$INV2/payments" \
  -H "Content-Type: application/json" -d '{"amount":65000,"method":"cash"}')
check "partial 2 → 201" "201" "$(http_code "$R")"
check "status paid after settle" "paid" "$(http_body "$R" | jq -r '.balance.status')"
check "history now 2 payments" "2" "$(curl -s "$BASE_URL/invoices/$INV2/payments" | jq '.data | length')"

# ── 3. Overpayment rejected ──────────────────────────────────────────────────
echo ""
echo "Overpayment"
read -r _ INV3 <<<"$(make_invoice)"
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/invoices/$INV3/payments" \
  -H "Content-Type: application/json" -d '{"amount":200000,"method":"bank_transfer"}')
check "overpay (full) → 409" "409" "$(http_code "$R")"
check "error code OVERPAYMENT" "OVERPAYMENT" "$(http_body "$R" | jq -r '.error.code // .code')"

curl -s -X POST "$BASE_URL/invoices/$INV3/payments" \
  -H "Content-Type: application/json" -d '{"amount":100000,"method":"cash"}' > /dev/null
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/invoices/$INV3/payments" \
  -H "Content-Type: application/json" -d '{"amount":100000,"method":"cash"}')
check "overpay remaining → 409" "409" "$(http_code "$R")"

# ── 4. Validation ────────────────────────────────────────────────────────────
echo ""
echo "Validation"
read -r _ INV4 <<<"$(make_invoice)"
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/invoices/$INV4/payments" \
  -H "Content-Type: application/json" -d '{"amount":0,"method":"cash"}')
check "amount 0 → 400" "400" "$(http_code "$R")"
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/invoices/$INV4/payments" \
  -H "Content-Type: application/json" -d '{"amount":1000}')
check "missing method → 400" "400" "$(http_code "$R")"
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/invoices/$INV4/payments" \
  -H "Content-Type: application/json" -d '{"amount":1000,"method":"bitcoin"}')
check "invalid method → 400" "400" "$(http_code "$R")"
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/invoices/00000000-0000-0000-0000-000000000000/payments" \
  -H "Content-Type: application/json" -d '{"amount":1000,"method":"cash"}')
check "nonexistent invoice → 404" "404" "$(http_code "$R")"

# ── 5. Reversal ──────────────────────────────────────────────────────────────
echo ""
echo "Reversal"
read -r _ INV5 <<<"$(make_invoice)"
PID=$(curl -s -X POST "$BASE_URL/invoices/$INV5/payments" \
  -H "Content-Type: application/json" -d "{\"amount\":$INV_TOTAL,\"method\":\"bank_transfer\"}" \
  | jq -r '.data.id')
check "invoice paid before reverse" "paid" "$(invoice_status "$INV5")"
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/payments/$PID/reverse" \
  -H "Content-Type: application/json" -d '{"reason":"wrong account"}')
check "reverse → 200" "200" "$(http_code "$R")"
check "outstanding restored" "$INV_TOTAL" "$(http_body "$R" | jq -r '.balance.outstanding')"
check "invoice no longer paid" "sent" "$(invoice_status "$INV5")"
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/payments/$PID/reverse" \
  -H "Content-Type: application/json" -d '{"reason":"again"}')
check "double reverse → 409" "409" "$(http_code "$R")"
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/payments/$PID/reverse" \
  -H "Content-Type: application/json" -d '{}')
check "reverse without reason → 400" "400" "$(http_code "$R")"

# ── 6. RBAC ──────────────────────────────────────────────────────────────────
echo ""
echo "RBAC"
read -r _ INV6 <<<"$(make_invoice)"
VIEWER=$(node "$DIR/gen-token.mjs" pay-viewer viewer)
EDITOR=$(node "$DIR/gen-token.mjs" pay-editor editor)

R=$(command curl -s -w "\n%{http_code}" -H "Authorization: Bearer $VIEWER" \
  -X POST "$BASE_URL/invoices/$INV6/payments" \
  -H "Content-Type: application/json" -d '{"amount":1000,"method":"cash"}')
check "viewer record → 403" "403" "$(http_code "$R")"

R=$(command curl -s -w "\n%{http_code}" -H "Authorization: Bearer $EDITOR" \
  -X POST "$BASE_URL/invoices/$INV6/payments" \
  -H "Content-Type: application/json" -d '{"amount":1000,"method":"cash"}')
check "editor record → 201" "201" "$(http_code "$R")"
EDITOR_PID=$(http_body "$R" | jq -r '.data.id')

R=$(command curl -s -w "\n%{http_code}" -H "Authorization: Bearer $VIEWER" \
  "$BASE_URL/invoices/$INV6/payments")
check "viewer read history → 200" "200" "$(http_code "$R")"

R=$(command curl -s -w "\n%{http_code}" -H "Authorization: Bearer $EDITOR" \
  -X POST "$BASE_URL/payments/$EDITOR_PID/reverse" \
  -H "Content-Type: application/json" -d '{"reason":"x"}')
check "editor reverse → 403 (admin only)" "403" "$(http_code "$R")"

# ── 7. Idempotency ───────────────────────────────────────────────────────────
echo ""
echo "Idempotency"
read -r _ INV7 <<<"$(make_invoice)"
KEY="pay-idem-$(date +%s)-$RANDOM"
curl -s -X POST "$BASE_URL/invoices/$INV7/payments" \
  -H "Content-Type: application/json" -H "Idempotency-Key: $KEY" \
  -d '{"amount":50000,"method":"cash"}' > /dev/null
curl -s -X POST "$BASE_URL/invoices/$INV7/payments" \
  -H "Content-Type: application/json" -H "Idempotency-Key: $KEY" \
  -d '{"amount":50000,"method":"cash"}' > /dev/null
check "idempotent replay → single payment" "1" \
  "$(curl -s "$BASE_URL/invoices/$INV7/payments" | jq '.data | length')"
check "idempotent outstanding 115000" "115000" \
  "$(curl -s "$BASE_URL/invoices/$INV7/payments" | jq -r '.balance.outstanding')"

# ── 8. Payment list + org isolation ──────────────────────────────────────────
echo ""
echo "List + org isolation"
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/payments")
check "GET /payments → 200" "200" "$(http_code "$R")"
check "admin sees payments" "true" "$(http_body "$R" | jq '(.data | length) > 0')"

ORG_Z=$(curl -s -X POST "$BASE_URL/organizations" \
  -H "Content-Type: application/json" -d '{"name":"Payments Org Z","type":"company"}' | jq -r '.data.id')
TOKEN_Z=$(node "$DIR/gen-token.mjs" pay-org-z admin 3600 "$ORG_Z")
ZCOUNT=$(command curl -s -H "Authorization: Bearer $TOKEN_Z" "$BASE_URL/payments" | jq '.data | length')
check "org-Z sees 0 payments (isolated)" "0" "$ZCOUNT"

# ── 9. AR aging report ───────────────────────────────────────────────────────
echo ""
echo "Accounts-receivable aging"
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/reports/accounts-receivable")
check "GET /reports/accounts-receivable → 200" "200" "$(http_code "$R")"
check "has buckets.current"   "true" "$(http_body "$R" | jq '.data.buckets | has("current")')"
check "has buckets.90+"       "true" "$(http_body "$R" | jq '.data.buckets | has("90+")')"
check "has totalOutstanding"  "true" "$(http_body "$R" | jq '.data | has("totalOutstanding")')"
check "has byCustomer array"  "true" "$(http_body "$R" | jq '.data.byCustomer | type == "array"')"

# Push one open invoice 100 days past due → must land in 90+ bucket.
read -r _ INV_AGED <<<"$(make_invoice)"
db_scalar "UPDATE finance.invoices SET payment_due_date = CURRENT_DATE - 100 WHERE id='$INV_AGED'" > /dev/null
R=$(curl -s "$BASE_URL/reports/accounts-receivable")
check "90+ bucket > 0 after aging" "true" "$(echo "$R" | jq '.data.buckets["90+"] > 0')"
check "totalOutstanding > 0" "true" "$(echo "$R" | jq '.data.totalOutstanding > 0')"

# asOf validation
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/reports/accounts-receivable?asOf=not-a-date")
check "invalid asOf → 400" "400" "$(http_code "$R")"

summary
