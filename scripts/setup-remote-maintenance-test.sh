#!/usr/bin/env bash

set -euo pipefail

script_dir=$(cd -- "$(dirname -- "$0")" && pwd -P)
exec node "$script_dir/database-maintenance-test/setup-remote-test.mjs" "$@"
