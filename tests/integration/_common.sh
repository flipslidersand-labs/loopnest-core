#!/usr/bin/env bash
# Shared shim for the M04+ suites (tax_rates, discounts, credit_limit,
# quote_expiry, quote_templates, pdf_invoice, pdf_quote, installments, recurring).
#
# Those suites were written against a different convention than lib.sh:
#   - BASE_URL is the server root (http://localhost:3000) and paths include /api
#   - the admin JWT is read from ADMIN_TOKEN
# run-all.sh (and CI) export BASE_URL=http://localhost:3000/api and AUTH_TOKEN,
# so without this shim every request hits /api/api/... and `curl -sf` + `set -e`
# kill the suite silently. Normalise both here so either convention works.

# Accept BASE_URL with or without a trailing /api.
BASE_URL="${BASE_URL:-http://localhost:3000}"
BASE_URL="${BASE_URL%/}"
BASE_URL="${BASE_URL%/api}"

# Fall back to the token run-all.sh generates for lib.sh suites.
ADMIN_TOKEN="${ADMIN_TOKEN:-${AUTH_TOKEN:-}}"

# Every /api route requires a bearer token; inject it into every curl call so
# the suites don't have to repeat the header on each request.
curl() {
  if [ -n "$ADMIN_TOKEN" ]; then
    command curl -H "Authorization: Bearer $ADMIN_TOKEN" "$@"
  else
    command curl "$@"
  fi
}
