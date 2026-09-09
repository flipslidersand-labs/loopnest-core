#!/usr/bin/env bash
# JWT authentication and RBAC enforcement tests.
# Uses `command curl` directly to control the Authorization header precisely.
set +e
source "$(dirname "$0")/lib.sh"

DIR="$(cd "$(dirname "$0")" && pwd)"
JWT_SECRET="${JWT_SECRET:-loopnest_dev_secret}"

gen() { node "$DIR/gen-token.mjs" "$1" "$2" "${3:-3600}"; }

ADMIN_TOKEN=$(gen itest-admin admin)
EDITOR_TOKEN=$(gen itest-editor editor)
VIEWER_TOKEN=$(gen itest-viewer viewer)
EXPIRED_TOKEN=$(gen itest-expired admin -1)
BAD_TOKEN="not.a.valid.token"
WRONG_SECRET_TOKEN=$(JWT_SECRET=wrong_secret node "$DIR/gen-token.mjs" itest-admin admin)

echo "=== Authentication & RBAC Tests ==="
echo ""

# ── 1. No token → 401 ────────────────────────────────────────────────────────
echo "No token"
R=$(command curl -s -w "\n%{http_code}" "$BASE_URL/customers")
check "no token → 401" "401" "$(http_code "$R")"
check "no token error code" "UNAUTHORIZED" "$(http_body "$R" | jq -r '.error.code')"

# ── 2. Malformed / invalid tokens → 401 ──────────────────────────────────────
echo ""
echo "Invalid tokens"
R=$(command curl -s -w "\n%{http_code}" -H "Authorization: Bearer $BAD_TOKEN" "$BASE_URL/customers")
check "bad token → 401" "401" "$(http_code "$R")"

R=$(command curl -s -w "\n%{http_code}" -H "Authorization: Bearer $WRONG_SECRET_TOKEN" "$BASE_URL/customers")
check "wrong-secret token → 401" "401" "$(http_code "$R")"

R=$(command curl -s -w "\n%{http_code}" -H "Authorization: Bearer $EXPIRED_TOKEN" "$BASE_URL/customers")
check "expired token → 401" "401" "$(http_code "$R")"

R=$(command curl -s -w "\n%{http_code}" -H "Authorization: Basic dXNlcjpwYXNz" "$BASE_URL/customers")
check "Basic auth (not Bearer) → 401" "401" "$(http_code "$R")"

# ── 3. Viewer: reads allowed, writes rejected ─────────────────────────────────
echo ""
echo "Viewer role"
R=$(command curl -s -w "\n%{http_code}" -H "Authorization: Bearer $VIEWER_TOKEN" "$BASE_URL/customers")
check "viewer GET /customers → 200" "200" "$(http_code "$R")"

R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "$BASE_URL/customers" \
  -d '{"name":"Viewer Corp"}')
check "viewer POST /customers → 403" "403" "$(http_code "$R")"
check "viewer POST error code FORBIDDEN" "FORBIDDEN" "$(http_body "$R" | jq -r '.error.code')"

R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "$BASE_URL/workflow/quotes/00000000-0000-0000-0000-000000000001/submit" \
  -d '{"userId":"u1"}')
check "viewer POST workflow → 403" "403" "$(http_code "$R")"

# ── 4. Editor: writes allowed, deletes rejected ───────────────────────────────
echo ""
echo "Editor role"
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "$BASE_URL/customers" \
  -d '{"name":"Editor Corp","phone":"0000000000"}')
check "editor POST /customers → 201" "201" "$(http_code "$R")"
CUST_ID=$(http_body "$R" | jq -r '.data.id')

R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $EDITOR_TOKEN" \
  -X DELETE "$BASE_URL/customers/$CUST_ID")
check "editor DELETE /customers → 403" "403" "$(http_code "$R")"

# ── 5. Admin: full access including delete ────────────────────────────────────
echo ""
echo "Admin role"
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "$BASE_URL/customers" \
  -d '{"name":"Admin Corp","phone":"0000000001"}')
check "admin POST /customers → 201" "201" "$(http_code "$R")"
ADMIN_CUST_ID=$(http_body "$R" | jq -r '.data.id')

R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -X DELETE "$BASE_URL/customers/$ADMIN_CUST_ID")
check "admin DELETE /customers → 200" "200" "$(http_code "$R")"

# Users endpoint: POST/PATCH/DELETE require admin
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "$BASE_URL/users" \
  -d '{"name":"x","email":"x@x.com","organizationId":"00000000-0000-0000-0000-000000000001","role":"viewer"}')
check "editor POST /users → 403" "403" "$(http_code "$R")"

# ── 6. Workflow actor identity: non-admin cannot claim to act as another
#      userId, only as themselves (req.user.sub). Admin may act on behalf of
#      any userId (matches how the rest of the suite drives workflows). ─────
echo ""
echo "Workflow actor-identity guard (issue #121)"
EDITOR_CID=$(command curl -s \
  -H "Authorization: Bearer $EDITOR_TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE_URL/customers" \
  -d '{"name":"Actor Guard Corp","phone":"0000000002","address":"x"}' | jq -r '.data.id')
QNUM="QT-ACTORGUARD-$(date +%s)-$RANDOM"
EDITOR_QID=$(command curl -s \
  -H "Authorization: Bearer $EDITOR_TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE_URL/quotes" \
  -d "{\"quoteNumber\":\"$QNUM\",\"customerId\":\"$EDITOR_CID\",\"subtotalAmount\":1000,\"taxAmount\":100,\"totalAmount\":1100,\"createdBy\":\"itest-editor\"}" \
  | jq -r '.data.id')

# Editor claiming to be someone else -> 403, quote stays untouched.
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $EDITOR_TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE_URL/workflow/quotes/$EDITOR_QID/submit" \
  -d '{"userId":"someone-else"}')
check "editor submit as another userId → 403" "403" "$(http_code "$R")"
check "editor submit as another userId error code" "FORBIDDEN" "$(http_body "$R" | jq -r '.error.code')"

# Editor acting as themselves (sub matches body userId) -> allowed.
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $EDITOR_TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE_URL/workflow/quotes/$EDITOR_QID/submit" \
  -d '{"userId":"itest-editor"}')
check "editor submit as self → 200" "200" "$(http_code "$R")"

# Admin may act on behalf of an arbitrary userId (trusted delegate, matches
# how the rest of this test suite already drives workflows under admin).
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE_URL/workflow/quotes/$EDITOR_QID/approve" \
  -d '{"userId":"some-approver","notes":"admin delegate"}')
check "admin approve on behalf of another userId → 200" "200" "$(http_code "$R")"

summary
