---
title: "self-hosted runner の :latest タグがローカルキャッシュに固定されOS世代がズレる"
tags: [ci, docker, self-hosted-runner, github-actions]
severity: high
date: "2026-09-13"
---

## 症状

PR のCI（`integration` ジョブ）が `Install PostgreSQL 17, Redis, psql + jq` ステップで3回連続で同一原因で失敗した。

```
E: The repository 'https://apt.postgresql.org/pub/repos/apt focal-pgdg Release' does not have a Release file.
##[error]Process completed with exit code 100.
```

`ci.yml` は `runs-on: ${{ vars.GATE_RUNNER || 'ubuntu-latest' }}` で、org変数 `GATE_RUNNER` が `ci-pool` を指していた。

## 原因

`GATE_RUNNER=ci-pool` の実体は、dev-nodeeホスト上で systemd (`arc-runner.service`) が管理する docker-compose 単体の self-hosted runner（`/opt/arc-runner/compose.yml`、`myoung34/github-runner:latest`）だった。

`:latest` は可変タグだが、ローカルの docker イメージキャッシュは 2026-07-27 にpullされた古い版のまま固定されていた（`docker pull` を明示的に実行しない限り更新されない）。そのキャッシュは Ubuntu 20.04 (focal) ベースで、focal 向けの PostgreSQL 17 apt リポジトリはもう提供されていない。上流の `:latest` タグ自体は日々更新されていたが、ローカルキャッシュはそれを反映していなかった。

## 解決策

`compose.yml` のイメージを可変タグから固定タグに変更し、明示的に新しいイメージを pull してからサービスを再起動する。

```yaml
# before
image: myoung34/github-runner:latest
# after
image: myoung34/github-runner:ubuntu-noble
```

```bash
docker pull myoung34/github-runner:ubuntu-noble
sudo systemctl restart arc-runner.service
```

## 予防

- self-hosted runner を docker-compose/systemd で運用する場合、イメージは `:latest` のような可変タグではなく `ubuntu-noble` / `2.337.0-ubuntu-noble` のような具体的なタグで固定する。
- CI が「原因不明の apt/パッケージ関連エラー」で失敗したら、まず `gh api repos/<owner>/<repo>/actions/jobs/<id>` の `runner_name` / `labels` で実際にどの runner が処理したかを確認し、その runner の稼働形態（k8s ARC か、systemd/docker 単体か）とイメージの鮮度を疑う。org変数 `GATE_RUNNER` が指すラベルが「廃止されたはず」の値になっていないかも `gh variable list --org <org>` で確認する。
