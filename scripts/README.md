# Project scripts

The `scripts/` directory contains project-level database maintenance, production deployment, and dedicated maintenance tests. Run application install, development, and standard verification commands from `app/`.

## Structure

| Path | Purpose |
| --- | --- |
| `*.sh` | Stable local and remote command entrypoints |
| `database-maintenance/` | Database operation implementations, CLI adapters, JSON Schemas, and JSON examples |
| `database-maintenance-test/` | Maintenance test runner, case registry, D1 harnesses, and shared test support |
| `database-maintenance-tests/` | Unit, local, remote, load, and production read-only test cases plus SQL fixtures |
| `deployment/` | Full production deployment wrapper and its unit test |

The similarly named maintenance test directories have different roles. `database-maintenance-test/` provides the runner and reusable support. `database-maintenance-tests/` contains the cases and fixtures discovered by that runner.

## Database maintenance

Local and remote commands are separate entrypoints. Use `--help` to inspect a command before running it.

| Operation | Local | Remote |
| --- | --- | --- |
| Migration | `local-migration.sh` | `remote-migration.sh` |
| Reset | `local-reset.sh` | `remote-reset.sh` |
| Backup | `local-backup.sh` | `remote-backup.sh` |
| Restore | `local-restore.sh` | `remote-restore.sh` |
| JSON export | `local-export.sh` | `remote-export.sh` |
| JSON import | `local-import.sh` | `remote-import.sh` |
| JSON update | `local-update.sh` | `remote-update.sh` |

Configuration is loaded from ignored files under `scripts/`. Local commands use `.env.local`; remote commands use `.env.remote`. Test profiles use `.env.local-test` or `.env.remote-test` where applicable. These files can contain database identifiers, API tokens, and backup paths and must remain untracked.

JSON input formats are defined in `database-maintenance/schemas/`. Ready-to-edit examples are available in `database-maintenance/examples/`.

## Maintenance tests

Maintenance tests use Node's built-in test runner and are intentionally separate from `app/` verification. The default command runs unit cases without connecting to a database:

```bash
./scripts/database-maintenance-test.sh
```

Profiles that use a database or perform heavier work require explicit selection:

```bash
./scripts/database-maintenance-test.sh local
./scripts/database-maintenance-test.sh remote
./scripts/database-maintenance-test.sh all
./scripts/database-maintenance-test.sh load
./scripts/database-maintenance-test.sh production-readonly
```

`local` uses temporary local test databases. `remote` requires a dedicated remote test database. `load` runs local load cases. `production-readonly` reads production schema information and must be selected explicitly. Review the target and provide the corresponding ignored configuration before running any non-unit profile.

## Production deployment

The full production deployment entrypoint is:

```bash
./scripts/remote-deploy.sh --help
./scripts/remote-deploy.sh
```

It loads `.env.remote`, verifies the production database and required Cloudflare values, and then runs the application deployment flow. That flow includes application checks, a production D1 backup, remote migrations, and Worker deployment.

Run its unit test separately from the application and maintenance test gates:

```bash
node --test scripts/deployment/remote-deploy.test.mjs
```
