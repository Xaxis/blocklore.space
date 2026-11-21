#!/usr/bin/env bash
# Sets up what the site needs on Vercel beyond its code, and checks it with --check:
#   - blocklore-kv, an Upstash Redis store (Vercel Marketplace, pay as you go, iad1) connected to
#     the blocklore project for production. The suggestion queue, the per-visitor caps, the admin's
#     sessions and the control plane live there (KV_REST_API_URL and KV_REST_API_TOKEN, set by the
#     integration).
#   - ASK_SALT from .env, sensitive: it keys the hash that stands in for a visitor's address (the
#     name is older than the suggestion box). Made here once if .env lacks it.
#   - QUEUE_PULL_TOKEN from .env, sensitive: the brain's bearer token for the research queue's
#     pull and status endpoints. Made here once if .env lacks it.
#   - The site runs no model for readers, so it holds no Anthropic key: ANTHROPIC_API_KEY and the
#     old ASK_DAILY_BUDGET_USD are removed from Vercel if found, and --check fails while they are.
#   - The admin (ADMIN.md): CONTROL_KEY, the HMAC key the site signs the owner's commands with and
#     the devbox verifies; BRAIN_SYNC_TOKEN, the brain daemon's bearer token for /api/control/sync;
#     both made here once if .env lacks them, both sensitive. RESEND_API_KEY, sensitive: a Resend
#     key that can only send from blocklore.space (on the Xaxis team), for sign-in links.
#     OWNER_EMAIL, plain: the one address that may sign in.
#
#   tools/env.sh            create or update, then check
#   tools/env.sh --check    check only; exit 1 on anything missing
#
# Every store is the project's own (CLAUDE.md: never repurpose another project's). Values come from
# .env through mode-600 files and never reach a command line or a log. Takes effect on the next
# deploy.
set -euo pipefail

team="xaxis-projects"
project="blocklore"
store_name="blocklore-kv"
retired="ANTHROPIC_API_KEY ASK_DAILY_BUDGET_USD"

check_only=0
[[ "${1:-}" == "--check" ]] && check_only=1

root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
fail() {
  echo "env FAILED: $*" >&2
  exit 1
}
# shellcheck source=tools/lib/vercel.sh
. "$root/tools/lib/vercel.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/blocklore-env.XXXXXX")"
trap 'rm -rf "$work"' EXIT
bl_vercel_auth "$root" "$work" || fail "no token"
api() { bl_api "$@"; }
body() { bl_body "$@"; }
status() { bl_status "$@"; }

res="$(api GET "/v9/projects/$project?slug=$team")"
[[ "$(status "$res")" == 200 ]] || fail "project $project: $(status "$res")"
project_id="$(body "$res" | jq -r .id)"

# --- the store ----------------------------------------------------------------------------------
res="$(api GET "/v1/integrations/configurations?view=account&slug=$team")"
[[ "$(status "$res")" == 200 ]] || fail "integrations: $(status "$res")"
icfg="$(body "$res" | jq -r '[.[] | select(.slug == "upstash")][0].id // empty')"
[[ -n "$icfg" ]] || fail "Upstash is not installed on $team (Vercel Marketplace)"

find_store() {
  local r
  r="$(api GET "/v1/storage/stores?slug=$team")"
  [[ "$(status "$r")" == 200 ]] || fail "stores: $(status "$r")"
  body "$r" | jq -c --arg n "$store_name" '[.stores[] | select(.name == $n)][0] // empty'
}
store="$(find_store)"
if [[ -z "$store" ]]; then
  [[ $check_only == 1 ]] && fail "no store $store_name"
  jq -n --arg n "$store_name" --arg i "$icfg" '{
    name: $n, integrationConfigurationId: $i, integrationProductIdOrSlug: "upstash-kv",
    billingPlanId: "paid", source: "marketplace",
    metadata: {primaryRegion: "iad1", eviction: false, prodPack: false, autoUpgrade: false}
  }' >"$work/store.json"
  res="$(api POST "/v1/storage/stores/integration/direct?slug=$team" "@$work/store.json")"
  [[ "$(status "$res")" == 200 || "$(status "$res")" == 201 ]] ||
    fail "could not create $store_name: $(body "$res" | head -c 400)"
  echo "created store $store_name (Upstash Redis, pay as you go, iad1)"
  store="$(find_store)"
  [[ -n "$store" ]] || fail "$store_name was created but is not listed"
fi
store_id="$(jq -r .id <<<"$store")"
if ! jq -e --arg p "$project" '[.projectsMetadata[]?.name] | index($p)' <<<"$store" >/dev/null; then
  [[ $check_only == 1 ]] && fail "$store_name is not connected to $project"
  jq -n --arg p "$project_id" '{projectId: $p, envVarEnvironments: ["production"], makeEnvVarsSensitive: true}' \
    >"$work/connect.json"
  res="$(api POST "/v1/integrations/installations/$icfg/resources/$store_id/connections?slug=$team" "@$work/connect.json")"
  [[ "$(status "$res")" == 200 || "$(status "$res")" == 201 || "$(status "$res")" == 204 ]] ||
    fail "could not connect $store_name to $project: $(body "$res" | head -c 400)"
  echo "connected $store_name to $project (production)"
fi

# --- the settings -------------------------------------------------------------------------------
main_checkout="$(dirname "$(git -C "$root" rev-parse --path-format=absolute --git-common-dir)")"
env_file="$main_checkout/.env"
[[ -f "$root/.env" ]] && env_file="$root/.env"

# from_env NAME FILE: writes NAME's value from .env into FILE (mode 600); false when there is none.
from_env() {
  local line value
  line="$(grep -E "^$1=" "$env_file" | tail -n 1 || true)"
  value="${line#"$1"=}"
  value="${value%\"}" && value="${value#\"}"
  value="${value%\'}" && value="${value#\'}"
  [[ -n "$value" ]] || return 1
  (umask 077 && printf '%s' "$value" >"$2")
}
# put NAME TYPE FILE: upserts NAME on production from the value in FILE.
put() {
  jq -n --arg k "$1" --arg t "$2" --rawfile v "$3" '{key: $k, value: $v, type: $t, target: ["production"]}' \
    >"$work/env.json"
  rm -f "$3"
  local r
  r="$(api POST "/v10/projects/$project_id/env?upsert=true&slug=$team" "@$work/env.json")"
  rm -f "$work/env.json"
  [[ "$(status "$r")" == 200 || "$(status "$r")" == 201 ]] || fail "could not set $1: $(body "$r" | head -c 300)"
}

if [[ $check_only == 0 ]]; then
  for name in ASK_SALT QUEUE_PULL_TOKEN CONTROL_KEY BRAIN_SYNC_TOKEN; do
    if ! grep -qE "^$name=." "$env_file"; then
      (umask 077 && N="$name" node -e 'process.stdout.write(process.env.N + "=" + require("node:crypto").randomBytes(32).toString("hex") + "\n")' >>"$env_file")
      echo "made $name in .env"
    fi
  done
  for name in ASK_SALT QUEUE_PULL_TOKEN CONTROL_KEY BRAIN_SYNC_TOKEN RESEND_API_KEY; do
    from_env "$name" "$work/value" || fail "$name is not in .env (.env.example lists it)"
    put "$name" sensitive "$work/value"
  done
  from_env OWNER_EMAIL "$work/value" || fail "OWNER_EMAIL is not in .env"
  put OWNER_EMAIL plain "$work/value"
  echo "set ASK_SALT, QUEUE_PULL_TOKEN, CONTROL_KEY, BRAIN_SYNC_TOKEN, RESEND_API_KEY (sensitive) and OWNER_EMAIL on production"
  # Variables the site no longer reads: off Vercel, so no model key sits where it is not needed.
  envs="$(api GET "/v10/projects/$project_id/env?slug=$team")"
  for name in $retired; do
    for id in $(body "$envs" | jq -r --arg k "$name" '.envs[] | select(.key == $k) | .id'); do
      r="$(api DELETE "/v9/projects/$project_id/env/$id?slug=$team")"
      [[ "$(status "$r")" == 200 ]] || fail "could not remove $name: $(status "$r")"
      echo "removed $name from Vercel"
    done
  done
fi

res="$(api GET "/v10/projects/$project_id/env?slug=$team")"
[[ "$(status "$res")" == 200 ]] || fail "env list: $(status "$res")"
have="$(body "$res" | jq -r '[.envs[] | select(.target | index("production")) | .key] | join(" ")')"
for name in KV_REST_API_URL KV_REST_API_TOKEN ASK_SALT QUEUE_PULL_TOKEN CONTROL_KEY BRAIN_SYNC_TOKEN RESEND_API_KEY OWNER_EMAIL; do
  [[ " $have " == *" $name "* ]] || fail "$name is not set on production"
done
for name in $retired; do
  [[ " $have " != *" $name "* ]] || fail "$name is still on production; the site runs no model (tools/env.sh removes it)"
done
echo "env ok: $store_name connected; KV, ASK_SALT, QUEUE_PULL_TOKEN and the admin's CONTROL_KEY, BRAIN_SYNC_TOKEN, RESEND_API_KEY, OWNER_EMAIL on production; no model key"
