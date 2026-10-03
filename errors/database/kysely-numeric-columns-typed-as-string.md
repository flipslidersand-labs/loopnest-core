---
title: "Kysely + node-postgres で NUMERIC 列を number 型で宣言すると、実装済みコードが軒並み型エラーになる"
tags: [kysely, postgres, typescript, numeric]
severity: medium
date: "2026-09-21"
---

## 症状

`packages/bizcore-db` の複数リポジトリ（Invoice/Payment/CreditNote/Installment/
RecurringContract/TaxRate/ExchangeRate）で `constructor(private db: any)` を
`Kysely<KyselyDatabase>` に直した途端、`.toString()` している insert/update と
`parseFloat(r.amount.toString())` している select の両方で「string は number に
代入できない」型エラーが多発した（issue #247）。

## 原因

PostgreSQL の `NUMERIC`/`DECIMAL` 列は、`pg` ドライバがカスタム型パーサーを
設定していない限り **JS の string として返る**（丸め誤差を避けるための仕様）。
このリポジトリのコードは元々それを正しく踏まえて書かれていた
（select 時は `parseFloat(...)`、insert 時は `.toString()`）が、
Kysely のテーブル型定義では単純に `amount: number` と宣言されていたため、
`db: any` で型検査そのものがスキップされていた間は矛盾が表面化しなかった。

## 解決策

該当列を Kysely の `ColumnType<SelectType, InsertType, UpdateType>` で
非対称に宣言し、実際の読み書きの型と一致させる。

```ts
import { ColumnType } from 'kysely';

export interface InvoiceTable {
  // SELECT では string、INSERT/UPDATE では string | number を許容
  discount_amount: ColumnType<string | null, string | number | null | undefined, string | number | null>;
  // ...
}
```

日付列（`DATE`）も同様に、コード側が `instanceof Date` チェックで
Date/string 両対応にしている箇所は `Date | string` で宣言する
（`pg` は `DATE` を JS の `Date` で返すが、insert 側は多くの箇所で
`YYYY-MM-DD` 文字列を直接渡している）。

## 予防

- 新しい Kysely テーブル型を書くときは、その列が `NUMERIC`/`DECIMAL` か
  マイグレーションSQLで必ず確認する。`number` と決め打ちしない。
- `constructor(private db: any)` のようなリポジトリは型検査が実質無効化
  されているだけで、実行時の挙動（`.toString()`/`parseFloat()`）自体は
  正しいことが多い。型を厳格化するときは「実装を直す」前に「型定義を
  実態に合わせる」方を先に疑う。
