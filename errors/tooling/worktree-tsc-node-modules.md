---
title: "worktree 内の tsc が node_modules を参照できず大量の TS7016 が出る"
tags: [worktree, typescript, npm-workspace]
severity: low
date: "2026-09-07"
---

## 症状

`npx tsc --noEmit` を worktree (`.wt/feat-xx/apps/api`) で実行すると
`TS7016: Could not find a declaration file for module 'express'` が 100+ 件出る。
一方 monorepo ルート (`apps/api`) では同じコマンドで同数のエラーが出る。

## 原因

npm workspaces の node_modules はモノレポルート (`/home/dev-nodee/projects/loopnest-core/`)
にあるが、git worktree は別ディレクトリ (`.wt/feat-xx/`) に展開されるため
`../../node_modules` の解決パスがずれる。

## 解決策

1. ベースライン比較: `main` と worktree で `grep -c "error TS"` して差分だけを確認する
2. 新規ファイルの固有エラーのみチェック (`grep "portal\|jwt\|auth"` 等でフィルタ)
3. 本物の型チェックは `npm install && npx tsc --noEmit` を monorepo ルートで実行するか CI に委ねる

## 予防

worktree で型チェックするときは「main との差分エラー数」を基準にする。
pre-existing の TS7016/TS2307 は無視してよい（CI が正しく判定する）。
