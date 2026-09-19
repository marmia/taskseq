# Taskseq

[日本語](README.ja.md)

Taskseq is a personal task management web application for organizing work by time, area, and hierarchy. It runs as a React single-page application and a Hono API on Cloudflare Workers, with data stored in Cloudflare D1.

## Features

- Inbox and custom areas with hierarchical tasks
- Today and This Week views
- Start dates, due dates, and recurring tasks
- Tags, title search, and reusable custom views
- Manual task ordering and subtree moves
- Trash retention and restoration
- English and Japanese display languages
- Cloudflare Access authentication for production deployments

## Architecture and technology

The application is a single pnpm package under `app/`. Cloudflare Workers serves both the React SPA and the `/api/v1/*` Hono API. The main technologies are React, TypeScript, Vite, Hono, Cloudflare Workers Static Assets, D1, Tailwind CSS, Zod, Vitest, and Biome.

## Requirements

- Node.js 24 (`24.18.0` is pinned in the repository)
- pnpm 11

## Local development

```bash
git clone https://github.com/marmia/taskseq.git
cd taskseq/app
corepack enable
pnpm install --frozen-lockfile
pnpm exec wrangler d1 migrations apply DB --local
pnpm dev
```

The local configuration uses a local D1 database and does not require a Cloudflare account. Do not place credentials in tracked files. `.dev.vars*`, `.env*`, local Wrangler state, dependencies, and build output are ignored by Git.

## Verification

Run the standard verification gate from `app/`:

```bash
pnpm check
```

It runs linting, type checking, web tests, Worker and D1 tests, and the production build in sequence.

## Repository layout

| Path | Contents |
| --- | --- |
| `app/src/web/` | React SPA |
| `app/src/worker/` | Hono Worker API |
| `app/src/domain/` | Domain types and rules |
| `app/src/data/` | D1 data access |
| `app/src/shared/` | Shared API schemas |
| `app/migrations/` | D1 migrations |
| [`scripts/README.md`](scripts/README.md) | Database maintenance, deployment, and dedicated test commands |

## Contributing

Bug reports, feature requests, and pull requests are welcome through this public repository. This repository is a generated public snapshot, so pull requests are reviewed as proposals and are not merged directly into its `main` branch. Accepted changes are applied to the private canonical repository, verified there, and published in a later snapshot. Public commits preserve contributor attribution, for example with a `Co-authored-by` trailer.

Do not include credentials, private deployment details, personal task data, or other sensitive information in issues or pull requests.

## License

Taskseq is licensed under the [MIT License](LICENSE).
