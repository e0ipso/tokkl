#!/usr/bin/env bash
# Starts a built image, waits for /healthz, checks the first-run setup code is
# logged and that `docker stop` ends the server cleanly. CI runs it after
# `docker build`; it works the same locally: scripts/docker-smoke.sh tokkl:dev
set -euo pipefail

image=${1:?usage: docker-smoke.sh <image>}
name=tokkl-smoke-$$
port=${SMOKE_PORT:-18080}

cleanup() { docker rm -f -v "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$name" -p "127.0.0.1:$port:8080" "$image" >/dev/null

for _ in $(seq 1 30); do
  if curl -fs "http://127.0.0.1:$port/healthz"; then
    echo
    break
  fi
  sleep 1
done
curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null || {
  docker logs "$name"
  echo "No answer on /healthz after 30 seconds" >&2
  exit 1
}

docker logs "$name" 2>&1 | grep -q 'use this setup code to create it' || {
  docker logs "$name"
  echo "The setup code is missing from the log" >&2
  exit 1
}

docker stop --timeout 10 "$name" >/dev/null
status=$(docker inspect -f '{{.State.ExitCode}}' "$name")
if [ "$status" != 0 ]; then
  docker logs "$name"
  echo "The server exited with $status on SIGTERM" >&2
  exit 1
fi
echo "Smoke test passed: $image"
