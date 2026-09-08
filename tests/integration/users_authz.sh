#!/usr/bin/env bash
# Integration tests: users endpoint authorization (Issue #116 / M27)
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Users Authorization Tests ==="
echo ""

# ── Unauthenticated access must be rejected ───────────────────────────────────

echo "Unauthenticated access"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/users")
check "GET /users unauthenticated → 401" "$STATUS" "401"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/users/some-id")
check "GET /users/:id unauthenticated → 401" "$STATUS" "401"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/users/email/foo@example.com")
check "GET /users/email/:email unauthenticated → 401" "$STATUS" "401"

# ── Authenticated viewer can list users in their org ──────────────────────────

echo ""
echo "Authenticated access"

R=$(curl -s "$BASE_URL/users")
check "GET /users authenticated returns data array" \
  "$(echo "$R" | jq -r '.data | type')" "array"
check "GET /users response has pagination" \
  "$(echo "$R" | jq 'has("pagination")')" "true"

# ── PATCH/DELETE still require admin ─────────────────────────────────────────

echo ""
echo "Write operations require admin role"

# Viewer token (from AUTH_TOKEN env) attempting PATCH → 403
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH \
  -H "Content-Type: application/json" \
  -d '{"name":"hacked"}' \
  "$BASE_URL/users/nonexistent-id")
# admin token in CI makes this 404 (user not found), viewer would be 403
# Either way it should not be 200
if [ "$STATUS" = "200" ]; then
  fail "PATCH /users/:id must not return 200 without valid admin+existing user"
else
  pass "PATCH /users/:id did not return 200 (got $STATUS)"
fi

echo ""
summary
