#!/usr/bin/env bash
# Integration tests: portal login authentication (Issue #123 / M28)
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Portal Authentication Tests ==="
echo ""

# ── Setup: create a customer with an email address ─────────────────────────────

CUST_EMAIL="portal-test-$(date +%s)@example.com"

# Create customer via admin API (uses lib.sh AUTH_TOKEN)
CUST_RESP=$(curl -s -X POST "$BASE_URL/customers" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Portal Test Customer\",\"contactEmail\":\"$CUST_EMAIL\"}")
CUST_ID=$(echo "$CUST_RESP" | jq -r '.data.id // empty')
check "customer created for portal test" "true" "$([ -n \"$CUST_ID\" ] && echo true || echo false)"

if [ -z "$CUST_ID" ]; then
  echo "Cannot proceed without customer — skipping remaining tests"
  summary
  exit 0
fi

# ── Test: login without password set → PORTAL_NOT_CONFIGURED ─────────────────

echo "Login without portal password configured"

STATUS=$(command curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/portal/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$CUST_EMAIL\",\"password\":\"anypassword\"}")
check "login without password set → 401" "401" "$STATUS"

# ── Test: login without email/password fields → 400 ──────────────────────────

echo "Login with missing fields"

STATUS=$(command curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/portal/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$CUST_EMAIL\"}")
check "login missing password → 400" "400" "$STATUS"

STATUS=$(command curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/portal/login" \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"secret\"}")
check "login missing email → 400" "400" "$STATUS"

# ── Test: set portal password via admin API ────────────────────────────────────

echo "Set portal password (admin)"

SET_RESP=$(curl -s -X POST "$BASE_URL/portal/admin/set-password" \
  -H "Content-Type: application/json" \
  -d "{\"customerId\":\"$CUST_ID\",\"password\":\"Secr3tPass!\"}")
check "set-password returns customerId" \
  "$CUST_ID" "$(echo "$SET_RESP" | jq -r '.data.customerId // empty')"

# ── Test: login with correct password → 200 + token ──────────────────────────

echo "Login with correct password"

LOGIN_RESP=$(command curl -s -X POST "$BASE_URL/portal/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$CUST_EMAIL\",\"password\":\"Secr3tPass!\"}")
check "login with correct password → token present" \
  "true" "$(echo "$LOGIN_RESP" | jq 'has("token")')"
check "login token customerId matches" \
  "$CUST_ID" "$(echo "$LOGIN_RESP" | jq -r '.customerId // empty')"

# ── Test: login with wrong password → 401 ─────────────────────────────────────

echo "Login with wrong password"

STATUS=$(command curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/portal/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$CUST_EMAIL\",\"password\":\"WrongPass!\"}")
check "login with wrong password → 401" "401" "$STATUS"

# ── Test: login with unknown email → 401 (not 404, to avoid enumeration) ─────

echo "Login with unknown email"

STATUS=$(command curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/portal/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"nobody@example.com\",\"password\":\"anything\"}")
check "login with unknown email → 401 (not 404)" "401" "$STATUS"

echo ""
summary
