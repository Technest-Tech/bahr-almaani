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

exec "$@"
