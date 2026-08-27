# LoopNest Core

![Language](https://img.shields.io/badge/language-TypeScript-3178c6)
![Runtime](https://img.shields.io/badge/runtime-Node.js%2024-339933)
![License](https://img.shields.io/badge/license-MIT-green)

---

## English

A personal OS for building business systems. Constructs an integrated business platform modeled on a fictional company **LoopNest Tech** while growing a reusable library suite called **BizCore Toolkit**.

### Milestones

| # | Description | Status |
| --- | --- | --- |
| M01 | BtoB Quote-to-Billing (synchronous) | ✅ Done |
| M02 | Outbox async (reliability & idempotency) | ✅ Done |
| M03 | Error / Performance / Data Generator | ✅ Done |
| M04 | PDF Invoice generation (`GET /invoices/:id/pdf`) | ✅ Done |
| M05 | PDF Quote generation (`GET /quotes/:id/pdf`) | ✅ Done |
| M06 | Tax-rate master (`/api/tax-rates` CRUD, DB lookup on invoice issue) | ✅ Done |
| M07 | Discount management (discount on quotes, carried over to invoices) | ✅ Done |
| M08 | Customer credit limit (`credit_limit` / `credit_used`, invoice-issue blocking) | ✅ Done |
| M09 | Quote expiry (`expires_at`, auto-reject on expiry, expiring-soon list) | ✅ Done |
| M10 | Quote templates (CRUD + quote generation from template) | ✅ Done |
| M11 | Invoice Installments (installment payment schedule) | ✅ Done |
| M12 | Recurring Billing (periodic billing / subscription) | ✅ Done |
| M13 | Payments & Accounts Receivable (payment matching, AR aging) | ✅ Done |
| M14 | Credit Notes & Refunds | ✅ Done |

### Tech Stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js 24 / TypeScript |
| Framework | Express |
| Database | PostgreSQL 17 (Kysely + Prisma) |
| Cache / Queue | Redis / Valkey |
| Infrastructure | Docker Compose |
| Monorepo | pnpm workspaces + Turborepo |

### Directory Structure

```text
apps/api/               Express API server
  src/middleware/       auth, errorHandler, rateLimit, idempotency
  src/routes/           REST endpoints
  src/services/         Business logic (PaymentService, CreditNoteService, etc.)
  src/lib/              JWT, observability
packages/bizcore-db/    DB access layer (Kysely + Prisma)
  src/repositories/     Per-entity repositories
infra/migrations/       PostgreSQL migration SQL (000–010)
tests/integration/      bash curl-based integration tests (18 suites)
docs/                   ADR, backlog, design, roadmap
```

### Setup

```bash
# Install dependencies
pnpm install

# Start Docker (PostgreSQL + Redis)
docker compose up -d

# Apply migrations
bash infra/migrations/run.sh

# Start dev server
pnpm dev
```

Place environment variables in `env/.env.local` (see `env/.env.example`).

### Testing

```bash
# Run all integration suites (includes build)
bash tests/integration/run-all.sh

# Re-run skipping build
SKIP_BUILD=1 bash tests/integration/run-all.sh

# Single suite only
bash tests/integration/credit_notes.sh
```

> Docker must be running before executing tests.

### Key API Endpoints

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/workflow/quotes/:id/submit` | Submit quote |
| POST | `/api/workflow/quotes/:id/approve` | Approve quote |
| POST | `/api/workflow/quotes/:id/invoice` | Issue invoice |
| POST | `/api/invoices/:id/payments` | Record payment |
| POST | `/api/invoices/:id/credit-notes` | Issue credit note |
| POST | `/api/credit-notes/:id/apply` | Apply credit note |
| GET | `/api/reports/ar-aging` | AR aging report |
| GET | `/health` | Health check |
| GET | `/docs` | Swagger UI |

---

## 日本語

業務システム開発の自分専用 OS を作るプロジェクト。架空企業 **LoopNest Tech 株式会社** の統合業務基盤を構築しながら、再利用可能なライブラリ群「**BizCore Toolkit**」を育てる。

### マイルストーン

| # | 内容 | 状態 |
| --- | --- | --- |
| M01 | BtoB Quote-to-Billing（見積〜請求 同期版） | ✅ 完了 |
| M02 | Outbox 非同期化（信頼性・冪等性） | ✅ 完了 |
| M03 | Error / Performance / Data Generator | ✅ 完了 |
| M04 | PDF 請求書生成（`GET /invoices/:id/pdf`） | ✅ 完了 |
| M05 | PDF 見積書生成（`GET /quotes/:id/pdf`） | ✅ 完了 |
| M06 | 税率マスタ（`/api/tax-rates` CRUD・請求書発行時 DB 参照） | ✅ 完了 |
| M07 | 割引管理（見積書への discount 適用・請求書引継ぎ） | ✅ 完了 |
| M08 | 顧客クレジット枠（credit_limit / credit_used・請求書発行ブロック） | ✅ 完了 |
| M09 | 見積有効期限（expires_at・期限切れ自動リジェクト・期限迫る一覧） | ✅ 完了 |
| M10 | 見積テンプレート（CRUD + テンプレートから見積書生成） | ✅ 完了 |
| M11 | Invoice Installments（分割払いスケジュール） | ✅ 完了 |
| M12 | Recurring Billing（定期請求・サブスクリプション） | ✅ 完了 |
| M13 | Payments & Accounts Receivable（入金消込・AR エイジング） | ✅ 完了 |
| M14 | Credit Notes & Refunds（クレジットノート・返金） | ✅ 完了 |

### 技術スタック

- **Runtime**: Node.js 24 / TypeScript
- **Framework**: Express
- **DB**: PostgreSQL 17（Kysely + Prisma 併用）
- **Cache / Queue**: Redis / Valkey
- **Infra**: Docker Compose
- **Monorepo**: pnpm workspaces + Turborepo

### ディレクトリ構成

```text
apps/api/               Express API サーバー
  src/middleware/       auth, errorHandler, rateLimit, idempotency
  src/routes/           REST エンドポイント
  src/services/         ビジネスロジック（PaymentService, CreditNoteService 等）
  src/lib/              JWT, observability
packages/bizcore-db/    DB アクセス層（Kysely + Prisma）
  src/repositories/     各エンティティ Repository
infra/migrations/       PostgreSQL マイグレーション SQL（000〜010）
tests/integration/      bash curl ベース統合テスト（18 スイート）
docs/                   ADR, backlog, design, roadmap
```

### セットアップ

```bash
# 依存インストール
pnpm install

# Docker 起動（PostgreSQL + Redis）
docker compose up -d

# マイグレーション適用
bash infra/migrations/run.sh

# 開発サーバー起動
pnpm dev
```

環境変数は `env/.env.local` に配置してください（`env/.env.example` 参照）。

### テスト

```bash
# 全統合スイートを実行（ビルド込み）
bash tests/integration/run-all.sh

# ビルドをスキップして再実行
SKIP_BUILD=1 bash tests/integration/run-all.sh

# 単一スイートのみ
bash tests/integration/credit_notes.sh
```

> テストには Docker が起動済みであることが必要です。

### 主要 API エンドポイント

| メソッド | パス | 説明 |
| --- | --- | --- |
| POST | `/api/workflow/quotes/:id/submit` | 見積提出 |
| POST | `/api/workflow/quotes/:id/approve` | 見積承認 |
| POST | `/api/workflow/quotes/:id/invoice` | 請求書発行 |
| POST | `/api/invoices/:id/payments` | 入金記録 |
| POST | `/api/invoices/:id/credit-notes` | クレジットノート発行 |
| POST | `/api/credit-notes/:id/apply` | クレジットノート適用 |
| GET | `/api/reports/ar-aging` | AR エイジングレポート |
| GET | `/health` | ヘルスチェック |
| GET | `/docs` | Swagger UI |
