# Deployment runbook — بحر المعاني

Target: a single DigitalOcean droplet (2 vCPU / 4 GB is enough for the pilot;
4 vCPU / 8 GB once the whole team is on it) running Ubuntu 24.04 + Docker.
Everything is containerised — no PHP, Node or Postgres installed on the host.

## 1. Topology

```
              ┌──────────────────────── droplet ────────────────────────┐
  browser ───▶│ nginx :80/:443                                          │
              │   /                → web        (Next.js standalone)    │
              │   /api /broadcasting /up /storage → app  (php-fpm)      │
              │   /app/ /apps/     → reverb     (websockets)            │
              │                                                          │
              │ queue  (queue:work)   scheduler (schedule:work)          │
              │ postgres  redis  meilisearch  gotenberg                  │
              └──────────────────────────────────────────────────────────┘
```

One public origin serves both the app and the API, so there is no CORS
configuration in production and one TLS certificate covers everything.

Four containers run the same API image with different commands. `restart:
unless-stopped` **is** the process supervision — a crashed worker or a killed
Reverb comes back by itself, no systemd units to maintain. Reverb has its own
container because it is a long-lived event loop, not a request handler.

## 2. First-time setup

```bash
# on the droplet, as root
apt update && apt install -y docker.io docker-compose-v2 git certbot
mkdir -p /var/www && cd /var/www
git clone <repo-url> bahr-almaaani && cd bahr-almaaani

cp .env.production.example .env
nano .env            # every key marked (إلزامي) must be filled

# APP_KEY — generate once and paste into .env
docker compose -f docker-compose.prod.yml run --rm app php artisan key:generate --show

chmod +x deploy.sh
```

Point the domain's A record at the droplet **before** requesting certificates.

### Database + first admin

```bash
docker compose -f docker-compose.prod.yml up -d postgres redis meilisearch gotenberg
docker compose -f docker-compose.prod.yml run --rm app php artisan migrate --force
docker compose -f docker-compose.prod.yml run --rm app php artisan db:seed --force
```

The seed creates roles, permissions, languages, settings and **one** admin from
`ADMIN_EMAIL` / `ADMIN_PASSWORD`. Demo accounts are local-only and never appear
in production. Change the admin password from inside the app after first login.

### TLS

The 443 server block is built in and **switches itself on when a certificate is
present**: `40-enable-tls.sh` runs at container boot and renders
`docker/nginx/tls.conf` into `/etc/nginx/tls/` only if `TLS_DOMAIN` is set *and*
`/etc/letsencrypt/live/$TLS_DOMAIN/fullchain.pem` is readable. No certificate
means plain HTTP and a normal start — never a container that refuses to boot.

Behind Cloudflare (or any proxy that already answers :443) the HTTP-01 challenge
is awkward, so issue over **DNS-01** instead — it needs no inbound port:

```bash
apt install -y python3-certbot-dns-cloudflare
printf 'dns_cloudflare_api_token = %s\n' "<token>" > /root/.secrets/cloudflare.ini
chmod 600 /root/.secrets/cloudflare.ini

certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
  --dns-cloudflare-propagation-seconds 30 \
  -d <domain> -d www.<domain>
```

The token needs only `Zone:DNS:Edit` + `Zone:Zone:Read` on that one zone. Then
set `TLS_DOMAIN=<domain>` in `.env` and redeploy. Certbot installs its own
renewal timer; add a deploy hook so nginx picks up a renewed certificate:

```bash
echo 'docker compose -f /var/www/bahr-almaani/docker-compose.prod.yml exec nginx nginx -s reload' \
  > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
```

With Cloudflare in front, set the zone's SSL mode to **Full (strict)** — the
origin now presents a real Let's Encrypt certificate, so there is no reason to
accept the weaker Flexible mode, which leaves the Cloudflare→origin hop in
cleartext.

Alternatively put Caddy or a load balancer in front and leave the nginx
container on HTTP (`TLS_DOMAIN` unset) — `trustProxies` is already set, so the
app reads `X-Forwarded-Proto` and generates https:// links either way.

## 3. Every deploy

```bash
ssh root@<droplet> '/var/www/bahr-almaaani/deploy.sh'
```

`deploy.sh` is idempotent and does, in order:

1. `git reset --hard origin/main`
2. rebuild the `app`, `web` and `nginx` images (the nginx image copies `public/`
   out of the app image, so both always match the same commit)
3. `migrate --force` in a throwaway container — a failed migration aborts the
   deploy with the old containers still serving
4. `package:discover` + `config/route/view/event:cache` into the shared
   `bootstrap-cache` volume, so all four roles boot from the same caches
5. `scout:sync-index-settings` + `scout:import` for Project and Client
6. `up -d` for app, queue, reverb, scheduler, web, nginx
7. `/up` and `/login` health probes

Rollback is `git reset --hard <sha> && ./deploy.sh` — images are rebuilt from
that commit. Migrations are not auto-reverted; check before rolling back across one.

## 4. Operating notes

| Task | Command |
|---|---|
| Tail one role | `docker compose -f docker-compose.prod.yml logs -f queue` |
| Restart the worker after a hotfix | `docker compose -f docker-compose.prod.yml up -d --force-recreate queue` |
| Failed jobs | `… run --rm app php artisan queue:failed` / `queue:retry all` |
| Rebuild the search index | `… run --rm app php artisan scout:import "App\Models\Project"` |
| Open a shell | `… exec app sh` |
| Database dump | `… exec postgres pg_dump -U bahr bahr > backup-$(date +%F).sql` |

**Uploads and generated files live in the `storage` volume** (source documents,
letterhead assets, exports, final files). Back it up with the database —
`docker run --rm -v bahr-almaaani-prod_storage:/data -v $PWD:/out alpine tar czf /out/storage-$(date +%F).tgz /data`.

Mail is a real SMTP provider in production; Mailpit is dev-only and is not part
of this compose file. `MAIL_SCHEME` accepts only `smtp` (587, STARTTLS) or
`smtps` (465) — `tls`/`ssl` fail every send with an UnsupportedSchemeException.

Laravel Horizon is installed as a dependency but not configured; the queue is
supervised by the `queue` container instead. Its dashboard route denies access
outside `local`, so nothing is exposed.

## 5. Health checks

| Endpoint | Expect |
|---|---|
| `GET /up` | 200, Laravel health |
| `GET /login` | 200, Next.js |
| `POST /api/v1/auth/login` | 200 + token |
| websocket `/app/{REVERB_APP_KEY}` | `connection_established` frame |

`web/ops-prod-smoke.mjs` checks all four in a real browser:

```bash
cd web && BASE=https://<domain> EMAIL=… PASSWORD=… node ops-prod-smoke.mjs
```

## 6. Verified

This stack was brought up end-to-end locally (`HTTP_PORT=8081`) before first
deploy: migrations, seed, config caches, all ten containers healthy, dashboard
rendered through nginx for a logged-in admin, websocket upgraded to Reverb with
a `connection_established` frame, an xlsx export processed by the queue worker,
the scheduler running `projects:scan-deadlines`, `scout:import` against
Meilisearch, and a report-ready mail delivered over SMTP — zero console errors.
