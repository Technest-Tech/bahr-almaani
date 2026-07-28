# syntax=docker/dockerfile:1.7
#
# Bahr Al-Maaani API image. Two targets:
#   --target app    php-fpm runtime, also used (with a different command) for the
#                   queue worker, the Reverb websocket server and the scheduler.
#   --target nginx  the web server, carrying a copy of public/ from the app stage
#                   so static assets are served without sharing a volume.
#
# Build both from api/: docker build --target app -t bahr-api .

# ── base: PHP + the extensions this app actually uses ────────────────────────
FROM php:8.2-fpm-alpine AS base

RUN apk add --no-cache \
        postgresql-libs libzip icu-libs oniguruma libpng libjpeg-turbo freetype \
        fcgi tini \
    && apk add --no-cache --virtual .build-deps \
        $PHPIZE_DEPS postgresql-dev libzip-dev icu-dev oniguruma-dev \
        libpng-dev libjpeg-turbo-dev freetype-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j"$(nproc)" \
        pdo_pgsql pgsql mbstring zip bcmath intl gd pcntl opcache \
    && apk del .build-deps

COPY --from=composer:2.8 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

# ── app: vendored dependencies + application code ────────────────────────────
FROM base AS app

COPY docker/php/opcache.ini /usr/local/etc/php/conf.d/10-opcache.ini
COPY docker/php/php.ini /usr/local/etc/php/conf.d/20-app.ini
COPY docker/php/www.conf /usr/local/etc/php-fpm.d/zz-app.conf

# Dependencies first so a code-only change reuses the vendor layer.
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction

COPY . .

RUN composer dump-autoload --optimize --classmap-authoritative --no-dev \
    && php artisan package:discover --ansi \
    && mkdir -p storage/framework/{cache,sessions,views} storage/logs bootstrap/cache \
    && chown -R www-data:www-data storage bootstrap/cache \
    && chmod -R ug+rwX storage bootstrap/cache

COPY docker/entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint

EXPOSE 9000

# tini reaps children so `docker compose stop` actually stops workers.
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint"]
CMD ["php-fpm"]

# ── nginx: static assets + FastCGI + websocket proxy ─────────────────────────
FROM nginx:1.27-alpine AS nginx

COPY --from=app /var/www/html/public /var/www/html/public
COPY docker/nginx/app.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
