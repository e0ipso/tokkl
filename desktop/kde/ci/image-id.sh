#!/usr/bin/env bash
# Prints the identity of the dependency images that scripts/container-check.sh
# builds for one format: a SHA-256 over everything that goes into them.
#
#   image-id.sh --format deb|ubuntu-deb|rpm
#
# The inputs are the Dockerfile (ci/Dockerfile, ci/ubuntu.Dockerfile or ci/fedora.Dockerfile, which
# pins the base image by digest), every file its COPY instructions copy (the
# preparation script, debian/control or the RPM spec, ci/baseline.sh) and
# TOKKL_KDE_CI_REFRESH, which container-check.sh also passes to the build.
# The distribution archives move without any of these files changing, so a
# new TOKKL_KDE_CI_REFRESH value is how to rebuild the images against them.
#
# container-check.sh labels the images with this identity and reuses images
# that carry it; CI keys its image cache on it.

set -euo pipefail

usage() {
    echo "usage: $0 --format deb|ubuntu-deb|rpm" >&2
    exit 2
}

format=""
while [ $# -gt 0 ]; do
    case "$1" in
        --format) format="${2-}"; shift 2 || usage ;;
        *) usage ;;
    esac
done
case "$format" in
    deb) dockerfile=ci/Dockerfile ;;
    ubuntu-deb) dockerfile=ci/ubuntu.Dockerfile ;;
    rpm) dockerfile=ci/fedora.Dockerfile ;;
    *) usage ;;
esac

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# COPY <source>... <destination>, with sources relative to desktop/kde. A
# COPY with flags (--from, --chown) or wildcards would need more than this,
# so refuse it rather than hash too little.
mapfile -t sources < <(awk '
    toupper($1) == "COPY" {
        for (i = 2; i < NF; i++) print $i
    }' "$dockerfile")
for source in "${sources[@]}"; do
    case "$source" in
        -*|*'*'*|*'?'*|*'['*)
            echo "error: $dockerfile: COPY $source is not a plain file; extend $0" >&2
            exit 1 ;;
    esac
    [ -f "$source" ] || { echo "error: $dockerfile copies $source, which is not a file" >&2; exit 1; }
done

{
    printf 'refresh %s\n' "${TOKKL_KDE_CI_REFRESH:-}"
    for file in "$dockerfile" "${sources[@]}"; do
        printf 'file %s %s\n' "$file" "$(sha256sum < "$file" | cut -d' ' -f1)"
    done
} | sha256sum | cut -d' ' -f1
