#!/bin/sh
# Shared container bootstrap. Every role (fpm, queue, reverb, scheduler) runs this
# first, then execs its own command.
set -e

# Storage is a named volume, so its ownership is not what the image baked in.
if [ "$(id -u)" = "0" ]; then
    mkdir -p storage/framework/cache storage/framework/sessions storage/framework/views \
             storage/logs storage/app/private
    chown -R www-data:www-data storage bootstrap/cache 2>/dev/null || true
fi

# Wait for Postgres before doing anything that touches it — compose's
# depends_on only guarantees the container started, not that it accepts queries.
if [ -n "${DB_HOST:-}" ] && [ "${WAIT_FOR_DB:-1}" = "1" ]; then
    tries=0
    until php -r "new PDO('pgsql:host='.getenv('DB_HOST').';port='.(getenv('DB_PORT') ?: 5432).';dbname='.getenv('DB_DATABASE'), getenv('DB_USERNAME'), getenv('DB_PASSWORD'));" 2>/dev/null; do
        tries=$((tries + 1))
        if [ "$tries" -ge 30 ]; then
            echo "entrypoint: postgres never became reachable at ${DB_HOST}:${DB_PORT:-5432}" >&2
            exit 1
        fi
        echo "entrypoint: waiting for postgres (${tries}/30)…"
        sleep 2
    done
fi

# Drop to www-data for everything except php-fpm.
#
# php-fpm's master must stay root — it forks its workers as www-data itself
# (docker/php/www.conf). Every other role writes files a *web* request later has
# to read: the queue worker merges the final deliverable, the scheduler runs
# exports. Left as root those files came out root-owned and mode 0600, so php-fpm
# could not read them and "download the final file" 404'd — until the next deploy
# restarted the container and the chown above quietly repaired it. That is the
# "errors, then downloads fine a while later" the office reported.
#
# This also covers `compose run --rm app php artisan …`. It does NOT cover
# `compose exec`, which skips the entrypoint entirely — use `exec -u www-data`
# for anything that writes to storage (see docs/DEPLOYMENT.md §9).
if [ "$(id -u)" = "0" ] && [ "${1:-}" != "php-fpm" ]; then
    exec su-exec www-data:www-data "$@"
fi

exec "$@"
