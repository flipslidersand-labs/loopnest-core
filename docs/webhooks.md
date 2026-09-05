# Webhook Delivery

LoopNest Core sends webhook notifications when business events occur. Each delivery includes an HMAC-SHA256 signature and a timestamp so receivers can verify authenticity and reject replayed requests.

## Request format

```
POST <your-endpoint>
Content-Type: application/json
X-LoopNest-Timestamp: 1725494400
X-LoopNest-Signature: sha256=<hex>
```

### Payload

```json
{
  "event": "invoice.created",
  "data": { ... },
  "timestamp": "2026-09-05T00:00:00.000Z"
}
```

## Signature verification

The signature covers **both** the Unix timestamp and the raw request body, separated by a dot:

```
signed_content = timestamp + "." + body
signature      = HMAC-SHA256(secret, signed_content)
header         = "sha256=" + hex(signature)
```

### Verification example (Node.js)

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifyWebhook(secret, rawBody, headers) {
  const timestamp = headers['x-loopnest-timestamp'];
  const received  = headers['x-loopnest-signature'];

  if (!timestamp || !received) return false;

  // Reject requests older than 5 minutes
  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (age > 300 || age < -60) return false;

  const expected = 'sha256=' + createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}
```

## Replay protection

Receivers should:

1. Check that `X-LoopNest-Timestamp` is within **±5 minutes** of the current time.
2. Optionally store processed `(timestamp, signature)` pairs for the tolerance window to reject exact duplicates.

Without step 1 an attacker who captures a valid delivery can replay it indefinitely.

## Event types

| Event | Trigger |
|-------|---------|
| `quote.submitted` | Quote moved to `pending_approval` |
| `quote.approved`  | Quote approved |
| `invoice.created` | Invoice generated from approved quote |
| `payment.overdue` | Invoice past `payment_due_date` with outstanding balance |
| `payment.received`| Payment recorded against an invoice |
