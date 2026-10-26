---
title: "integrationテストのstart_server()がself-hosted runner上で前ジョブの残存サーバーを誤検知・再利用する"
tags: [ci, self-hosted-runner, integration-test]
severity: high
date: "2026-09-13"
---

## 症状

PR #221 / #222 のCI（`integration`ジョブ）が3回連続で同一パターンで失敗した。

```
=== Discounts (M07) ===
（次のセクションへ即座に遷移、"Results:" 行が一切出ない）
```

`discounts.sh` / `quote_templates.sh` には既にERR trap（Issue #160対応）が入っているにもかかわらず、trapのメッセージすら出力されずスイートが無音で終了する。一部のケースではログに `Server already running.` が明示的に出ていた。

## 原因

`tests/integration/run-all.sh` の `start_server()` は次のロジックでAPIサーバー起動をスキップする:

```bash
start_server() {
  if curl -s -m 2 -o /dev/null "http://localhost:3000/health"; then
    echo "Server already running."
    return
  fi
  ...
}
```

GitHub-hosted runner（毎回使い捨てVM）では無害だが、org変数 `GATE_RUNNER` が self-hosted ARC runner（`arc-dev-pc`/`arc-minipc`、常駐ホスト）を指す運用下では、**前のジョブが正常終了せずポート3000にサーバープロセスが残っていると、今回チェックアウトしたブランチのコードではなく古いコードのサーバーに対してテストが走る**。スキーマ不一致・未知のエンドポイント挙動により、特定スイートだけが無音で落ちる。

## 解決策（未実施・Issue化済み: loopnest-core#223）

1. `start_server()` の「既に起動済みなら再利用」ロジックを撤廃し、self-hosted runner では毎回既存プロセスをkillしてから起動する
2. または `/health` にビルドSHAを含め、今回のチェックアウトと一致する場合のみ再利用する
3. ジョブ終了時（`if: always()`）に確実にサーバーをkillするクリーンアップステップを追加する

## 予防

self-hosted runnerでCIが「原因不明の無音失敗」を起こしたら、まず「前のジョブのプロセスが残っていないか」（`Server already running.`のようなログ、または`gh api .../jobs/<id>`の`runner_name`が使い回されている実行）を疑う。GitHub-hostedでは起きない挙動だと分かっていれば切り分けが早い。自分の変更に関係する特定のテストスイート（例: `e2e_workflow`）が毎回passしているかを個別に確認し、無関係な既知のCI基盤問題かを判断する材料にする。
