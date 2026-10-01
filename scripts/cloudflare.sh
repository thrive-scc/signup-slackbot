#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"
# Keep remote-account credentials separate from the offline development harness.
# Device login avoids publishing an OAuth callback port from Docker.
exec docker run --rm --init -i \
  --env SLACK_BOT_TOKEN \
  --mount "type=bind,source=$project_dir,target=/workspace" \
  --mount type=volume,source=snack-harness-modules,target=/workspace/node_modules \
  --mount type=volume,source=snack-harness-npm,target=/root/.npm \
  --mount type=volume,source=snack-cloudflare-auth,target=/root/.config \
  snack-signup-harness:dev "$@"
