#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"
image=snack-signup-harness:dev
case "${1:-}" in
  build)
    exec docker build -t "$image" .
    ;;
  start)
    exec docker run --rm --init --name snack-signup-harness --shm-size=1g \
      -p 127.0.0.1:5173:5173 \
      -p 127.0.0.1:8787:8787 \
      --mount "type=bind,source=$project_dir,target=/workspace" \
      --mount type=volume,source=snack-harness-modules,target=/workspace/node_modules \
      --mount type=volume,source=snack-harness-state,target=/state \
      --mount type=volume,source=snack-harness-npm,target=/root/.npm \
      "$image" sh -c 'npm run build && npm run db:setup:local && npm run dev'
    ;;
  run)
    shift
    exec docker run --rm --init --shm-size=1g \
      --mount "type=bind,source=$project_dir,target=/workspace" \
      --mount type=volume,source=snack-harness-modules,target=/workspace/node_modules \
      --mount type=volume,source=snack-harness-state,target=/state \
      --mount type=volume,source=snack-harness-npm,target=/root/.npm \
      "$image" "$@"
    ;;
  stop)
    exec docker stop snack-signup-harness
    ;;
  *)
    echo 'Usage: sh scripts/dev.sh {build|start|stop|run COMMAND...}' >&2
    exit 2
    ;;
esac
