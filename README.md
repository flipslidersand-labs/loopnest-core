# LoopNest Core

業務システム開発の自分専用 OS を作るプロジェクト。

## プロジェクト概要

架空企業 LoopNest Tech 株式会社の統合業務基盤を構築しながら、再利用可能なライブラリ群「BizCore Toolkit」を育てる。

## 構成

- M01: BtoB Quote-to-Billing 同期版 (12 週)
- M02: Outbox 非同期化 (1.5 ヶ月)
- M03: Failure & Performance & Data Generator (1.5 ヶ月)

## 開発環境

- Node.js 24
- PostgreSQL 17
- Redis (Valkey)
- Docker Compose

## セットアップ

```bash
pnpm install
docker compose up -d
pnpm migrate
pnpm dev
```
