#!/bin/sh
set -eu

if [ "${1:-}" = "-c" ] && [ "${2:-}" = "husky" ]; then
  node scripts/finalize-stale-economy-tests.mjs
fi

exec /bin/sh "$@"
