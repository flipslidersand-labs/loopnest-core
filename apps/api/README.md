# LoopNest Core API Server

Express.js REST API for LoopNest Core BtoB Quote-to-Billing system.

## Quick Start

```bash
npm install
npm run dev              # Development mode
npm run build           # Compile TypeScript
npm start               # Production mode
```

## API Endpoints

### Health Check
- `GET /health` — Server status

### Organizations
- `GET /api/organizations` — List all organizations (paginated)
- `GET /api/organizations/:id` — Get organization by ID
- `GET /api/organizations/:id/children` — Get child organizations
- `POST /api/organizations` — Create new organization
- `PATCH /api/organizations/:id` — Update organization
- `DELETE /api/organizations/:id` — Delete organization

**Query Parameters**:
- `skip` (number) — Pagination offset (default: 0)
- `take` (number) — Pagination limit (default: 10)

### Customers
- `GET /api/customers` — List all customers (paginated)
- `GET /api/customers/:id` — Get customer by ID
- `POST /api/customers` — Create new customer
- `PATCH /api/customers/:id` — Update customer
- `DELETE /api/customers/:id` — Delete customer

**Request Body (POST/PATCH)**:
```json
{
  "name": "Customer Name",
  "address": "123 Main St",
  "phone": "09012345678"
}
```

### Products
- `GET /api/products` — List products (paginated, with optional category filter)
- `GET /api/products/:id` — Get product by ID
- `GET /api/products/sku/:sku` — Get product by SKU
- `POST /api/products` — Create new product
- `PATCH /api/products/:id` — Update product
- `DELETE /api/products/:id` — Delete product

**Query Parameters**:
- `category` (string) — Filter by category
- `skip`, `take` — Pagination

**Request Body (POST/PATCH)**:
```json
{
  "sku": "SKU-001",
  "name": "Product Name",
  "category": "laptop",
  "unitPrice": 10000000
}
```

### Quotes
- `GET /api/quotes` — List quotes (with optional filters)
- `GET /api/quotes/:id` — Get quote with line items
- `GET /api/quotes/number/:quoteNumber` — Get quote by quote number
- `POST /api/quotes` — Create new quote
- `PATCH /api/quotes/:id` — Update quote status/amounts
- `DELETE /api/quotes/:id` — Delete quote

**Query Parameters**:
- `status` (string) — Filter by status (draft, pending_approval, approved, rejected, invoiced)
- `customerId` (UUID) — Filter by customer
- `skip`, `take` — Pagination

**Request Body (POST)**:
```json
{
  "quoteNumber": "Q202605-00001",
  "quoteRequestId": "uuid",
  "customerId": "uuid",
  "subtotalAmount": 1000000,
  "taxAmount": 100000,
  "totalAmount": 1100000,
  "createdBy": "user-uuid"
}
```

### Users (Staff)
- `GET /api/users` — List users (paginated, with optional filters)
- `GET /api/users/:id` — Get user by ID
- `GET /api/users/email/:email` — Get user by email
- `POST /api/users` — Create new user
- `PATCH /api/users/:id` — Update user
- `DELETE /api/users/:id` — Delete user

**Query Parameters**:
- `role` (string) — Filter by role (director, manager, senior, sales_rep)
- `organizationId` (UUID) — Filter by organization
- `skip`, `take` — Pagination

**Request Body (POST/PATCH)**:
```json
{
  "name": "田中 健司",
  "nameEn": "Kenji Tanaka",
  "email": "k.tanaka@loopnest.example",
  "organizationId": "org-uuid",
  "role": "director",
  "profile": {
    "speed": 0.9,
    "accuracy": 0.95,
    "habits": {...}
  }
}
```

## Response Format

### Success (2xx)
```json
{
  "data": { /* result object or array */ },
  "pagination": { "skip": 0, "take": 10, "total": 27 },
  "filter": { /* optional: active filters */ }
}
```

### Error (4xx/5xx)
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found"
  }
}
```

## Error Codes

- `NOT_FOUND` — Resource not found (404)
- `VALIDATION_ERROR` — Invalid request data (400)
- `INTERNAL_ERROR` — Server error (500)

## Architecture

```
apps/api/
├── src/
│   ├── server.ts           # Express initialization
│   ├── middleware/
│   │   └── errorHandler.ts # Error handling + async wrapper
│   └── routes/
│       ├── organizations.ts
│       ├── customers.ts
│       ├── products.ts
│       ├── quotes.ts
│       └── users.ts
├── package.json
├── tsconfig.json
└── README.md (this file)
```

## Database Integration

Uses `@loopnest/bizcore-db` Repository pattern:
- `OrganizationRepository` (Prisma)
- `CustomerRepository` (Prisma)
- `ProductRepository` (Prisma)
- `QuoteRepository` (Prisma)
- `UserRepository` (Prisma)

All database services initialized via `initializeDatabaseServices()`.

## Environment Variables

```bash
PORT=3000                      # API server port
POSTGRES_HOST=localhost        # Database host
POSTGRES_PORT=5432           # Database port
POSTGRES_USER=loopnest       # Database user
POSTGRES_PASSWORD=...        # Database password
POSTGRES_DB=omni_local       # Database name
```
