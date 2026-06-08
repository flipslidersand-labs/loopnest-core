#!/usr/bin/env bash
# M12: Org Member Management — CRUD on /api/organizations/:orgId/members.
# User business roles stored in DB: director | manager | senior | sales_rep
set +e
source "$(dirname "$0")/lib.sh"

echo "=== Member Management Tests ==="
echo ""

# ── Org + tokens ──────────────────────────────────────────────────────────────
ORG_A=$(curl -s -X POST "$BASE_URL/organizations" \
  -H "Content-Type: application/json" \
  -d '{"name":"Members Org A","type":"company"}' | jq -r '.data.id')
ORG_B=$(curl -s -X POST "$BASE_URL/organizations" \
  -H "Content-Type: application/json" \
  -d '{"name":"Members Org B","type":"company"}' | jq -r '.data.id')

check "org A created" "true" "$([ -n "$ORG_A" ] && [ "$ORG_A" != "null" ] && echo true || echo false)"
check "org B created" "true" "$([ -n "$ORG_B" ] && [ "$ORG_B" != "null" ] && echo true || echo false)"

# JWT RBAC tokens (admin/viewer) for access-control tests; org-scoped for isolation tests.
TOKEN_A=$(node "$(dirname "$0")/gen-token.mjs" mem-admin-a admin 3600 "$ORG_A")
VIEWER_A=$(node "$(dirname "$0")/gen-token.mjs" mem-viewer-a viewer 3600 "$ORG_A")
TOKEN_B=$(node "$(dirname "$0")/gen-token.mjs" mem-admin-b admin 3600 "$ORG_B")

SUFFIX="MBR$(date +%s)"

# ── 1. POST — add member ───────────────────────────────────────────────────────
echo ""
echo "Add member"
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN_A" \
  -X POST "$BASE_URL/organizations/$ORG_A/members" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Alice ${SUFFIX}\",\"email\":\"alice-${SUFFIX}@example.com\",\"role\":\"manager\"}")
check "POST /members → 201" "201" "$(http_code "$R")"
ALICE_ID=$(http_body "$R" | jq -r '.data.id')
check "member id returned" "true" "$([ -n "$ALICE_ID" ] && [ "$ALICE_ID" != "null" ] && echo true || echo false)"
check "member has correct orgId" "$ORG_A" "$(http_body "$R" | jq -r '.data.organizationId')"
check "member has manager role" "manager" "$(http_body "$R" | jq -r '.data.role')"

# Bad role (not in director|manager|senior|sales_rep)
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN_A" \
  -X POST "$BASE_URL/organizations/$ORG_A/members" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Bad\",\"email\":\"bad-${SUFFIX}@example.com\",\"role\":\"superuser\"}")
check "invalid role → 400" "400" "$(http_code "$R")"

# Missing fields
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN_A" \
  -X POST "$BASE_URL/organizations/$ORG_A/members" \
  -H "Content-Type: application/json" \
  -d '{"name":"Bob"}')
check "missing email → 400" "400" "$(http_code "$R")"

# Duplicate email
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN_A" \
  -X POST "$BASE_URL/organizations/$ORG_A/members" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Alice Dup\",\"email\":\"alice-${SUFFIX}@example.com\",\"role\":\"senior\"}")
check "duplicate email → 409" "409" "$(http_code "$R")"

# ── 2. GET list ────────────────────────────────────────────────────────────────
echo ""
echo "List members"
# Add a second member with a different role
BOB_R=$(command curl -s \
  -H "Authorization: Bearer $TOKEN_A" \
  -X POST "$BASE_URL/organizations/$ORG_A/members" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Bob ${SUFFIX}\",\"email\":\"bob-${SUFFIX}@example.com\",\"role\":\"senior\"}")
BOB_ID=$(echo "$BOB_R" | jq -r '.data.id')

R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN_A" \
  "$BASE_URL/organizations/$ORG_A/members")
check "GET /members → 200" "200" "$(http_code "$R")"
check "list contains Alice" "true" \
  "$(http_body "$R" | jq --arg id "$ALICE_ID" '[.data[].id] | contains([$id])')"
check "list contains Bob" "true" \
  "$(http_body "$R" | jq --arg id "$BOB_ID" '[.data[].id] | contains([$id])')"

# Role filter: senior=Bob, not Alice (manager)
R=$(command curl -s -H "Authorization: Bearer $TOKEN_A" \
  "$BASE_URL/organizations/$ORG_A/members?role=senior")
check "role=senior returns Bob" "true" \
  "$(echo "$R" | jq --arg id "$BOB_ID" '[.data[].id] | contains([$id])')"
check "role=senior excludes Alice (manager)" "false" \
  "$(echo "$R" | jq --arg id "$ALICE_ID" '[.data[].id] | contains([$id])')"

# Pagination
R=$(command curl -s -H "Authorization: Bearer $TOKEN_A" \
  "$BASE_URL/organizations/$ORG_A/members?take=1&skip=0")
check "take=1 returns 1 member" "1" "$(echo "$R" | jq '.data | length')"

# ── 3. PATCH — change role ─────────────────────────────────────────────────────
echo ""
echo "Change role"
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN_A" \
  -X PATCH "$BASE_URL/organizations/$ORG_A/members/$ALICE_ID" \
  -H "Content-Type: application/json" \
  -d '{"role":"director"}')
check "PATCH role → 200" "200" "$(http_code "$R")"
check "role updated to director" "director" "$(http_body "$R" | jq -r '.data.role')"

# Invalid role
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN_A" \
  -X PATCH "$BASE_URL/organizations/$ORG_A/members/$ALICE_ID" \
  -H "Content-Type: application/json" \
  -d '{"role":"god"}')
check "PATCH invalid role → 400" "400" "$(http_code "$R")"

# ── 4. DELETE — remove member ─────────────────────────────────────────────────
echo ""
echo "Remove member"
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN_A" \
  -X DELETE "$BASE_URL/organizations/$ORG_A/members/$BOB_ID")
check "DELETE member → 200" "200" "$(http_code "$R")"

R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN_A" \
  "$BASE_URL/organizations/$ORG_A/members")
check "Bob gone from list after delete" "false" \
  "$(http_body "$R" | jq --arg id "$BOB_ID" '[.data[].id] | contains([$id])')"

# Delete non-existent → 404
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN_A" \
  -X DELETE "$BASE_URL/organizations/$ORG_A/members/00000000-0000-0000-0000-000000000000")
check "DELETE non-existent → 404" "404" "$(http_code "$R")"

# ── 5. Org isolation ──────────────────────────────────────────────────────────
echo ""
echo "Org isolation"
# Org B admin cannot list org A's members
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN_B" \
  "$BASE_URL/organizations/$ORG_A/members")
check "org B admin cannot GET org A members → 403" "403" "$(http_code "$R")"

# Org B admin cannot add to org A
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN_B" \
  -X POST "$BASE_URL/organizations/$ORG_A/members" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Eve\",\"email\":\"eve-${SUFFIX}@example.com\",\"role\":\"senior\"}")
check "org B admin cannot POST to org A → 403" "403" "$(http_code "$R")"

# Org B admin cannot patch org A's member
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $TOKEN_B" \
  -X PATCH "$BASE_URL/organizations/$ORG_A/members/$ALICE_ID" \
  -H "Content-Type: application/json" \
  -d '{"role":"senior"}')
check "org B admin cannot PATCH org A member → 403" "403" "$(http_code "$R")"

# Global admin (no orgId) can manage any org — AUTH_TOKEN has no orgId
CAROL_R=$(curl -s -w "\n%{http_code}" \
  -X POST "$BASE_URL/organizations/$ORG_B/members" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Carol ${SUFFIX}\",\"email\":\"carol-${SUFFIX}@example.com\",\"role\":\"senior\"}")
check "global admin POST to org B → 201" "201" "$(http_code "$CAROL_R")"

# ── 6. RBAC ───────────────────────────────────────────────────────────────────
echo ""
echo "RBAC"
# Viewer (RBAC role=viewer) can GET their own org's members
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $VIEWER_A" \
  "$BASE_URL/organizations/$ORG_A/members")
check "viewer GET /members → 200" "200" "$(http_code "$R")"

# Viewer cannot POST (requireRole('admin') blocks it)
R=$(command curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $VIEWER_A" \
  -X POST "$BASE_URL/organizations/$ORG_A/members" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Dave\",\"email\":\"dave-${SUFFIX}@example.com\",\"role\":\"senior\"}")
check "viewer POST /members → 403" "403" "$(http_code "$R")"

# Unauthenticated → 401
R=$(command curl -s -w "\n%{http_code}" \
  "$BASE_URL/organizations/$ORG_A/members")
check "unauthenticated → 401" "401" "$(http_code "$R")"

# Org not found → 404 (uses AUTH_TOKEN via curl() wrapper)
R=$(curl -s -w "\n%{http_code}" \
  "$BASE_URL/organizations/00000000-0000-0000-0000-000000000000/members")
check "unknown org → 404 (list)" "404" "$(http_code "$R")"

summary
