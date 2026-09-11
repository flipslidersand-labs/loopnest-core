---
title: "複数PRが tests/integration/run-all.sh の同じ env 変数ブロックを編集して rebase 時に毎回コンフリクトする"
tags: [tooling, git, ci, bash]
severity: low
date: "2026-09-11"
---

## 症状

`tests/integration/run-all.sh` の `start_server()` 内、`node apps/api/dist/src/server.js`
を起動する直前の複数行にわたる env 変数の並び（`EVENT_WORKER_INTERVAL_MS=...`,
`RATE_LIMIT_WORKFLOW_MAX=...` 等）に対して、複数のPRがそれぞれ自分のテスト用
env（例: `RECURRING_SCAN_INTERVAL_MS`, `OVERDUE_SCAN_INTERVAL_MS`）を1行追加する形で
変更している。片方をマージ後、もう片方を `git rebase origin/master` すると
同じ箇所で `CONFLICT (content): Merge conflict in tests/integration/run-all.sh` になる。

## 原因

各PRが「直前の行の末尾」を anchor にした diff（3行コンテキストの unified diff）を
生成するため、隣接する行に新しい変数を挿入するスタイルが被ると、
git の3-wayマージが自動解決できない。ロジック上は「両方の行を残せばよい」だけの
衝突（同一目的の独立した追加）なので、内容の対立ではない。

## 解決策

```bash
git rebase origin/master
# CONFLICT (content): Merge conflict in tests/integration/run-all.sh
```

コンフリクトマーカーの中身を見て、削除された行がなく両方とも `KEY="${KEY:-N}" \`
形式の追加だけであれば、単純に両方の行を残して解決する:

```diff
-<<<<<<< HEAD
-  RECURRING_SCAN_INTERVAL_MS="${RECURRING_SCAN_INTERVAL_MS:-3000}" \
-=======
-  OVERDUE_SCAN_INTERVAL_MS="${OVERDUE_SCAN_INTERVAL_MS:-3000}" \
->>>>>>> <commit> (...)
+  RECURRING_SCAN_INTERVAL_MS="${RECURRING_SCAN_INTERVAL_MS:-3000}" \
+  OVERDUE_SCAN_INTERVAL_MS="${OVERDUE_SCAN_INTERVAL_MS:-3000}" \
```

`git add tests/integration/run-all.sh && git rebase --continue` で完了。
`SUITES=(...)` 配列に新しいスイート名を追加するPR同士でも同様のパターンが起きうる
（こちらも両方の要素を残すだけで解決できることが多い）。

## 予防

このリポジトリでは並行セッション/並行PRが同じissueキューを消化する運用が
常態化している（[[project_loopnest_core]] 参照）。`run-all.sh` の
env変数ブロックや `SUITES=(...)` 配列を編集するPRを作る際は、
マージ前に必ず origin/master に対して rebase し、コンフリクトが
「両方残せば解決」する単純なものであることを確認してから push し直す。
