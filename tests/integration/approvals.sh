#!/usr/bin/env bash
# Multi-step approval workflow: creation, sequential approval, rejection,
# cancellation, and the guard conditions.
#
# All calls go out under a dedicated X-Forwarded-For so this suite's workflow
# traffic uses its own rate-limit bucket and doesn't disturb rate_limit.sh.
set +e
source "$(dirname "$0")/lib.sh"

XFF="10.99.0.1"
ac() { curl -s -H "X-Forwarded-For: $XFF" "$@"; }
acw() { curl -s -w "\n%{http_code}" -H "X-Forwarded-For: $XFF" "$@"; }

# Create a customer + quote and move it to pending_approval; echo the quoteId.
submitted_quote() {
  local cid qid qn
  cid=$(ac -X POST "$BASE_URL/customers" -H "Content-Type: application/json" \
    -d '{"name":"Appr Corp","phone":"0","address":"x"}' | jq -r '.data.id')
  qn="QT-APPR-$(date +%s)-$RANDOM"
  qid=$(ac -X POST "$BASE_URL/quotes" -H "Content-Type: application/json" \
    -d "{\"quoteNumber\":\"$qn\",\"customerId\":\"$cid\",\"subtotalAmount\":150000,\"taxAmount\":15000,\"totalAmount\":165000,\"createdBy\":\"u\"}" \
    | jq -r '.data.id')
  ac -X POST "$BASE_URL/workflow/quotes/$qid/submit" -H "Content-Type: application/json" \
    -d '{"userId":"u"}' > /dev/null
  echo "$qid"
}

echo "=== Approval Workflow ==="
echo ""

# ---------------------------------------------------------------------------
# Multi-step happy path: two approvers, both must approve.
# ---------------------------------------------------------------------------
echo "Two-step approval (both approve)"
QID=$(submitted_quote)
REQ=$(ac -X POST "$BASE_URL/workflow/approvals" -H "Content-Type: application/json" \
  -d "{\"quoteId\":\"$QID\",\"approverUserIds\":[\"alice\",\"bob\"]}")
RID=$(echo "$REQ" | jq -r '.data.id')
S1=$(echo "$REQ" | jq -r '.data.steps[0].id')
S2=$(echo "$REQ" | jq -r '.data.steps[1].id')
check "request created with 2 steps" "2" "$(echo "$REQ" | jq -r '.data.steps | length')"
check "request starts pending" "pending" "$(echo "$REQ" | jq -r '.data.status')"

# alice approves step 1 -> request still pending
ac -X POST "$BASE_URL/workflow/approvals/$RID/steps/$S1/approve" \
  -H "Content-Type: application/json" -d '{"userId":"alice","notes":"ok"}' > /dev/null
ST=$(ac "$BASE_URL/workflow/approvals/quote/$QID/status")
check "after 1/2, request still pending" "pending" "$(echo "$ST" | jq -r '.data.approvalRequest.status')"
check "after 1/2, progress 50%" "50" "$(echo "$ST" | jq -r '.data.progress.approvalPercentage')"

# bob approves step 2 -> request approved
ac -X POST "$BASE_URL/workflow/approvals/$RID/steps/$S2/approve" \
  -H "Content-Type: application/json" -d '{"userId":"bob"}' > /dev/null
ST=$(ac "$BASE_URL/workflow/approvals/quote/$QID/status")
check "after 2/2, request approved" "approved" "$(echo "$ST" | jq -r '.data.approvalRequest.status')"
check "after 2/2, progress 100%" "100" "$(echo "$ST" | jq -r '.data.progress.approvalPercentage')"

# ---------------------------------------------------------------------------
# Rejection: one rejection rejects the whole request.
# ---------------------------------------------------------------------------
echo ""
echo "Rejection"
QID2=$(submitted_quote)
REQ2=$(ac -X POST "$BASE_URL/workflow/approvals" -H "Content-Type: application/json" \
  -d "{\"quoteId\":\"$QID2\",\"approverUserIds\":[\"alice\",\"bob\"]}")
RID2=$(echo "$REQ2" | jq -r '.data.id')
RS1=$(echo "$REQ2" | jq -r '.data.steps[0].id')
ac -X POST "$BASE_URL/workflow/approvals/$RID2/steps/$RS1/reject" \
  -H "Content-Type: application/json" -d '{"userId":"alice","reason":"budget"}' > /dev/null
ST2=$(ac "$BASE_URL/workflow/approvals/quote/$QID2/status")
check "request rejected after one rejection" "rejected" "$(echo "$ST2" | jq -r '.data.approvalRequest.status')"

# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------
echo ""
echo "Guards"

# Approval request on a draft (not submitted) quote -> 409.
CID=$(ac -X POST "$BASE_URL/customers" -H "Content-Type: application/json" \
  -d '{"name":"Draft Corp","phone":"0","address":"x"}' | jq -r '.data.id')
DRAFT_Q=$(ac -X POST "$BASE_URL/quotes" -H "Content-Type: application/json" \
  -d "{\"quoteNumber\":\"QT-DRAFT-$(date +%s)-$RANDOM\",\"customerId\":\"$CID\",\"subtotalAmount\":1000,\"taxAmount\":100,\"totalAmount\":1100,\"createdBy\":\"u\"}" \
  | jq -r '.data.id')
R=$(acw -X POST "$BASE_URL/workflow/approvals" -H "Content-Type: application/json" \
  -d "{\"quoteId\":\"$DRAFT_Q\",\"approverUserIds\":[\"alice\"]}")
check "approval on draft quote -> 409" "409" "$(http_code "$R")"

# Duplicate approval request for the same quote -> 409.
QID3=$(submitted_quote)
ac -X POST "$BASE_URL/workflow/approvals" -H "Content-Type: application/json" \
  -d "{\"quoteId\":\"$QID3\",\"approverUserIds\":[\"alice\"]}" > /dev/null
R=$(acw -X POST "$BASE_URL/workflow/approvals" -H "Content-Type: application/json" \
  -d "{\"quoteId\":\"$QID3\",\"approverUserIds\":[\"alice\"]}")
check "duplicate approval request -> 409" "409" "$(http_code "$R")"

# Wrong approver tries to approve a step -> 403.
QID4=$(submitted_quote)
REQ4=$(ac -X POST "$BASE_URL/workflow/approvals" -H "Content-Type: application/json" \
  -d "{\"quoteId\":\"$QID4\",\"approverUserIds\":[\"alice\"]}")
RID4=$(echo "$REQ4" | jq -r '.data.id')
S4=$(echo "$REQ4" | jq -r '.data.steps[0].id')
R=$(acw -X POST "$BASE_URL/workflow/approvals/$RID4/steps/$S4/approve" \
  -H "Content-Type: application/json" -d '{"userId":"mallory"}')
check "wrong approver -> 403" "403" "$(http_code "$R")"

# Correct approver approves; re-approving the same step -> 409.
ac -X POST "$BASE_URL/workflow/approvals/$RID4/steps/$S4/approve" \
  -H "Content-Type: application/json" -d '{"userId":"alice"}' > /dev/null
R=$(acw -X POST "$BASE_URL/workflow/approvals/$RID4/steps/$S4/approve" \
  -H "Content-Type: application/json" -d '{"userId":"alice"}')
check "re-deciding a completed request -> 409" "409" "$(http_code "$R")"

# ---------------------------------------------------------------------------
# Pending-for-user and cancellation.
# ---------------------------------------------------------------------------
echo ""
echo "Pending list + cancellation"
QID5=$(submitted_quote)
REQ5=$(ac -X POST "$BASE_URL/workflow/approvals" -H "Content-Type: application/json" \
  -d "{\"quoteId\":\"$QID5\",\"approverUserIds\":[\"zoe\"]}")
RID5=$(echo "$REQ5" | jq -r '.data.id')
PENDING_FOR_ZOE=$(ac "$BASE_URL/workflow/approvals/user/zoe" | jq -r '.count')
if [ "${PENDING_FOR_ZOE:-0}" -ge 1 ]; then
  pass "pending approvals listed for assigned user (count=$PENDING_FOR_ZOE)"
else
  fail "pending approvals not listed for user (count=$PENDING_FOR_ZOE)"
fi

ac -X POST "$BASE_URL/workflow/approvals/$RID5/cancel" \
  -H "Content-Type: application/json" -d '{"userId":"admin"}' > /dev/null
ST5=$(ac "$BASE_URL/workflow/approvals/quote/$QID5/status")
check "request cancelled" "cancelled" "$(echo "$ST5" | jq -r '.data.approvalRequest.status')"

# Deciding a step on a cancelled request -> 409.
S5=$(echo "$REQ5" | jq -r '.data.steps[0].id')
R=$(acw -X POST "$BASE_URL/workflow/approvals/$RID5/steps/$S5/approve" \
  -H "Content-Type: application/json" -d '{"userId":"zoe"}')
check "approve step on cancelled request -> 409" "409" "$(http_code "$R")"

summary
