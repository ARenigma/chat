# Postgres with pgTAP, for `npm run test:db`.
#
# Built from the alpine base rather than the Debian one (which has a
# `postgresql-16-pgtap` package) because alpine ships no pgTAP package at all and
# the image is a third of the size. pgTAP is pure SQL plus a PGXS makefile, so
# building it from a pinned release tarball is quick and fully reproducible — and
# it keeps this suite off the multi-gigabyte supabase/postgres image.
#
# Docker caches the whole thing, so this cost is paid once.
FROM postgres:16-alpine

ARG PGTAP_VERSION=1.3.3

RUN set -eux; \
  apk add --no-cache --virtual .build perl make patch musl-dev gcc postgresql16-dev curl; \
  curl -fsSL "https://github.com/theory/pgtap/archive/refs/tags/v${PGTAP_VERSION}.tar.gz" \
    -o /tmp/pgtap.tar.gz; \
  tar -xzf /tmp/pgtap.tar.gz -C /tmp; \
  make -C "/tmp/pgtap-${PGTAP_VERSION}"; \
  make -C "/tmp/pgtap-${PGTAP_VERSION}" install; \
  rm -rf /tmp/pgtap*; \
  apk del .build
