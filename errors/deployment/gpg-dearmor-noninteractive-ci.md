---
title: "CI の gpg --dearmor が tty 無し環境でハングして exit 2 になる"
tags: [ci, github-actions, apt, gpg]
severity: high
date: "2026-09-12"
---

## 症状

`ci.yml` の PostgreSQL 17 apt リポジトリ登録ステップで、以下のように毎回失敗していた。

```
gpg: cannot open '/dev/tty': No such device or address
curl: (23) Failure writing output to destination
##[error]Process completed with exit code 2.
```

master 上の全 PR で integration ジョブがこのステップで落ち、実際のコード変更内容とは無関係に CI が赤くなっていた。

## 原因

```bash
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  | sudo gpg --dearmor -o /usr/share/keyrings/postgresql.gpg
```

出力先の keyring ファイルが（runner イメージのキャッシュ等で）既に存在すると `gpg --dearmor` は上書き確認プロンプトを出そうとする。GitHub Actions runner には tty が無いため `/dev/tty` を開けずエラーになり、パイプ先の gpg が異常終了 → curl 側も `Failure writing output to destination` で失敗する。

## 解決策

`gpg --dearmor` に `--batch --yes` を付けて非対話化する。

```bash
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/postgresql.gpg
```

## 予防

CI 上で `gpg`（や他の対話確認を持つ CLI）をパイプで使うステップを書くときは、最初から `--batch --yes` 相当のフラグを付けておく。tty の無い環境でのみ顕在化するため、ローカル実行では気づきにくい。
