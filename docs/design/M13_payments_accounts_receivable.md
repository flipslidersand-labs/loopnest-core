# M13 設計: 入金消込・売掛管理 (Payments & Accounts Receivable)

**ステータス**: Draft
**前提マイルストーン**: M01–M12 完了済み
**目的**: Quote-to-**Billing** を Quote-to-**Cash** へ拡張する。現状 `finance.invoices` は `status` + `paid_at` の二値的な支払い管理しか持たず、**入金トランザクション履歴・部分入金・売掛(AR)残高・滞留(エイジング)** が欠落している。M13 でこの最後のループを閉じる。

---

## 1. 背景 / 現状のギャップ

| 項目 | 現状 (M12まで) | M13 で解決 |
|------|----------------|-----------|
| 入金記録 | `invoices.paid_at` タイムスタンプのみ | 入金トランザクション台帳 `finance.payments` |
| 部分入金 | 不可（全額 paid か未払いの二択） | 複数入金の積み上げ・残高自動計算 |
| 売掛残高 | 算出手段なし | invoice 単位 / customer 単位の AR 残高 |
| 滞留管理 | `payment_due_date` はあるが未活用 | エイジング区分（0-30/31-60/61-90/90+）+ 超過検知 |
| 督促 | なし | `payment.overdue` Outbox/Webhook イベント |

invoice ステータス遷移は現状 `issued → sent → paid → cancelled`。M13 で **`partially_paid`** を追加し `issued → sent → partially_paid → paid` を許容する（`cancelled` は従来通り任意状態から）。

---

## 2. スコープ

### In scope
1. `finance.payments` 台帳（入金トランザクション）
2. 部分入金 → 残高自動計算 → invoice ステータス自動遷移（`partially_paid` / `paid`）
3. 入金の取消（reversal、論理）
4. AR 残高 API（invoice 別・customer 別）
5. エイジングレポート（Reporting に統合）
6. 滞留検知 → Outbox イベント `payment.overdue` → Webhook 配信
7. 全操作の Audit ログ記録 + RBAC 保護

### Out of scope (将来 M14+)
- クレジットノート / 返金（M14 候補）
- 定期/継続課金（サブスクリプション）
- 入金の自動マッチング（銀行明細 CSV インポート）
- 多通貨

---

## 3. データモデル

新規 migration: `infra/migrations/009_payments.sql`（finance スキーマ）

```sql
-- finance.payments (入金台帳)
CREATE TABLE IF NOT EXISTS finance.payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES finance.invoices(id),
  organization_id UUID,                              -- M07 org スコープ準拠
  amount          NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  method          VARCHAR(50) NOT NULL               -- 'bank_transfer','credit_card','cash','offset'
                    CHECK (method IN ('bank_transfer','credit_card','cash','offset')),
  paid_on         DATE NOT NULL,
  reference       VARCHAR(255),                       -- 振込人名義・取引ID等
  status          VARCHAR(20) NOT NULL DEFAULT 'confirmed'
                    CHECK (status IN ('confirmed','reversed')),
  reversed_at     TIMESTAMPTZ,
  reversal_reason TEXT,
  metadata        JSONB,
  created_by      VARCHAR(255),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON finance.payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_org     ON finance.payments(organization_id);
CREATE INDEX IF NOT EXISTS idx_payments_paid_on ON finance.payments(paid_on);
CREATE INDEX IF NOT EXISTS idx_payments_status  ON finance.payments(status);

-- invoices ステータス CHECK 制約を拡張
ALTER TABLE finance.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE finance.invoices ADD  CONSTRAINT invoices_status_check
  CHECK (status IN ('issued','sent','partially_paid','paid','cancelled'));
```

> 既存の Prisma schema は「マスタテーブルのみ」方針（schema.prisma 冒頭コメント参照）なので、`payments` は **raw SQL migration で finance スキーマに追加**し、アクセスは Kysely/pg 経由とする（既存 InvoiceService と同方式）。

**残高は派生値**（テーブルに持たせない）:
```
paid_total(invoice)      = Σ payments.amount WHERE status='confirmed'
outstanding(invoice)     = invoices.total_amount - paid_total
status:
  outstanding <= 0          → 'paid'      (+ paid_at = max(paid_on))
  0 < paid_total < total    → 'partially_paid'
  paid_total == 0           → 既存ステータス維持 (issued/sent)
```

---

## 4. API エンドポイント

新規ルート: `apps/api/src/routes/payments.ts`（既存 routes 群と同じ登録方式）

| Method | Path | RBAC | 説明 |
|--------|------|------|------|
| `POST` | `/invoices/:invoiceId/payments` | editor+ | 入金記録（部分可）。idempotency-key 対応 |
| `GET`  | `/invoices/:invoiceId/payments` | viewer+ | 当該 invoice の入金履歴 + 残高サマリ |
| `POST` | `/payments/:id/reverse` | admin | 入金取消（reversal） |
| `GET`  | `/payments` | viewer+ | 入金一覧（org スコープ・期間/method フィルタ） |
| `GET`  | `/reports/accounts-receivable` | viewer+ | AR エイジング（customer 別・区分別残高） |

すべて既存ミドルウェアを再利用: JWT 認証(M04) / org スコープ(M07) / idempotency-key / rate-limit / 監査ログ(M08)。

---

## 5. サービス層

新規 `apps/api/src/services/PaymentService.ts`。InvoiceService と協調。

主要メソッド:
- `recordPayment(invoiceId, dto, ctx)`
  1. invoice を `SELECT ... FOR UPDATE`（行ロックで競合入金を直列化）
  2. `payments` へ INSERT
  3. paid_total 再計算 → invoice.status / paid_at 更新
  4. **Outbox イベント** enqueue（同一 TX 内、M02 パターン）: `payment.recorded`、全額到達時 `invoice.paid`
  5. Audit ログ（M08）
- `reversePayment(paymentId, reason, ctx)` — status を `reversed` に、invoice ステータス再評価、`payment.reversed` イベント
- `getInvoiceBalance(invoiceId)` — 派生残高
- `getAgingReport(orgId, asOf)` — ReportingService から委譲利用

**重要な整合性ポイント**: 入金 INSERT・invoice 更新・Outbox enqueue を**単一 DB トランザクション**で行う（既存 EventWorker / Outbox の at-least-once 前提に合わせる）。

---

## 6. イベント / Webhook 連携 (M02 / M10 再利用)

新規イベント型を Outbox に追加し、既存 WebhookService 経由で配信:

| イベント | 発火条件 | ペイロード要素 |
|----------|----------|----------------|
| `payment.recorded` | 入金記録成功 | invoiceId, paymentId, amount, outstanding |
| `invoice.paid` | 全額消込で paid 到達 | invoiceId, paidTotal, paidAt |
| `payment.reversed` | 入金取消 | invoiceId, paymentId, reason |
| `payment.overdue` | 滞留検知ジョブ | invoiceId, customerId, daysOverdue, outstanding |

`payment.overdue` は EventWorker 内のスケジュール走査（`payment_due_date < now() AND status != 'paid'`）で日次生成。既存 mock-accounting-api を配信先テストに流用可能。

---

## 7. レポーティング統合 (M09)

ReportingService に AR エイジング集計を追加:
- customer 別 outstanding 合計
- 区分別バケット: `current(0-30)` / `31-60` / `61-90` / `90+`
- 期間指定 `asOf` 日付基準
既存 `/reports/*` と同じ応答フォーマットに合わせる。

---

## 8. テスト計画（既存 integration suite に追加）

M11/M12 が「63 new integration checks」を追加した方式に倣い、以下を **persisted integration suite** に追加:

1. 全額入金 → `paid` 遷移 + `paid_at` 設定
2. 部分入金 ×2 → `partially_paid` → 全額到達で `paid`
3. 過入金（total 超過）の拒否 or 許容ポリシー検証
4. 並行入金（FOR UPDATE 直列化）で二重消込が起きない
5. reversal で残高・ステータスが正しく巻き戻る
6. org スコープ越境アクセスの 403
7. RBAC: viewer が POST で 403 / admin のみ reverse 可
8. idempotency-key 重複 POST が単一入金になる
9. Outbox に `payment.recorded` / `invoice.paid` が atomically 記録される
10. エイジングレポートのバケット境界（30/60/90 日）

目標: **+25〜30 integration checks**。

---

## 9. 実装タスク分解（projects-config 登録用）

| ID | タスク | 依存 |
|----|--------|------|
| lnc-m13-1 | migration 009: `finance.payments` + invoice status 拡張 | — |
| lnc-m13-2 | PaymentService（記録/取消/残高、TX + 行ロック） | m13-1 |
| lnc-m13-3 | routes/payments.ts（5 エンドポイント + RBAC） | m13-2 |
| lnc-m13-4 | Outbox イベント 4 種 + Webhook 配信統合 | m13-2 |
| lnc-m13-5 | 滞留検知ジョブ（`payment.overdue`） | m13-4 |
| lnc-m13-6 | ReportingService: AR エイジング + `/reports/accounts-receivable` | m13-2 |
| lnc-m13-7 | integration suite（+25〜30 checks） | m13-3..6 |
| lnc-m13-8 | OpenAPI / Swagger 更新（payments スキーマ） | m13-3 |

---

## 10. リスク / 留意

- **環境制約**: pnpm 破損・docker-compose は v1.29 限定（運用メモ参照）。migration 実行は既存 `infra/migrations/run.sh` を使用し、新規ツール導入を避ける。
- **金額精度**: 全て `NUMERIC(12,2)`。JS 側で float 演算しない（既存 Decimal 方針踏襲）。
- **後方互換**: invoice status CHECK 拡張は既存 'paid' データに無影響（追加のみ）。`partially_paid` は新規入金経由でのみ到達。
- **冪等性**: 入金 POST は idempotency-key 必須を推奨（二重振込記帳防止）。

---

## 次アクション候補
- 本設計をレビュー後、`lnc-m13-1`（migration 009）から着手
- projects-config.json に M13 タスク（lnc-m13-1〜8、未完了）を登録
