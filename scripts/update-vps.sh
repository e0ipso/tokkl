#!/usr/bin/env bash
set -euo pipefail
umask 022

usage() { echo "Usage: sudo $0 [VERSION|latest]"; }
die() { echo "$*" >&2; exit 1; }
if [[ ${1:-} == --help || ${1:-} == -h ]]; then
  usage
  exit 0
fi
[[ $# -le 1 ]] || { usage >&2; exit 2; }
requested=${1:-latest}
version_pattern='^v?[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'
[[ $requested == latest || $requested =~ $version_pattern ]] || die "Invalid version: $requested"
[[ $(id -u) == 0 ]] || die "Run this script with sudo."
builder=${SUDO_USER:-}
[[ -n $builder && $builder != root ]] || die "Run with sudo from your regular user account."
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) process.exit(1)' || die "Node 24 or newer is required."

app=/opt/tokkl
[[ -L $app/current ]] || die "Missing installation: $app/current"
exec 9> "$app/.update.lock"
flock -n 9 || die "Another Tokkl update is running."
previous=$(readlink -f "$app/current")
[[ $(dirname "$previous") == "$app/releases" && -d $previous ]] || die "Unexpected current release: $previous"

work=$(mktemp -d /var/tmp/tokkl-update.XXXXXX)
release=
needs_start=0
cleanup() {
  result=$?
  trap - EXIT
  set +e
  if (( needs_start )); then systemctl start tokkl.service; fi
  rm -f -- "$app/.current-$$"
  if [[ -n $release && $(readlink -f "$app/current") != "$release" ]]; then
    rm -rf -- "$release"
  fi
  rm -rf -- "$work"
  if (( result != 0 )); then
    echo "Update failed. Check the output above and: sudo journalctl -u tokkl.service -n 50" >&2
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ $requested == latest ]]; then
  curl --fail --silent --show-error --location --retry 3 --connect-timeout 10 --max-time 120 \
    https://api.github.com/repos/e0ipso/tokkl/releases/latest -o "$work/latest.json"
  tag=$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).tag_name)' "$work/latest.json")
else
  tag=v${requested#v}
fi
[[ $tag =~ $version_pattern ]] || die "Unexpected release tag: $tag"
version=${tag#v}
echo "Building Tokkl $version as $builder."
chown -- "$builder" "$work"

runuser -u "$builder" -- env NODE_OPTIONS=--max-old-space-size=384 \
  bash -s -- "$work" "$tag" "$version" <<'BUILD'
set -euo pipefail
work=$1
tag=$2
version=$3
mkdir "$work/source" "$work/runtime"
curl --fail --silent --show-error --location --retry 3 --connect-timeout 10 --max-time 180 \
  "https://github.com/e0ipso/tokkl/archive/refs/tags/$tag.tar.gz" -o "$work/source.tar.gz"
tar --extract --gzip --file "$work/source.tar.gz" --strip-components=1 --directory "$work/source"
cd "$work/source"
node -e 'if (require("./package.json").version !== process.argv[1]) process.exit(1)' "$version"
npm ci --ignore-scripts --engine-strict --no-fund
npm run build
test -s dist/web/index.html

cp package.json package-lock.json LICENSE "$work/runtime/"
for package in api common types; do
  mkdir -p "$work/runtime/packages/$package"
  cp "packages/$package/package.json" "$work/runtime/packages/$package/"
done
cp -a packages/api/src "$work/runtime/packages/api/"
cp -a packages/common/. "$work/runtime/packages/common/"
cp -a packages/types/. "$work/runtime/packages/types/"
mkdir "$work/runtime/dist"
cp -a dist/web "$work/runtime/dist/"
cd "$work/runtime"
npm ci --omit=dev --ignore-scripts --engine-strict --workspace @tokkl/api --no-fund
npm update body-parser qs --omit=dev --ignore-scripts --engine-strict --workspace @tokkl/api --no-fund
npm audit --omit=dev --workspace @tokkl/api --audit-level=high
find packages -type f \( -name '*.test.ts' -o -name tsconfig.json \) -delete
node --input-type=module -e 'await import("@tokkl/common/time")'
printf 'version=%s\ntag=%s\n' "$version" "$tag" > RELEASE
BUILD

release="$app/releases/$version-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir "$release"
cp -a "$work/runtime/." "$release/"
chown -R root:root "$release"
chmod -R u=rwX,go=rX "$release"
(
  cd "$release"
  runuser -u tokkl -- node --input-type=module -e 'await import("@tokkl/common/time")'
)

echo "Activating Tokkl $version."
needs_start=1
systemctl stop tokkl.service
ln -s "$release" "$app/.current-$$"
mv -Tf "$app/.current-$$" "$app/current"
systemctl start tokkl.service
needs_start=0
curl --fail --silent --show-error --retry 30 --retry-connrefused --retry-delay 1 \
  --retry-max-time 60 --max-time 3 http://127.0.0.1:8080/healthz -o "$work/health.json"
node -e 'if (JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).ok !== true) process.exit(1)' "$work/health.json"
systemctl is-active --quiet tokkl.service

find "$app/releases" -mindepth 1 -maxdepth 1 -type d \
  ! -path "$release" ! -path "$previous" -exec rm -rf -- {} +
echo "Tokkl $version is running. Previous release retained: $previous"
