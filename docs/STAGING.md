# Staging environment

A single Google Cloud **e2-micro** (Always Free) VM runs the API, Redis, Mailpit and Caddy via
`docker-compose.staging.yml`. The database is **hosted Prisma Postgres** (no local Postgres). Pushes to `dev` deploy it automatically
(`.github/workflows/deploy-staging.yml`). The mobile app repo's Maestro workflow
(`zenlot/.github/workflows/maestro-e2e.yml`) tests against it.

Nothing here touches production: separate VM, database, JWT secrets and API keys.

## Database

`DATABASE_URL` in `.env.staging` is the Prisma Postgres connection string, the same
`prisma+postgres://...` value you keep as `DEV_PRISMA_DB` in `.env.dev`. The repo's own
`scripts/migrate-prod.ts` already runs `prisma migrate deploy` with that format, and the API
accepts it at runtime (Accelerate). A direct `postgres://` URL would work too.

Put it only in `~/zenlot-staging/.env.staging` on the VM (`chmod 600`). Never commit it or paste it
into GitHub variables or chat.

Staging uses the existing Prisma Postgres **dev** database. Day-to-day development runs against a
local database, so the dev database is effectively dedicated to staging. Keep it that way:

- Don't point local `prisma migrate dev` / `db:dev` at it. Staging applies migrations with
  `migrate deploy` on every deploy, and `migrate dev` against the same database can report drift.
- Its data is disposable: Maestro runs add `maestro-user.*@anawebs.com` accounts, trades and journals.
- Some Prisma Postgres plans meter by operations; PR smoke runs plus nightly full runs add up.

## Free-tier limits to respect

Verify these on Google's Always Free page before relying on them; they can change.

- e2-micro (2 shared vCPU, **1 GB RAM**) in `us-west1`, `us-central1` or `us-east1` only.
- Boot disk must be **standard persistent disk** (`pd-standard`), 30 GB or less.
- 1 GB/month free egress from North America. Our traffic (API responses, Caddy certificate
  renewals) is tiny; image pulls are ingress and free.
- The external IPv4 address is probably **not** free (about US$3-4/month). A billing account with
  a card is required. Set a budget alert (e.g. US$5) so surprises are visible.
- 1 GB RAM is tight even without Postgres. The compose file caps each service's memory and the VM
  needs swap (step 3). Keep Redis local: BullMQ polls too often for a free hosted Redis quota.

## One-time setup

### 1. Create the VM

Do this yourself: it needs your Google account, a billing account and the `gcloud` CLI
(`brew install --cask google-cloud-sdk`, then `gcloud auth login`).

```bash
gcloud projects create zenlot-staging-<suffix>            # or reuse a project
gcloud config set project zenlot-staging-<suffix>
# link a billing account in the console, then:
gcloud services enable compute.googleapis.com

gcloud compute addresses create zenlot-staging-ip --region=us-central1

gcloud compute instances create zenlot-staging \
  --zone=us-central1-a --machine-type=e2-micro \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-standard \
  --address=zenlot-staging-ip --tags=zenlot-staging-web

gcloud compute firewall-rules create zenlot-staging-web \
  --allow=tcp:80,tcp:443 --target-tags=zenlot-staging-web

gcloud compute addresses describe zenlot-staging-ip --region=us-central1 --format='value(address)'
```

SSH (port 22) is already allowed by the default network's `default-allow-ssh` rule.

### 2. DNS

Add an `A` record: `staging-api.zenlot.net` -> the VM's IP (printed above). Caddy gets the TLS
certificate automatically once DNS resolves and ports 80/443 are open.

### 3. Prepare the VM

```bash
gcloud compute ssh zenlot-staging --zone=us-central1-a

# Swap: required on 1 GB of RAM (Prisma migrate + image pulls spike memory)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Docker
curl -fsSL https://get.docker.com | sudo sh

# Dedicated deploy user (not managed by GCP's guest agent, so its authorized_keys is left alone)
sudo useradd -m -s /bin/bash -G docker deploy
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
sudo -u deploy mkdir -p /home/deploy/zenlot-staging
```

Create `/home/deploy/zenlot-staging/.env.staging` from `deploy/staging/.env.staging.example`
(generate secrets with `openssl rand -base64 48`; use fresh values, never production's; set
`DATABASE_URL` as described under Database):

```bash
sudo -u deploy nano /home/deploy/zenlot-staging/.env.staging
sudo chmod 600 /home/deploy/zenlot-staging/.env.staging
```

### 4. A deploy SSH key

On your Mac:

```bash
ssh-keygen -t ed25519 -f staging_deploy -N '' -C zenlot-staging-deploy
# install the public key for the deploy user:
gcloud compute ssh zenlot-staging --zone=us-central1-a --command \
  "echo '$(cat staging_deploy.pub)' | sudo tee -a /home/deploy/.ssh/authorized_keys >/dev/null && sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys && sudo chmod 600 /home/deploy/.ssh/authorized_keys"
ssh-keyscan -t ed25519 <vm-ip>        # -> STAGING_SSH_KNOWN_HOSTS
ssh -i staging_deploy deploy@<vm-ip> docker ps    # sanity check
```

Delete the private key from your machine once it is stored as a GitHub secret.

### 5. GitHub (`zenlot-server` repo)

Create an environment named **staging** (Settings -> Environments) with:

| Kind | Name | Value |
|---|---|---|
| secret | `STAGING_SSH_HOST` | VM IP |
| secret | `STAGING_SSH_USER` | `deploy` |
| secret | `STAGING_SSH_KEY` | contents of the private `staging_deploy` key |
| secret | `STAGING_SSH_KNOWN_HOSTS` | the `ssh-keyscan` line |
| variable | `STAGING_URL` | `https://staging-api.zenlot.net` |

Then run **deploy-staging** from the Actions tab (or push to `dev`). The first deploy is slow
(throttled CPU: image pull + Prisma migrations against the hosted database, `RUN_DB_MIGRATIONS=true`); the workflow waits up
to 8 minutes for `GET /health` to return 200.

### 6. GitHub (`zenlot` app repo)

Repository **variables** (Settings -> Secrets and variables -> Actions -> Variables):

| Variable | Value |
|---|---|
| `E2E_API_URL` | `https://staging-api.zenlot.net` (required: the workflow fails if unset or if it is a production host) |
| `E2E_NIGHTLY_REF` | optional, branch the nightly run tests (default `dev`) |
| `E2E_PR_RUN_IOS` | optional, `true` to also run iOS smoke on PRs (macOS minutes are billed at 10x on private repos) |

## Operating it

- Compose commands: each deploy records the running image tag in `~/zenlot-staging/.api-image.env`,
  so on the VM use `cd ~/zenlot-staging` and
  `docker compose -f docker-compose.staging.yml --env-file .env.staging --env-file .api-image.env <command>`
  (commands below abbreviate this as `docker compose ...`). Deploys keep the 3 newest API images on disk.
- Logs: `ssh deploy@<ip> 'cd ~/zenlot-staging && docker compose -f docker-compose.staging.yml --env-file .env.staging --env-file .api-image.env logs -f api'`
- Memory check: `ssh deploy@<ip> 'free -m && docker stats --no-stream'`. Repeated `Killed`/restarts of
  `api` or `redis` means it is out of memory.
- Captured email (welcome / reset mails land here, nothing is delivered externally):
  `ssh -i staging_deploy -L 8025:localhost:8025 deploy@<ip>`, then open http://localhost:8025.
- Reset all data: reset the hosted staging database (e.g. `prisma migrate reset` with
  `DATABASE_URL` set to the **staging** URL, double-checking it is not dev or production), then redeploy.
- E2E flows create `maestro-user.*@anawebs.com` accounts that accumulate. Reset the database
  occasionally, or add a cleanup job later.
- Nightly E2E runs and PR smoke runs hit this one small VM, so expect slower responses than
  production; if flows time out, raise `EXPO_PUBLIC_API_TIMEOUT_MS` before suspecting the app.
