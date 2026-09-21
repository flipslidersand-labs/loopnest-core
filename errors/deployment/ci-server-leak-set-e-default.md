---
title: "CIの set -e デフォルトで失敗したステップが SERVER_PID の kill をスキップし、プロセスが次ジョブに残留する"
tags: [ci, github-actions, self-hosted-runner, bash]
severity: high
date: "2026-09-21"
---

## 症状

self-hosted runner (`arc-minipc`) 上で `Run integration suite` ステップが
`Server already running.` を出力し、直前とは無関係なブランチのコードに対して
テストが実行されて大量に失敗する（issue #223）。

## 原因

`ci.yml` の `Smoke load test` / 旧版の各サーバー起動ステップは、
GitHub Actions の `run:` が既定で `bash --noprofile --norc -eo pipefail {0}`
（`set -e` 相当）で実行されることを考慮せず、以下のように書かれていた。

```bash
node apps/api/dist/src/server.js > /tmp/load-server.log 2>&1 &
SERVER_PID=$!
...
DURATION_S=5 CONCURRENCY=10 node tests/load/load.mjs   # ← これが失敗すると
kill $SERVER_PID 2>/dev/null || true                    # ← ここに到達しない
```

`node tests/load/load.mjs` が非0で終了すると `set -e` によりステップ全体が
即座に終了し、直前で `&` 起動したサーバープロセスが kill されないまま
self-hosted runner（GitHub-hosted と違い使い捨てVMではない）に残留する。
次のジョブが `curl http://localhost:3000/health` で「起動済み」と誤認し、
別ブランチのコードに対してテストしてしまう。

## 解決策

Rate limit ステップが既にやっていたパターン（`set +e` → 実行 → `kill` →
`set -e` 復帰 → `exit $EXIT`）を Smoke load test にも適用し、加えて
ジョブ末尾に `if: always()` の `fuser -k 3000/tcp` クリーンアップステップを
追加して、途中でジョブがキャンセルされた場合にも備えた（PR #251）。

```bash
set +e
DURATION_S=5 CONCURRENCY=10 node tests/load/load.mjs
EXIT=$?
set -e
kill $SERVER_PID 2>/dev/null || true
exit $EXIT
```

## 予防

- GitHub Actions の `run:` ステップは **既定で `set -e`**。バックグラウンド
  プロセスを起動して後段で明示的に `kill` するステップは、その kill 行の前に
  失敗し得るコマンドが無いか必ず確認する。
- self-hosted runner は使い捨てではないため、「このジョブのプロセスは
  必ず後始末される」という GitHub-hosted 前提のコードは通用しない。
  ジョブ末尾に `if: always()` の強制クリーンアップを一枚足すのが安全。
