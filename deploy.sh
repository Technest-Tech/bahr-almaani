#!/usr/bin/env bash
#
# Bahr Al-Maaani redeploy — pull main, rebuild the images, migrate, restart.
# Idempotent; safe to re-run. Run as root on the droplet:
#
#   ssh root@<droplet> '/var/www/bahr-almaaani/deploy.sh'
#
# First-time setup and the TLS runbook live in docs/DEPLOYMENT.md.
set -euo pipefail

APP=${APP_DIR:-/var/www/bahr-almaaani}
COMPOSE="docker compose -f $APP/docker-compose.prod.yml"
BRANCH=${DEPLOY_BRANCH:-main}

cd "$APP"

if [[ ! -f .env ]]; then
    echo "!! $APP/.env is missing — copy .env.production.example and fill it in first." >&2
    exit 1
fi

echo "==> git pull ($BRANCH)"
git fetch origin
git reset --hard "origin/$BRANCH"

echo "==> build images"
# The API image is built twice on purpose: the nginx target copies public/ out
# of the app target, so both stay in step with the same commit.
$COMPOSE build --pull app web nginx

echo "==> backing services"
$COMPOSE up -d postgres redis meilisearch gotenberg

echo "==> migrate"
# --force: never prompt. Migrations run in one container, before the new code
# starts serving, so a failed migration leaves the old containers running.
$COMPOSE run --rm app php artisan migrate --force

echo "==> caches"
# bootstrap/cache is a shared volume, so these survive the throwaway container
# and every role (fpm, queue, reverb, scheduler) boots from the same caches.
# package:discover first: the volume may still hold the previous image's manifest.
$COMPOSE run --rm app sh -lc '
    php artisan package:discover --ansi &&
    php artisan config:cache &&
    php artisan route:cache &&
    php artisan view:cache &&
    php artisan event:cache
'

echo "==> search index"
# Idempotent: re-imports the searchable documents for the two indexed models.
$COMPOSE run --rm app sh -lc '
    php artisan scout:sync-index-settings || true
    php artisan scout:import "App\Models\Project"
    php artisan scout:import "App\Models\Client"
'

echo "==> restart app processes"
# Recreate every role so php-fpm, the worker, Reverb and the scheduler all pick
# up the new image. The worker gets its stop_grace_period to drain in-flight jobs.
$COMPOSE up -d --remove-orphans app queue reverb scheduler web nginx

echo "==> prune old images"
docker image prune -f >/dev/null || true

echo "==> health"
sleep 5
$COMPOSE ps
APP_URL=$(grep -E '^APP_URL=' .env | cut -d= -f2- | tr -d '"' | sed 's:/*$::')
curl -fsS -o /dev/null -w "  api  /up      -> %{http_code}\n" "$APP_URL/up" || echo "  api  /up      -> FAILED"
curl -fsS -o /dev/null -w "  web  /login   -> %{http_code}\n" "$APP_URL/login" || echo "  web  /login   -> FAILED"

echo "==> done"
