---
title: "ARC linux-general runner に Docker socket がなく services: が起動しない"
tags: [github-actions, arc, docker, ci]
severity: high
date: "2026-09-04"
---

## 症状

`services:` ブロック（postgres/valkey）を持つジョブが ARC self-hosted runner (`linux-general` scale set) で
"failed to connect to the docker API at unix:///var/run/docker.sock" で即死する。
"Initialize containers" ステップが失敗しジョブ全体が失敗する。

## 原因

ARC の runner pod は DinD（Docker-in-Docker）を有効化しないとホスト Docker daemon にアクセスできない。
`linux-general` scale set はデフォルトで DinD 未設定のため Docker socket が存在しない。

## 解決策

`services:` コンテナを使うジョブは `runs-on: ubuntu-latest`（GitHub-hosted）に固定する。

```yaml
integration:
  # Pinned to GitHub-hosted: this job needs Docker service containers
  # (ARC linux-general has no Docker socket)
  runs-on: ubuntu-latest
  services:
    postgres: ...
```

ARC 側での恒久対策は DinD を enable する（loopnest-core Issue #39）。

## 予防

`services:` を使うジョブを新設するとき、`runs-on` が self-hosted runner になっていないか確認する。
