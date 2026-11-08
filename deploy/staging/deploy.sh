#!/usr/bin/env bash
# Runs ON the staging VM (piped over SSH by .github/workflows/deploy-staging.yml).
# Expects GHCR_USER, GHCR_TOKEN and API_IMAGE in the environment.
set -euo pipefail

cd ~/zenlot-staging
test -f .env.staging || { echo "~/zenlot-staging/.env.staging is missing" >&2; exit 1; }

printf '%s\n' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin

# Record the deployed tag so later SSH sessions can run compose commands (logs, ps, down)
# without exporting API_IMAGE by hand.
printf 'API_IMAGE=%s\n' "$API_IMAGE" > .api-image.env

dc="docker compose -f docker-compose.staging.yml --env-file .env.staging --env-file .api-image.env"
$dc pull api
$dc up -d --remove-orphans

docker logout ghcr.io

# Every build is tagged with its commit SHA, so old API images are tagged (not dangling) and
# would pile up on the 30 GB disk. `docker images` lists newest first: keep the 3 newest
# (running + 2 for rollback) and remove the rest. In-use images refuse to be removed; ignore that.
repo="${API_IMAGE%:*}"
docker images "$repo" --format '{{.Repository}}:{{.Tag}}' | tail -n +4 | xargs -r -n1 docker rmi || true
docker image prune -f
