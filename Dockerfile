FROM oven/bun:1.4.5-slim AS build

WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.5-slim AS runtime

ARG LITESTREAM_VERSION=0.5.18
ARG LITESTREAM_ASSET=litestream-${LITESTREAM_VERSION}-linux-x86_64.tar.gz

# gosu drops privileges in the entrypoint; there is no way back to root after that.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gosu \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSLo "/tmp/${LITESTREAM_ASSET}" "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/${LITESTREAM_ASSET}" \
  && curl -fsSLo /tmp/checksums.txt "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/checksums.txt" \
  && (cd /tmp && grep " ${LITESTREAM_ASSET}\$" checksums.txt | sha256sum -c -) \
  && tar -xzf "/tmp/${LITESTREAM_ASSET}" -C /usr/local/bin litestream \
  && chmod 0755 /usr/local/bin/litestream \
  && rm -rf "/tmp/${LITESTREAM_ASSET}" /tmp/checksums.txt \
  && litestream version

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY litestream.yml /etc/litestream.yml
COPY litestream-drill.yml /etc/litestream-drill.yml

RUN chmod 0755 /app/scripts/docker-entrypoint.sh \
  && groupadd --system --gid 10001 app \
  && useradd --system --uid 10001 --gid app --home-dir /home/app --shell /usr/sbin/nologin app \
  && chown -R app:app /app /etc/litestream.yml /etc/litestream-drill.yml

# The entrypoint starts as root for exactly one purpose: Fly mounts volumes as
# root, so it fixes the ownership of the data directory before anything else,
# then re-execs itself as the unprivileged `app` user (see
# scripts/docker-entrypoint.sh). No secret is baked into the image or any
# build stage; runtime credentials arrive only via Fly secrets as environment
# variables at start.
USER root

ENV NODE_ENV=production \
  DATABASE_PATH=/data/app.sqlite \
  CATALOG_DATABASE_PATH=/data/catalog.sqlite \
  OBJECT_STORE_ROOT=/data/objects \
  LITESTREAM_CONFIG_PATH=/etc/litestream.yml

EXPOSE 3000

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
