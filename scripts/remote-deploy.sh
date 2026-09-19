#!/usr/bin/env bash

set -euo pipefail

script_dir=$(cd -- "$(dirname -- "$0")" && pwd -P)

if (( $# > 0 )); then
  if [[ $1 == "--help" && $# == 1 ]]; then
    cat <<'EOF'
Usage:
  scripts/remote-deploy.sh
  scripts/remote-deploy.sh --help

Runs the full production deployment after loading scripts/.env.remote safely.
This includes app checks, a production D1 backup, remote migrations, and Worker deployment.
EOF
    exit 0
  fi
  echo "Usage: $0 [--help]" >&2
  exit 2
fi

exec node "$script_dir/deployment/remote-deploy.mjs"
