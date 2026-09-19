#!/usr/bin/env bash

set -euo pipefail

script_dir=$(cd -- "$(dirname -- "$0")" && pwd -P)

if (( $# != 1 )); then
  echo "Usage: $0 <tasks.json> | --help" >&2
  exit 2
fi

exec node "$script_dir/database-maintenance/import-cli.mjs" \
  --environment local \
  "$@"
