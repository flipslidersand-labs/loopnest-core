#!/usr/bin/env bash
# Regression guard for issue #118: EventWorker.scanOverdue() used to dedup
# via a check-then-insert (NOT EXISTS, then a separate outbox INSERT), which
# races under multiple EventWorker replicas. Verifies the invoice ends up
# flagged exactly once even across multiple overlapping scan ticks
# (OVERDUE_SCAN_INTERVAL_MS is set low for tests by run-all.sh).
set +e
source "$(dirname "$0")/lib.sh"

PSQL_URL="${DATABASE_URL:-postgres://loopnest:loopnest_dev_password@localhost:5432/omni_local}"
db_scalar() { psql "$PSQL_URL" -tA -c "$1" 2>/dev/null; }

echo "=== Overdue Scan Dedup (issue #118) ==="
echo ""

CID=$(make_customer "Overdue Scan Co")
QID=$(make_quote "$CID")
curl -s -X POST "$BASE_URL/workflow/quotes/$QID/submit" \
  -H "Content-Type: application/json" -d '{"userId":"user1"}' > /dev/null
curl -s -X POST "$BASE_URL/workflow/quotes/$QID/approve" \
  -H "Content-Type: application/json" -d '{"userId":"approver1","notes":"ok"}' > /dev/null
INVOICE_RESP=$(curl -s -X POST "$BASE_URL/workflow/quotes/$QID/invoice" \
  -H "Content-Type: application/json" -d '{"userId":"user1"}')
INVOICE_ID=$(echo "$INVOICE_RESP" | jq -r '.data.invoice.invoiceId')

if [ -z "$INVOICE_ID" ] || [ "$INVOICE_ID" = "null" ]; then
  fail "setup: could not create invoice ($INVOICE_RESP)"
  summary
  exit $?
fi
pass "setup: invoice created ($INVOICE_ID)"

# Backdate payment_due_date directly — normal API flow has no way to create
# an already-overdue invoice, and this is exactly the row scanOverdue() will
# pick up on its next tick.
db_scalar "UPDATE finance.invoices SET payment_due_date = CURRENT_DATE - INTERVAL '5 days' WHERE id = '$INVOICE_ID'" > /dev/null

# Wait across at least two scan ticks so an unpatched check-then-insert race
# (or any regression reintroducing it) has a chance to double-fire.
sleep 7

OVERDUE_COUNT=$(db_scalar "SELECT count(*) FROM events.outbox_events WHERE event_type = 'payment_overdue' AND aggregate_id = '$INVOICE_ID'")
if [ "${OVERDUE_COUNT:-0}" = "1" ]; then
  pass "exactly 1 payment_overdue outbox event for the invoice (not double-flagged)"
else
  fail "payment_overdue outbox event count (expected: 1, actual: ${OVERDUE_COUNT:-0})"
fi

summary
