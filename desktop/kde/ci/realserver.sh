#!/usr/bin/env bash
# Runs the companion's real-server test for one target.
#
#   realserver.sh --format deb|rpm --output <dir>
#
# <dir> is the output directory of a scripts/container-check.sh run for the
# same format: it holds tests/<format>/realservertest, built in the
# <image>:<format>-test image, which this script runs the binary in.
# tests/realserver.test.ts starts the Tokkl servers on 127.0.0.1 with the
# API's test fixtures, so the container shares the host's network. It needs
# Node.js 24 and the repository's npm dependencies (npm ci) on the host.
#
# TOKKL_KDE_CI_IMAGE names the images (default tokkl-kde-ci) and
# TOKKL_KDE_TEST_PORT the first of three ports for the servers (default: any
# free ports). CONTAINER_ENGINE defaults to docker.

set -euo pipefail

usage() {
    echo "usage: $0 --format deb|rpm --output <dir>" >&2
    exit 2
}

format=""
output=""
while [ $# -gt 0 ]; do
    case "$1" in
        --format) format="${2-}"; shift 2 || usage ;;
        --output) output="${2-}"; shift 2 || usage ;;
        *) usage ;;
    esac
done
case "$format" in deb|rpm) ;; *) usage ;; esac
[ -n "$output" ] || usage

tests="$(cd "$output/tests/$format" && pwd)"
[ -x "$tests/realservertest" ] || { echo "error: $tests/realservertest is missing; run scripts/container-check.sh first" >&2; exit 1; }
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
engine="${CONTAINER_ENGINE:-docker}"
image="${TOKKL_KDE_CI_IMAGE:-tokkl-kde-ci}:$format-test"

TOKKL_KDE_REALSERVER_COMMAND="$(node -e 'console.log(JSON.stringify(process.argv.slice(1)))' \
    "$engine" run --rm --network host -e TOKKL_REALSERVER_FIXTURE \
    -v "$tests:/tests:ro" "$image" /tests/realservertest)"
export TOKKL_KDE_REALSERVER_COMMAND
cd "$repo"
exec node --test desktop/kde/tests/realserver.test.ts
