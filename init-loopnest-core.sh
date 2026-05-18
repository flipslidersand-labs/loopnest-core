#!/bin/bash
set -e

echo "🚀 LoopNest Core 初期構築を開始します..."
echo ""

# Step 1: Git 初期化
echo "📦 STEP 1: Git リポジトリ初期化..."
git init
git config user.email "dev@loopnest.local"
git config user.name "LoopNest Dev"

# .gitignore
cat > .gitignore << 'EOF'
# Node
node_modules/
dist/
build/
*.log
.DS_Store

# Environment
.env
.env.local
.env.*.local

# IDE
.vscode/*
!.vscode/settings.json
!.vscode/extensions.json
.idea/

# Database
postgres-data/
redis-data/

# Test
coverage/
.nyc_output/

# Misc
*.tsbuildinfo
.turbo/
EOF

# LICENSE
cat > LICENSE << 'EOF'
MIT License

Copyright (c) 2025 LoopNest Dev

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
EOF

# README.md
cat > README.md << 'EOF'
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
EOF

git add .
git commit -m "chore: initial commit"
echo "✅ Git 初期化完了"
echo ""

# Step 2: pnpm workspace 初期化
echo "📦 STEP 2: pnpm workspace 初期化..."

cat > package.json << 'EOF'
{
  "name": "loopnest-core",
  "version": "0.1.0",
  "private": true,
  "description": "LoopNest Core / OmniTrade Data Platform",
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "type-check": "turbo run type-check",
    "migrate": "pnpm --filter @loopnest/migrations migrate",
    "db:reset": "docker compose down -v && docker compose up -d"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "turbo": "^2.0.0",
    "typescript": "^5.6.0",
    "prettier": "^3.3.0",
    "eslint": "^9.0.0"
  },
  "engines": {
    "node": ">=24.0.0",
    "pnpm": ">=9.0.0"
  },
  "packageManager": "pnpm@9.0.0"
}
EOF

cat > pnpm-workspace.yaml << 'EOF'
packages:
  - 'apps/*'
  - 'packages/*'
  - 'infra/migrations'
EOF

cat > turbo.json << 'EOF'
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.local"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "build/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "type-check": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"]
    }
  }
}
EOF

cat > .editorconfig << 'EOF'
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
EOF

echo "✅ Workspace 設定完了"
echo ""

# Step 3: ディレクトリ構造作成
echo "📂 STEP 3: ディレクトリ構造作成..."
mkdir -p apps/api
mkdir -p apps/mock-accounting-api
mkdir -p packages/bizcore-db
mkdir -p packages/shared-types
mkdir -p infra/migrations
mkdir -p infra/docker/postgres
mkdir -p infra/seed/static
mkdir -p infra/seed/scripts
mkdir -p docs/adr
mkdir -p docs/roadmap
mkdir -p docs/backlog
mkdir -p docs/design
mkdir -p docs/setup
mkdir -p env
echo "✅ ディレクトリ構造完了"
echo ""

# Step 4: Docker Compose 設定
echo "🐳 STEP 4: Docker Compose 設定..."
cat > compose.yml << 'EOF'
services:
  postgres:
    image: postgres:17-alpine
    container_name: loopnest-postgres
    environment:
      POSTGRES_USER: loopnest
      POSTGRES_PASSWORD: loopnest_dev_password
      POSTGRES_DB: omni_local
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./infra/docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U loopnest"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: valkey/valkey:8-alpine
    container_name: loopnest-redis
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres-data:
  redis-data:
EOF

cat > infra/docker/postgres/init.sql << 'EOF'
-- Create schemas
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS workflow;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS audit;

-- Grant permissions
GRANT ALL ON SCHEMA core TO loopnest;
GRANT ALL ON SCHEMA workflow TO loopnest;
GRANT ALL ON SCHEMA finance TO loopnest;
GRANT ALL ON SCHEMA audit TO loopnest;
EOF

cat > env/.env.local << 'EOF'
# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=loopnest
POSTGRES_PASSWORD=loopnest_dev_password
POSTGRES_DB=omni_local
DATABASE_URL=postgres://loopnest:loopnest_dev_password@localhost:5432/omni_local

# Redis (Valkey)
REDIS_HOST=localhost
REDIS_PORT=6379

# API
API_PORT=3000
NODE_ENV=development
EOF

echo "✅ Docker Compose 設定完了"
echo ""

# Step 5: pnpm install
echo "📦 STEP 5: 依存パッケージインストール..."
pnpm install --frozen-lockfile 2>&1 | tail -5
echo "✅ インストール完了"
echo ""

# Step 6: VSCode 設定
echo "⚙️ STEP 6: VSCode 設定..."
mkdir -p .vscode

cat > .vscode/settings.json << 'EOF'
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "files.associations": {
    "*.sql": "sql"
  }
}
EOF

cat > .vscode/extensions.json << 'EOF'
{
  "recommendations": [
    "esbenp.prettier-vscode",
    "dbaeumer.vscode-eslint",
    "mtxr.sqltools",
    "mtxr.sqltools-driver-pg",
    "redhat.vscode-yaml"
  ]
}
EOF

echo "✅ VSCode 設定完了"
echo ""

# Step 7: Git コミット
echo "📝 STEP 7: Git コミット..."
git add .
git commit -m "feat: setup Docker Compose, pnpm workspace, VSCode config" --quiet
echo "✅ Git コミット完了"
echo ""

# Step 8: Docker Compose 起動
echo "🐳 STEP 8: Docker Compose 起動..."
docker compose up -d
echo "⏳ PostgreSQL 起動待機中..."
sleep 3
docker compose ps
echo ""

# Step 9: 動作確認
echo "✅ STEP 9: 動作確認..."
echo ""

echo "📋 PostgreSQL スキーマ確認:"
docker compose exec -T postgres psql -U loopnest -d omni_local -c "\dn" | grep -E "core|workflow|finance|audit"
echo ""

echo "📋 Redis 接続確認:"
docker compose exec -T redis valkey-cli PING
echo ""

# 完了メッセージ
echo "🎉 ========================================="
echo "🎉 LoopNest Core 初期構築が完了しました！"
echo "🎉 ========================================="
echo ""
echo "📋 次のステップ:"
echo "  1. VSCode でプロジェクトを開く"
echo "  2. \`pnpm install\` を実行"
echo "  3. packages/bizcore-db をセットアップ"
echo "  4. apps/api を実装開始"
echo ""
echo "💡 ツール:"
echo "  - Docker: docker compose ps"
echo "  - PostgreSQL: docker compose exec postgres psql -U loopnest -d omni_local"
echo "  - Redis: docker compose exec redis valkey-cli"
echo ""
