#!/usr/bin/env bash
# Integration tests: users endpoint authorization (Issue #116 / M27)
# Note: lib.sh overrides `curl` to add AUTH_TOKEN automatically.
# Use `command curl` (bypasses the override) for unauthenticated requests.
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Users Authorization Tests ==="
echo ""

# ── Unauthenticated access must be rejected ───────────────────────────────────

echo "Unauthenticated access (command curl bypasses lib.sh AUTH_TOKEN override)"

STATUS=$(command curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/users")
check "GET /users unauthenticated → 401" "401" "$STATUS"

STATUS=$(command curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/users/some-id")
check "GET /users/:id unauthenticated → 401" "401" "$STATUS"

STATUS=$(command curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/users/email/foo@example.com")
check "GET /users/email/:email unauthenticated → 401" "401" "$STATUS"

# ── Authenticated access returns users ───────────────────────────────────────

echo ""
echo "Authenticated access (uses lib.sh AUTH_TOKEN)"

R=$(curl -s "$BASE_URL/users")
check "GET /users authenticated returns data array" \
  "array" "$(echo "$R" | jq -r '.data | type')"
check "GET /users response has pagination" \
  "true" "$(echo "$R" | jq 'has("pagination")')"

# ── Write operations require admin role ───────────────────────────────────────

echo ""
echo "Write operations must not return 200 without valid target"

# PATCH on a nonexistent id should return 404 (admin token) not 200
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH \
  -H "Content-Type: application/json" \
  -d '{"name":"test"}' \
  "$BASE_URL/users/00000000-0000-0000-0000-000000000000")
if [ "$STATUS" = "200" ]; then
  fail "PATCH /users/:id on nonexistent id must not return 200"
else
  pass "PATCH /users/:id nonexistent → $STATUS (not 200)"
fi

echo ""
summary
