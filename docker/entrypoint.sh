#!/bin/sh
set -eu

if [ "${RUN_DB_MIGRATIONS:-false}" = "true" ]; then
  echo "Running prisma migrate deploy..."
  ./node_modules/.bin/prisma migrate deploy --config prisma/prisma.config.ts
fi

exec "$@"
