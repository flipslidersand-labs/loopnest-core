# API Error Code Reference

All error responses follow this shape:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description"
  }
}
```

---

## General Errors

| Code | HTTP Status | When | Recommended Action |
|------|-------------|------|--------------------|
| `NOT_FOUND` | 404 | Resource does not exist or ID is invalid | Check the ID; do not retry without correction |
| `UNAUTHORIZED` | 401 | Missing or invalid JWT token | Re-authenticate and obtain a new token |
| `FORBIDDEN` | 403 | Authenticated but insufficient role/org access | Contact an admin; do not retry |
| `VALIDATION_ERROR` | 400 | Request body is missing required fields or contains invalid values | Fix the request payload |
| `INVALID_REFERENCE` | 400 | A referenced resource (e.g. `customerId`) does not exist | Verify the referenced resource exists first |
| `DUPLICATE_ENTRY` | 409 | Unique constraint violated (e.g. duplicate SKU) | Change the conflicting field value |
| `CONFLICT` | 409 | Operation conflicts with current resource state | Refresh the resource and retry if applicable |
| `INTERNAL_ERROR` | 500 | Unexpected server error | Retry with exponential backoff; report if persistent |

---

## Idempotency Errors

| Code | HTTP Status | When | Recommended Action |
|------|-------------|------|--------------------|
| `IDEMPOTENCY_KEY_CONFLICT` | 409 | Same `Idempotency-Key` used with a different request payload | Use a new key for a different request |
| `IDEMPOTENCY_IN_FLIGHT` | 409 | A request with this `Idempotency-Key` is currently being processed | Wait and retry; the original response will be returned |

---

## Rate Limit Errors

| Code | HTTP Status | When | Recommended Action |
|------|-------------|------|--------------------|
| `RATE_LIMITED` | 429 | Too many requests within the time window | Back off and retry after the window resets (default: 60 s) |

---

## Workflow / State Machine Errors

| Code | HTTP Status | When | Recommended Action |
|------|-------------|------|--------------------|
| `INVALID_STATUS` | 409 | Operation is not valid for the resource's current status (e.g. invoicing a draft quote) | Check the resource status before retrying |
| `CREDIT_LIMIT_EXCEEDED` | 422 | Invoice total exceeds the customer's available credit | Increase the credit limit or reduce the invoice amount |
| `OVERPAYMENT` | 422 | Payment amount exceeds the outstanding invoice balance | Adjust the payment amount |
| `EMPTY_TEMPLATE` | 422 | Quote template has no line items | Add at least one item to the template before use |

---

## Prisma / Database Errors (surfaced as API errors)

| Prisma Code | API Code | HTTP Status | When |
|-------------|----------|-------------|------|
| P2002 | `DUPLICATE_ENTRY` | 409 | Unique constraint violation |
| P2003 | `INVALID_REFERENCE` | 400 | Foreign key constraint violation |
| P2025 | `NOT_FOUND` | 404 | Record not found in DB |
| P2023 / P2016 / P2018 / P2014 / P2022 | `VALIDATION_ERROR` | 400 | Malformed ID or data integrity error |

---

## Validation — Grep All Codes

To verify all codes in use are documented:

```bash
grep -roh "'[A-Z][A-Z_]\{4,\}'" apps/api/src/ | tr -d "'" | sort -u
```
