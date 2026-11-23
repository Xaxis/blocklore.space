#!/usr/bin/env bash
# Keeps a production mirror of Blocklore current without taking it down (MIRROR.md).
#
#   tools/mirror-update.sh ROOT [-- RESTART...]
#
# ROOT holds two clones, ROOT/a and ROOT/b, and ROOT/current, a link to the one the server runs
# from. Clone Blocklore into ROOT/a once; the first run builds it and points ROOT/current at it.
# Every later run fetches the upstream branch (origin's HEAD, main on GitHub) into the clone the
# server is not using. When that is a newer commit, it installs and builds it there, with its
# commit as the build marker, and only then points ROOT/current at it and runs RESTART (for
# example `systemctl --user restart blocklore-mirror`). A failed fetch, install or build leaves
# the served clone as it was. The clone being built is the script's own: local edits there are
# discarded.
#
# No secret and no environment variable is needed: the site builds from the store in the clone.
set -euo pipefail

usage() {
  echo "usage: tools/mirror-update.sh ROOT [-- RESTART...]" >&2
  exit 2
}
[[ $# -ge 1 && -d "$1" ]] || usage
root="$(cd "$1" && pwd)"
shift
if [[ $# -gt 0 ]]; then
  [[ "$1" == "--" ]] || usage
  shift
fi

build() { # build DIR: install and build the commit checked out in DIR
  local sha
  sha="$(git -C "$1" rev-parse --short=7 HEAD)"
  echo "building $sha in $1"
  (cd "$1" && pnpm install --frozen-lockfile && BLOCKLORE_BUILD="$sha" pnpm build)
}

serve() { # serve NAME: point ROOT/current at ROOT/NAME in one rename
  ln -sfn "$1" "$root/current.next"
  mv -T "$root/current.next" "$root/current"
}

restart() {
  if [[ $# -gt 0 ]]; then "$@"; fi
}

if [[ ! -L "$root/current" ]]; then
  [[ -d "$root/a/.git" ]] || {
    echo "mirror-update: clone Blocklore into $root/a first" >&2
    exit 2
  }
  build "$root/a"
  serve a
  echo "serving $(git -C "$root/a" rev-parse --short=7 HEAD) from $root/current"
  restart "$@"
  exit 0
fi

live="$(readlink "$root/current")"
case "$live" in
a) next=b ;;
b) next=a ;;
*)
  echo "mirror-update: $root/current points at $live, not a or b" >&2
  exit 2
  ;;
esac
upstream="$(git -C "$root/$live" remote get-url origin)"
branch="$(git -C "$root/$live" symbolic-ref --quiet --short refs/remotes/origin/HEAD || echo origin/main)"
branch="${branch#origin/}"

[[ -d "$root/$next/.git" ]] || git clone --quiet "$upstream" "$root/$next"
git -C "$root/$next" fetch --quiet origin "$branch"
git -C "$root/$next" checkout --quiet --force --detach FETCH_HEAD
want="$(git -C "$root/$next" rev-parse HEAD)"
have="$(git -C "$root/$live" rev-parse HEAD)"
if [[ "$want" == "$have" ]]; then
  echo "up to date: serving ${have:0:7} from $root/current"
  exit 0
fi
if git -C "$root/$next" merge-base --is-ancestor "$want" "$have" 2>/dev/null; then
  echo "up to date: serving ${have:0:7}, newer than $branch (${want:0:7})"
  exit 0
fi

build "$root/$next"
serve "$next"
echo "serving ${want:0:7} (was ${have:0:7}) from $root/current"
restart "$@"
