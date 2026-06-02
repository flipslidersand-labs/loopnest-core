#!/usr/bin/env bash
# Liveness, readiness, Prometheus metrics, and correlation-id propagation.
set +e
source "$(dirname "$0")/lib.sh"

ROOT_URL="${BASE_URL%/api}"

echo "=== Observability Tests ==="
echo ""

# 1. Liveness.
R=$(curl -s -w "\n%{http_code}" "$ROOT_URL/health")
check "/health returns 200" "200" "$(http_code "$R")"
check "/health status ok" "ok" "$(http_body "$R" | jq -r '.status')"

# 2. Readiness reports dependency checks.
R=$(curl -s -w "\n%{http_code}" "$ROOT_URL/ready")
check "/ready returns 200" "200" "$(http_code "$R")"
check "/ready postgres ok" "ok" "$(http_body "$R" | jq -r '.checks.postgres')"
check "/ready redis ok" "ok" "$(http_body "$R" | jq -r '.checks.redis')"

# 3. Generate some traffic, then scrape metrics.
make_customer "Metrics Warmup" > /dev/null
curl -s "$BASE_URL/customers?take=1" > /dev/null

METRICS=$(curl -s "$ROOT_URL/metrics")
check "metrics expose http_requests_total" "1" \
  "$(echo "$METRICS" | grep -c '^http_requests_total{' | head -1 | awk '{print ($1>0)?1:0}')"
check "metrics expose duration histogram" "1" \
  "$(echo "$METRICS" | grep -c 'http_request_duration_ms_bucket' | awk '{print ($1>0)?1:0}')"
check "metrics expose in-flight gauge" "1" \
  "$(echo "$METRICS" | grep -c '^http_requests_in_flight ' | awk '{print ($1>0)?1:0}')"
check "metrics expose process uptime" "1" \
  "$(echo "$METRICS" | grep -c '^process_uptime_seconds ' | awk '{print ($1>0)?1:0}')"

# 4. Correlation id: echoed back, and a supplied one is preserved.
HDRS=$(curl -s -D - -o /dev/null "$BASE_URL/customers?take=1")
check "response carries X-Correlation-Id" "1" \
  "$(echo "$HDRS" | grep -ic 'x-correlation-id')"

SUPPLIED="test-correlation-12345"
ECHOED=$(curl -s -D - -o /dev/null -H "X-Correlation-Id: $SUPPLIED" "$BASE_URL/customers?take=1" \
  | grep -i 'x-correlation-id' | tr -d '\r' | awk '{print $2}')
check "supplied correlation id is preserved" "$SUPPLIED" "$ECHOED"

summary
