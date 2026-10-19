#!/usr/bin/env bash
# Reuse a successful command only on a clean, identical committed tree, with
# identical argv and an explicit environment identity. Receipts/logs stay outside
# the checkout. Use a fresh receipt directory per drain. See verification.md.
set -uo pipefail

if [ "$#" -lt 5 ]; then
  echo 'usage: verify-tree.sh <receipt-dir> <suite> <environment-id> <new-log> <command>...' >&2
  exit 2
fi
receipts=$1; suite=$2; environment=$3; logfile=$4
shift 4
case "$suite" in ''|*[![:alnum:]_.:-]*) echo 'invalid suite token' >&2; exit 2 ;; esac
[ -n "$environment" ] || { echo 'environment identity is required' >&2; exit 2; }
root=$(git rev-parse --show-toplevel) || exit 2
case "$receipts" in /*) ;; *) echo 'receipt directory must be absolute' >&2; exit 2 ;; esac
case "$logfile" in /*) ;; *) echo 'log must be absolute' >&2; exit 2 ;; esac
mkdir -p "$receipts" || exit 2
physical_receipts=$(cd "$receipts" && pwd -P) || exit 2
log_parent=$(cd "$(dirname "$logfile")" && pwd -P) || exit 2
case "$physical_receipts/" in "$root/"*) echo 'receipts must be outside the checkout' >&2; exit 2 ;; esac
case "$log_parent/" in "$root/"*) echo 'logs must be outside the checkout' >&2; exit 2 ;; esac

clean_tree() {
  local state
  state=$(git status --porcelain --untracked-files=all --ignore-submodules=none) || return 2
  [ -z "$state" ] || return 1
  git rev-parse 'HEAD^{tree}'
}
tree=$(clean_tree) || {
  echo 'verification reuse requires a clean committed worktree, including untracked files' >&2
  exit 2
}
# Neither a basename nor a suite nickname substitutes for command identity.
key=$({ printf '%s\n' "$root" "$tree" "$suite" "$environment"; printf '%q\n' "$@"; } | git hash-object --stdin) || exit 2
receipt="$receipts/$key.pass"
if [ -f "$receipt" ] && [ ! -L "$receipt" ]; then
  {
    IFS= read -r saved_log
    IFS= read -r saved_checksum
  } < "$receipt"
  if [ -f "$saved_log" ] && [ ! -L "$saved_log" ] && [ "$(cksum < "$saved_log")" = "$saved_checksum" ]; then
    printf 'verification=reused\nsuite=%s\ntree=%s\nlog=%s\n' "$suite" "$tree" "$saved_log"
    exit 0
  fi
  echo "error: damaged verification receipt or log: $receipt" >&2
  exit 2
fi
(set -o noclobber; : > "$logfile") || exit 2
"$@" >> "$logfile" 2>&1
result=$?
printf 'verification=ran\nsuite=%s\ntree=%s\nexit=%s\nlog=%s\n' "$suite" "$tree" "$result" "$logfile"
[ "$result" -eq 0 ] || exit "$result"
after=$(clean_tree) || { echo 'tree changed during verification; no receipt saved' >&2; exit 2; }
[ "$after" = "$tree" ] || { echo 'tree changed during verification; no receipt saved' >&2; exit 2; }
draft=$(mktemp "$receipts/.receipt.XXXXXX") || exit 2
trap 'rm -f "$draft"' EXIT
printf '%s\n%s\n' "$logfile" "$(cksum < "$logfile")" > "$draft" || exit 2
if ln "$draft" "$receipt" 2>/dev/null; then
  :
elif [ ! -f "$receipt" ] || [ -L "$receipt" ]; then
  echo "error: cannot publish verification receipt: $receipt" >&2
  exit 2
fi
