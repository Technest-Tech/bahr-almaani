#!/bin/sh
# Enable the :443 server block only when its certificate is really there.
#
# The nginx image runs everything in /docker-entrypoint.d/ before starting, so
# this decides per-boot: TLS_DOMAIN set and the cert readable -> render tls.conf
# into /etc/nginx/tls/; otherwise leave that directory empty and serve HTTP.
# Getting this wrong in the other direction is what makes a missing certificate
# take the whole site down instead of just its TLS.
set -e

TLS_DIR=/etc/nginx/tls
TEMPLATE=/etc/nginx/tls-available/tls.conf

mkdir -p "$TLS_DIR"
rm -f "$TLS_DIR"/tls.conf

if [ -z "${TLS_DOMAIN:-}" ]; then
    echo "40-enable-tls: TLS_DOMAIN unset — serving HTTP only"
    exit 0
fi

CERT="/etc/letsencrypt/live/${TLS_DOMAIN}/fullchain.pem"
KEY="/etc/letsencrypt/live/${TLS_DOMAIN}/privkey.pem"

if [ ! -s "$CERT" ] || [ ! -s "$KEY" ]; then
    echo "40-enable-tls: no certificate at $CERT — serving HTTP only"
    exit 0
fi

sed "s/__DOMAIN__/${TLS_DOMAIN}/g" "$TEMPLATE" > "$TLS_DIR/tls.conf"
echo "40-enable-tls: TLS enabled for ${TLS_DOMAIN}"
