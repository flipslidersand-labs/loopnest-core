# LoopNest Core

業務システム開発の自分専用 OS を作るプロジェクト。

## プロジェクト概要

架空企業 LoopNest Tech 株式会社の統合業務基盤を構築しながら、再利用可能なライブラリ群「BizCore Toolkit」を育てる。

## マイルストーン

| # | 内容 | 状態 |
| --- | --- | --- |
| M01 | BtoB Quote-to-Billing（見積〜請求 同期版） | ✅ 完了 |
| M02 | Outbox 非同期化（信頼性・冪等性） | ✅ 完了 |
| M03 | Error / Performance / Data Generator | ✅ 完了 |
| M04 | PDF 請求書生成（`GET /invoices/:id/pdf`） | ✅ 完了 |
| M13 | Payments & Accounts Receivable（入金消込・AR エイジング） | ✅ 完了 |
| M14 | Credit Notes & Refunds（クレジットノート・返金） | ✅ 完了 |

## 技術スタック

- **Runtime**: Node.js 24 / TypeScript
- **Framework**: Express
- **DB**: PostgreSQL 17（Kysely + Prisma 併用）
- **Cache / Queue**: Redis / Valkey
- **Infra**: Docker Compose
- **Monorepo**: pnpm workspaces + Turborepo

## ディレクトリ構成

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

## セットアップ

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

## テスト

```bash
# 全統合スイートを実行（ビルド込み）
bash tests/integration/run-all.sh

# ビルドをスキップして再実行
SKIP_BUILD=1 bash tests/integration/run-all.sh

# 単一スイートのみ
bash tests/integration/credit_notes.sh
```

> テストには Docker が起動済みであることが必要です。

## 主要 API エンドポイント

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
