---
title: "Kysely の PostgresDialect で .stream() を使うには pg-cursor が必須（pg-query-stream ではない）"
tags: [kysely, postgres, streaming, typescript]
severity: high
date: "2026-09-12"
---

## 症状

請求書 CSV エクスポートをメモリ効率化するため `query.stream()` に切り替えたところ、統合テストで一部の行（直前に作成・更新した行）だけが CSV に出力されないという不可解な失敗が発生した。

```
✗ export: cancelled row present (expected: true, actual: false)
```

CSV レスポンスは `id,number,...` のヘッダー行だけが返り、データ行が 0 件だった。

## 原因

Kysely の `PostgresDialect` はデフォルトでは server-side cursor 実装を持っておらず、`.stream()` を呼ぶには dialect 設定に `cursor` ファクトリを明示的に渡す必要がある。渡していないと実行時に

```
Error: 'cursor' is not present in your postgres dialect config. It's required to make streaming work in postgres.
```

が投げられる。この例外は Express のレスポンスヘッダーを `res.write(header)` で送信済みの後に発生するため、クライアント側は「ヘッダーだけあってデータが無い」という一見テスト対象コードのロジックバグに見える壊れ方をする。ローカルでは `pg-query-stream` を追加すれば直ると誤解しがちだが、Kysely の PostgresDialect が要求するのは `pg-cursor` の `Cursor` クラスであって `pg-query-stream` ではない。

## 解決策

```ts
import { Pool } from 'pg';
import Cursor from 'pg-cursor';

export const kyselyDb = new Kysely<KyselyDatabase>({
  dialect: new PostgresDialect({ pool, cursor: Cursor }),
});
```

`pg-cursor` を `dependencies` に追加し、`PostgresDialect` のコンストラクタに `cursor: Cursor` を渡す。

加えて、Postgres のサーバーサイドカーソルはトランザクションの生存期間内でしか有効に動作しないため、`.stream()` を呼ぶクエリは `db.transaction().execute(async (trx) => { ... })` の中で実行すること。Kysely はトランザクションをコールバックスコープでしか公開しない（`db.startTransaction()` のような手動 begin/commit API が無い）ため、行を1件ずつ呼び出し元に渡したい場合は async generator ではなく「行ごとのコールバックを受け取る関数」として実装するとよい。

## 予防

Kysely で `.stream()` を導入するときは、必ず (1) `PostgresDialect` に `cursor: pg-cursor` を設定する、(2) クエリをトランザクション内で実行する、の両方をセットで行う。どちらか一方だけでは正しく動かない（前者を忘れると即例外、後者を忘れるとコネクションプール返却タイミングで行が欠落する）。
