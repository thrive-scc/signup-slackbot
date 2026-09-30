# Development and CI only; production runs on Cloudflare Workers.
FROM public.ecr.aws/docker/library/node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553
ENV NODE_OPTIONS=--dns-result-order=ipv4first \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    WRANGLER_SEND_METRICS=false \
    WRANGLER_LOG_PATH=/tmp/wrangler-logs \
    CI=true
RUN npx --yes --package=@playwright/test@1.63.0 playwright install --with-deps chromium \
    && npm cache clean --force
WORKDIR /workspace
EXPOSE 5173
CMD ["npm", "run", "dev"]
