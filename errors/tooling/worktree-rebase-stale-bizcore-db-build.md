---
title: "worktree で master を rebase した後、bizcore-db の古い dist を参照して型エラー・依存漏れが出る"
tags: [tooling, pnpm, worktree, typescript, kysely]
severity: medium
date: "2026-09-11"
---

## 症状

`git rebase origin/master` 後の worktree で `apps/api` を `pnpm run type-check` すると、
rebase 前には無かった型エラーが大量に出る（例: `Property 'lockDue' does not exist on
type 'RecurringContractRepository'`、`Expected 1 arguments, but got 2`）。
さらに `packages/bizcore-db` 側の `tsc` ビルド自体が
`Cannot find module 'pg-cursor' or its corresponding type declarations` で失敗する。

## 原因

- `apps/api` は `@loopnest/bizcore-db` を **ビルド済み `dist/`** 経由で import する
  （ソースを直接見ない）。rebase で取り込んだ master 側のコミットが
  `packages/bizcore-db/src` に新しいメソッド・シグネチャ変更を加えていても、
  rebase 前にビルドした古い `dist/` がそのまま残っていると apps/api 側の型チェックは
  古いAPIを見続け、実際には存在するメソッドが「無い」と誤検出される。
- 同様に、rebase で取り込んだ他PRの変更が `packages/bizcore-db/package.json` に
  新しい依存（例: CSV export ストリーミング用の `pg-cursor`）を追加していても、
  `pnpm install --frozen-lockfile` を再実行しないと node_modules に反映されない。

## 解決策

```bash
# 1. rebase 後は依存を再解決
pnpm install --frozen-lockfile

# 2. bizcore-db を明示的に再ビルド（apps/api の型チェックが参照する dist を更新）
cd packages/bizcore-db && pnpm exec tsc

# 3. apps/api を型チェック
cd ../../apps/api && pnpm run type-check
```

## 予防

worktree で他PRとの rebase/マージを行った直後は、`pnpm run type-check` の結果を
鵜呑みにする前に上記3手順（install → bizcore-db再ビルド → 型チェック）を通す。
`errors/tooling/worktree-tsc-node-modules.md` の「masterとの差分エラー数で判定する」
という方針と組み合わせる場合も、比較対象の master 側 worktree で同様に
bizcore-db を明示ビルドしてから比較しないと、片方だけ古い dist のままで
誤って大差があるように見える（実測: 未ビルド側は無関係な TS2307 が約75件多く出た）。
