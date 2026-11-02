---
title: "self-hosted runner で同時ジョブがシステム Postgres と dpkg 状態を共有し CI が間欠失敗する"
tags: [ci, self-hosted-runner, postgres, apt, concurrency]
severity: high
date: "2026-10-03"
---

## 症状

- 同一 PR の 2 run（push と pull_request、`gh api .../update-branch` でも同時発火）の片方だけが integration の `Apply migrations` で失敗:
  `psql: connection to server at "localhost" (::1), port 5432 failed: Connection refused`
- 別の時点では `Install PostgreSQL 17, Redis, psql + jq` が exit 100:
  `Could not execute systemctl` → `dpkg: error processing package openssh-server (--configure)`
  （"0 B of additional disk space" と出るので必要パッケージは導入済みで、無関係なパッケージが半端な状態で残っていた）
- master の schedule 実行は成功し続けるため、同時実行が少ないだけで常態的に潜在している。

## 原因

ci.yml の integration ジョブは GitHub-hosted の使い捨て VM 前提で、`apt-get install` + `sudo service postgresql start` + 固定 DB 名 `omni_local` を使う。self-hosted runner（常駐ホスト）では同時ジョブが同じシステム Postgres・同じ DB・同じ dpkg 状態を共有し、一方の `service postgresql start`/migration が他方の接続を切る。前ジョブが残した半端な dpkg 状態も次のジョブの apt を落とす。

## 解決策

PR #279 (#277):
- DB 名を `omni_ci_${{ github.run_id }}_${{ github.run_attempt }}` にし、`always()` で `DROP DATABASE ... WITH (FORCE)`
- `pg_isready` が通らないときだけ `service postgresql start`
- `apt-get -o DPkg::Lock::Timeout=600`、必要パッケージが `dpkg-query` で全て installed なら apt を丸ごとスキップ

## 予防

- 常駐 runner 上の CI は「ホスト共有状態」前提で設計する（DB 名・ポート・サービス起動・apt）。
- 未解決: Redis と port 3000 は共有のまま。既存の `fuser -k 3000/tcp` は他ジョブのサーバーを殺し得る。
- 多数の PR を一括で update-branch/rerun しない（3〜4 件ずつ）。
