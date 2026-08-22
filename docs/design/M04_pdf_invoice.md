# M04 設計: PDF 請求書生成

**ステータス**: 完了
**実装日**: 2026-08-22
**前提マイルストーン**: M01 完了済み

---

## 1. 概要

`GET /api/invoices/:id/pdf` エンドポイントを追加し、請求書データから A4 PDF を動的生成してダウンロードさせる。

---

## 2. スコープ

### In scope
- `PdfService` — pdfkit で PDF を生成するサービス層
- `InvoiceRepository.findWithItems` — 請求書 + 明細 + 商品名を JOIN で取得
- `GET /api/invoices/:id/pdf` ルート
- 日本語ビジネス請求書レイアウト（小計 / 消費税 10% / 合計）
- PAID スタンプ（`status === 'paid'` の場合）
- 統合テスト `pdf_invoice.sh`

### Out of scope
- PDF 永続化 / S3 保存（オンデマンド生成のみ）
- カスタムフォント（日本語フォント埋め込みは将来課題）
- 見積書 PDF（M04b 候補）
- メール添付送信（M08 候補）

---

## 3. アーキテクチャ

```
GET /api/invoices/:id/pdf
  └─ invoiceRoutes(repos)
       └─ PdfService.generateInvoicePdf(id)
            ├─ repos.invoices.findWithItems(id)   ← invoice + items + product name
            ├─ repos.customers.findById(customerId)
            └─ repos.organizations.findAll()[0]   ← 発行元情報
```

`InvoiceRepository.findWithItems` は Kysely で `finance.invoice_items JOIN core.products` を実行し、`InvoiceWithItems` 型を返す。PDF は Buffer として返し、ルートが `Content-Type: application/pdf` でストリームする。

---

## 4. API

| Method | Path | 説明 |
|--------|------|------|
| `GET` | `/api/invoices/:id/pdf` | 指定 ID の請求書を PDF でダウンロード |

**Response headers**
```
Content-Type: application/pdf
Content-Disposition: attachment; filename="invoice-<id>.pdf"
Content-Length: <bytes>
```

**Error cases**
- `404 NOT_FOUND` — 指定 ID の請求書が存在しない

---

## 5. PDF レイアウト

```
┌─────────────────────────────────┐
│           請求書                  │  ← タイトル (24pt)
│ 請求書番号: INV-202608-000001    │
│ 発行日: 2026年8月22日            │
├──────────────┬──────────────────┤
│ 請求先        │ 発行元           │
│ ソフトバンク  │ LoopNest Tech 株式会社│
│ 東京都港区... │ 登録番号: T...   │
├──────────────┴──────────────────┤
│ 品目       数量  単価     金額   │
│ ──────────────────────────────  │
│ ERP Enterprise  1  ¥50,000,000  ¥50,000,000 │
│ CRM Pro         2  ¥30,000,000  ¥60,000,000 │
│ ──────────────────────────────  │
│              小計    ¥110,000,000 │
│              消費税(10%)¥11,000,000│
│              ══════════════════ │
│              合計金額 ¥121,000,000│
└─────────────────────────────────┘
```

---

## 6. 依存ライブラリ

| パッケージ | バージョン | 用途 |
|---|---|---|
| `pdfkit` | ^0.19.1 | PDF 生成 |
| `@types/pdfkit` | ^0.17.6 | TypeScript 型定義 |

---

## 7. 将来拡張

- **M04b**: 見積書 PDF (`GET /api/quotes/:id/pdf`)
- **M08**: 請求書発行時にメールへ PDF 添付
- カスタムフォント埋め込み（日本語文字の完全サポート）
- PDF テンプレートのカスタマイズ（会社ロゴ等）
