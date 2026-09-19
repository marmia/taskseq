#!/usr/bin/env bash

set -euo pipefail

script_dir=$(cd -- "$(dirname -- "$0")" && pwd -P)

if (( $# > 1 )); then
  echo "Usage: $0 [--help]" >&2
  exit 2
fi
if (( $# == 1 )) && [[ "$1" != "--help" ]]; then
  echo "Usage: $0 [--help]" >&2
  exit 2
fi

exec node "$script_dir/database-maintenance/backup-cli.mjs" \
  --operation backup \
  --environment remote \
  "$@"
