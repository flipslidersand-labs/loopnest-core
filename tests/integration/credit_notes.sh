#!/usr/bin/env bash
# M14: Credit Notes & Refunds — issue/apply/refund/void, RBAC, idempotency,
# org isolation, invoice status transitions with combined payment+credit ledger.
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Credit Notes & Refunds Tests ==="
echo ""

DIR="$(cd "$(dirname "$0")" && pwd)"

INV_TOTAL=165000

invoice_status() { curl -s "$BASE_URL/invoices/$1" | jq -r '.data.status'; }

# ── 1. Issue credit note against an invoice ───────────────────────────────────
echo "Issue credit note"
read -r _ INV1 <<<"$(make_invoice)"
check "setup invoice1 issued" "issued" "$(invoice_status "$INV1")"

R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/invoices/$INV1/credit-notes" \
  -H "Content-Type: application/json" \
  -d '{"amount":20000,"reason":"Pricing error on line 2","cnType":"pricing_error"}')
check "POST credit note → 201" "201" "$(http_code "$R")"
CN1=$(http_body "$R" | jq -r '.data.id')
CN1_NUM=$(http_body "$R" | jq -r '.data.creditNumber')
check "credit number starts with CN-" "1" "$(echo "$CN1_NUM" | grep -c '^CN-')"
check "status = issued" "issued" "$(http_body "$R" | jq -r '.data.status')"
check "amount = 20000" "20000" "$(http_body "$R" | jq -r '.data.amount')"
check "cnType = pricing_error" "pricing_error" "$(http_body "$R" | jq -r '.data.cnType')"
# Invoice status unchanged (credit not yet applied)
check "invoice still issued" "issued" "$(invoice_status "$INV1")"

# GET /credit-notes/:id
R=$(curl -s "$BASE_URL/credit-notes/$CN1")
check "GET CN → 200 has balance" "true" "$(echo "$R" | jq '.balance | has("remaining")')"
check "remaining = 20000" "20000" "$(echo "$R" | jq -r '.balance.remaining')"
check "applications = []" "0" "$(echo "$R" | jq '.applications | length')"

# ── 2. Apply credit note (partial) → invoice partially_paid ──────────────────
echo ""
echo "Apply credit note (partial)"
read -r _ INV2 <<<"$(make_invoice)"
# Issue CN2 against INV2
CN2=$(curl -s -X POST "$BASE_URL/invoices/$INV2/credit-notes" \
  -H "Content-Type: application/json" \
  -d '{"amount":60000,"reason":"Goods returned"}' | jq -r '.data.id')

R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/credit-notes/$CN2/apply" \
  -H "Content-Type: application/json" \
  -d "{\"targetInvoiceId\":\"$INV2\",\"amount\":60000}")
check "apply CN → 201" "201" "$(http_code "$R")"
check "remaining after apply = 0" "0" "$(http_body "$R" | jq -r '.balance.remaining')"
check "CN status fully_applied" "fully_applied" "$(http_body "$R" | jq -r '.balance.status')"
check "invoice now partially_paid" "partially_paid" "$(invoice_status "$INV2")"

# ── 3. Apply credit → invoice fully paid (CN + payment = total) ──────────────
echo ""
echo "Credit + payment → fully paid"
read -r _ INV3 <<<"$(make_invoice)"
CN3=$(curl -s -X POST "$BASE_URL/invoices/$INV3/credit-notes" \
  -H "Content-Type: application/json" \
  -d '{"amount":65000,"reason":"Goodwill credit","cnType":"goodwill"}' | jq -r '.data.id')
# Pay 100000
curl -s -X POST "$BASE_URL/invoices/$INV3/payments" \
  -H "Content-Type: application/json" \
  -d '{"amount":100000,"method":"bank_transfer"}' > /dev/null
check "invoice partially_paid after payment" "partially_paid" "$(invoice_status "$INV3")"
# Apply 65000 credit → total = 165000
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/credit-notes/$CN3/apply" \
  -H "Content-Type: application/json" \
  -d "{\"targetInvoiceId\":\"$INV3\",\"amount\":65000}")
check "apply CN to settle → 201" "201" "$(http_code "$R")"
check "invoice now paid" "paid" "$(invoice_status "$INV3")"

# ── 4. Apply exceeds remaining → 409 ─────────────────────────────────────────
echo ""
echo "Exceed remaining balance"
read -r _ INV4 <<<"$(make_invoice)"
CN4=$(curl -s -X POST "$BASE_URL/invoices/$INV4/credit-notes" \
  -H "Content-Type: application/json" \
  -d '{"amount":30000,"reason":"Test"}' | jq -r '.data.id')
curl -s -X POST "$BASE_URL/credit-notes/$CN4/apply" \
  -H "Content-Type: application/json" \
  -d "{\"targetInvoiceId\":\"$INV4\",\"amount\":30000}" > /dev/null
# Now fully_applied — try to apply again
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/credit-notes/$CN4/apply" \
  -H "Content-Type: application/json" \
  -d "{\"targetInvoiceId\":\"$INV4\",\"amount\":1}")
check "apply to exhausted CN → 409" "409" "$(http_code "$R")"
check "error code INVALID_STATUS" "INVALID_STATUS" "$(http_body "$R" | jq -r '.error.code // .code')"

# ── 5. Validation ─────────────────────────────────────────────────────────────
echo ""
echo "Validation"
read -r _ INV5 <<<"$(make_invoice)"
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/invoices/$INV5/credit-notes" \
  -H "Content-Type: application/json" -d '{"amount":0,"reason":"x"}')
check "amount=0 → 400" "400" "$(http_code "$R")"
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/invoices/$INV5/credit-notes" \
  -H "Content-Type: application/json" -d '{"amount":1000}')
check "missing reason → 400" "400" "$(http_code "$R")"
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/invoices/$INV5/credit-notes" \
  -H "Content-Type: application/json" -d '{"amount":1000,"reason":"x","cnType":"invalid"}')
check "invalid cnType → 400" "400" "$(http_code "$R")"
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/invoices/$INV5/credit-notes" \
  -H "Content-Type: application/json" -d '{"amount":999999,"reason":"x"}')
check "amount > invoice total → 409" "409" "$(http_code "$R")"
R=$(curl -s -w "\n%{http_code}" -X POST \
  "$BASE_URL/invoices/00000000-0000-0000-0000-000000000000/credit-notes" \
  -H "Content-Type: application/json" -d '{"amount":1000,"reason":"x"}')
check "nonexistent invoice → 404" "404" "$(http_code "$R")"

# apply validation
CN5=$(curl -s -X POST "$BASE_URL/invoices/$INV5/credit-notes" \
  -H "Content-Type: application/json" \
  -d '{"amount":10000,"reason":"Valid CN"}' | jq -r '.data.id')
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/credit-notes/$CN5/apply" \
  -H "Content-Type: application/json" -d '{"amount":1000}')
check "apply missing targetInvoiceId → 400" "400" "$(http_code "$R")"
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/credit-notes/$CN5/apply" \
  -H "Content-Type: application/json" \
  -d "{\"targetInvoiceId\":\"$INV5\",\"amount\":20000}")
check "apply exceeds invoice outstanding → 409" "409" "$(http_code "$R")"

# ── 6. Refund ─────────────────────────────────────────────────────────────────
echo ""
echo "Refund"
read -r _ INV6 <<<"$(make_invoice)"
CN6=$(curl -s -X POST "$BASE_URL/invoices/$INV6/credit-notes" \
  -H "Content-Type: application/json" \
  -d '{"amount":50000,"reason":"Return refund","cnType":"return"}' | jq -r '.data.id')
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/credit-notes/$CN6/refund" \
  -H "Content-Type: application/json")
check "refund → 200" "200" "$(http_code "$R")"
check "refundedAmount = 50000" "50000" "$(http_body "$R" | jq -r '.refundedAmount')"
check "CN status = refunded" "refunded" "$(http_body "$R" | jq -r '.data.status')"
# Double-refund
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/credit-notes/$CN6/refund" \
  -H "Content-Type: application/json")
check "double refund → 409" "409" "$(http_code "$R")"

# ── 7. Void ───────────────────────────────────────────────────────────────────
echo ""
echo "Void"
read -r _ INV7 <<<"$(make_invoice)"
CN7=$(curl -s -X POST "$BASE_URL/invoices/$INV7/credit-notes" \
  -H "Content-Type: application/json" \
  -d '{"amount":15000,"reason":"Void test"}' | jq -r '.data.id')
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/credit-notes/$CN7/void" \
  -H "Content-Type: application/json")
check "void issued CN → 200" "200" "$(http_code "$R")"
check "CN status = void" "void" "$(http_body "$R" | jq -r '.data.status')"
# Void already voided → 409
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/credit-notes/$CN7/void" \
  -H "Content-Type: application/json")
check "double void → 409" "409" "$(http_code "$R")"
# Cannot apply voided CN
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/credit-notes/$CN7/apply" \
  -H "Content-Type: application/json" \
  -d "{\"targetInvoiceId\":\"$INV7\",\"amount\":1000}")
check "apply voided CN → 409" "409" "$(http_code "$R")"
# Cannot void partially-applied CN
read -r _ INV7B <<<"$(make_invoice)"
CN7B=$(curl -s -X POST "$BASE_URL/invoices/$INV7B/credit-notes" \
  -H "Content-Type: application/json" \
  -d '{"amount":50000,"reason":"Partial void test"}' | jq -r '.data.id')
curl -s -X POST "$BASE_URL/credit-notes/$CN7B/apply" \
  -H "Content-Type: application/json" \
  -d "{\"targetInvoiceId\":\"$INV7B\",\"amount\":10000}" > /dev/null
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/credit-notes/$CN7B/void" \
  -H "Content-Type: application/json")
check "void partially-applied CN → 409" "409" "$(http_code "$R")"

# ── 8. RBAC ───────────────────────────────────────────────────────────────────
echo ""
echo "RBAC"
read -r _ INV8 <<<"$(make_invoice)"
VIEWER=$(node "$DIR/gen-token.mjs" cn-viewer viewer)
EDITOR=$(node "$DIR/gen-token.mjs" cn-editor editor)

R=$(command curl -s -w "\n%{http_code}" -H "Authorization: Bearer $VIEWER" \
  -X POST "$BASE_URL/invoices/$INV8/credit-notes" \
  -H "Content-Type: application/json" \
  -d '{"amount":1000,"reason":"Viewer CN"}')
check "viewer issue CN → 403" "403" "$(http_code "$R")"

R=$(command curl -s -w "\n%{http_code}" -H "Authorization: Bearer $EDITOR" \
  -X POST "$BASE_URL/invoices/$INV8/credit-notes" \
  -H "Content-Type: application/json" \
  -d '{"amount":5000,"reason":"Editor CN"}')
check "editor issue CN → 201" "201" "$(http_code "$R")"
CN8=$(http_body "$R" | jq -r '.data.id')

R=$(command curl -s -w "\n%{http_code}" -H "Authorization: Bearer $VIEWER" \
  "$BASE_URL/credit-notes/$CN8")
check "viewer GET CN → 200" "200" "$(http_code "$R")"

R=$(command curl -s -w "\n%{http_code}" -H "Authorization: Bearer $EDITOR" \
  -X POST "$BASE_URL/credit-notes/$CN8/void" -H "Content-Type: application/json")
check "editor void CN → 403 (admin only)" "403" "$(http_code "$R")"

R=$(command curl -s -w "\n%{http_code}" -H "Authorization: Bearer $EDITOR" \
  -X POST "$BASE_URL/credit-notes/$CN8/refund" -H "Content-Type: application/json")
check "editor refund CN → 403 (admin only)" "403" "$(http_code "$R")"

# ── 9. Idempotency ────────────────────────────────────────────────────────────
echo ""
echo "Idempotency"
read -r _ INV9 <<<"$(make_invoice)"
KEY="cn-idem-$(date +%s)-$RANDOM"
curl -s -X POST "$BASE_URL/invoices/$INV9/credit-notes" \
  -H "Content-Type: application/json" -H "Idempotency-Key: $KEY" \
  -d '{"amount":25000,"reason":"Idempotent CN"}' > /dev/null
curl -s -X POST "$BASE_URL/invoices/$INV9/credit-notes" \
  -H "Content-Type: application/json" -H "Idempotency-Key: $KEY" \
  -d '{"amount":25000,"reason":"Idempotent CN"}' > /dev/null
check "idempotent replay → single CN" "1" \
  "$(curl -s "$BASE_URL/invoices/$INV9/credit-notes" | jq '.data | length')"

# ── 10. List + org isolation ──────────────────────────────────────────────────
echo ""
echo "List + org isolation"
R=$(curl -s -w "\n%{http_code}" "$BASE_URL/credit-notes")
check "GET /credit-notes → 200" "200" "$(http_code "$R")"
check "admin sees CNs" "true" "$(http_body "$R" | jq '(.data | length) > 0')"

ORG_Z=$(curl -s -X POST "$BASE_URL/organizations" \
  -H "Content-Type: application/json" -d '{"name":"CN Org Z","type":"company"}' | jq -r '.data.id')
TOKEN_Z=$(node "$DIR/gen-token.mjs" cn-org-z admin 3600 "$ORG_Z")
ZCOUNT=$(command curl -s -H "Authorization: Bearer $TOKEN_Z" "$BASE_URL/credit-notes" | jq '.data | length')
check "org-Z sees 0 credit notes (isolated)" "0" "$ZCOUNT"

summary
