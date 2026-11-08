#!/usr/bin/env bash
# Runs ON the staging VM (piped over SSH by .github/workflows/deploy-staging.yml).
# Expects GHCR_USER, GHCR_TOKEN and API_IMAGE in the environment.
set -euo pipefail

cd ~/zenlot-staging
test -f .env.staging || { echo "~/zenlot-staging/.env.staging is missing" >&2; exit 1; }

printf '%s\n' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin

export API_IMAGE
dc="docker compose -f docker-compose.staging.yml --env-file .env.staging"
$dc pull api
$dc up -d --remove-orphans

docker logout ghcr.io
docker image prune -f
