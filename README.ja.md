# Taskseq

[English](README.md)

Taskseqは、時間、Area、階層で作業を整理する個人用タスク管理Webアプリケーションです。Reactのsingle-page applicationとHono APIをCloudflare Workersで実行し、データをCloudflare D1へ保存します。

## 主な機能

- Inbox、任意のArea、階層化されたTask
- TodayとThis Week
- Start、Due、Recurring Task
- Tag、Title検索、再利用可能なView
- Taskの手動並べ替えとSubtree移動
- Trashの保持と復元
- 英語と日本語の表示言語
- production deploymentでのCloudflare Access認証

## 構成と主要技術

アプリケーションは`app/`以下の単一pnpm packageです。Cloudflare WorkersがReact SPAと`/api/v1/*`のHono APIを配信します。主な技術はReact、TypeScript、Vite、Hono、Cloudflare Workers Static Assets、D1、Tailwind CSS、Zod、Vitest、Biomeです。

## 必要な環境

- Node.js 24（repositoryでは`24.18.0`を固定）
- pnpm 11

## ローカル開発

```bash
git clone https://github.com/marmia/taskseq.git
cd taskseq/app
corepack enable
pnpm install --frozen-lockfile
pnpm exec wrangler d1 migrations apply DB --local
pnpm dev
```

local設定ではlocal D1を使用し、Cloudflare accountは必要ありません。credentialをtracked fileへ保存しないでください。`.dev.vars*`、`.env*`、Wranglerのlocal state、依存package、build outputはGitの管理対象外です。

## 検証

`app/`で標準検証を実行します。

```bash
pnpm check
```

lint、type check、Web test、Worker・D1 test、production buildを順番に実行します。

## Repository構成

| Path | 内容 |
| --- | --- |
| `app/src/web/` | React SPA |
| `app/src/worker/` | Hono Worker API |
| `app/src/domain/` | Domain typeとrule |
| `app/src/data/` | D1 data access |
| `app/src/shared/` | 共有API schema |
| `app/migrations/` | D1 migration |
| [`scripts/README.md`](scripts/README.md) | Database maintenance、deployment、専用test command |

## Contribution

不具合報告、機能提案、Pull RequestはこのPublic repositoryで受け付けます。このrepositoryは生成されたPublic snapshotであるため、Pull Requestは変更提案としてreviewし、`main`へ直接mergeしません。採用する変更はPrivate正本へ反映して検証し、後続のsnapshotで公開します。Public側のcommitには`Co-authored-by` trailerなどを使い、contributorのattributionを残します。

IssueやPull Requestにはcredential、Private deploymentの詳細、個人のTask data、その他の機密情報を記載しないでください。

## License

Taskseqは[MIT License](LICENSE)で公開します。
