#!/usr/bin/env bash
# Sets up what the site needs on Vercel beyond its code, and checks it with --check:
#   - blocklore-kv, an Upstash Redis store (Vercel Marketplace, pay as you go, iad1) connected to
#     the blocklore project for production. Ask the Brain keeps its daily budget, its per-visitor
#     limits and its answer cache there (KV_REST_API_URL and KV_REST_API_TOKEN, set by the
#     integration).
#   - ANTHROPIC_API_KEY and ASK_SALT from .env, as sensitive production variables. ASK_SALT keys
#     the hash that stands in for a visitor's address; it is made here once if .env lacks it.
#   - ASK_DAILY_BUDGET_USD, plain: ARCHITECTURE.md Q4's default until the owner sets another.
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
budget_default="2"

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
  if ! grep -qE '^ASK_SALT=.' "$env_file"; then
    (umask 077 && node -e 'process.stdout.write("ASK_SALT=" + require("node:crypto").randomBytes(32).toString("hex") + "\n")' >>"$env_file")
    echo "made ASK_SALT in .env"
  fi
  for name in ANTHROPIC_API_KEY ASK_SALT; do
    from_env "$name" "$work/value" || fail "$name is not in .env (.env.example lists it)"
    put "$name" sensitive "$work/value"
  done
  from_env ASK_DAILY_BUDGET_USD "$work/value" || printf '%s' "$budget_default" >"$work/value"
  put ASK_DAILY_BUDGET_USD plain "$work/value"
  echo "set ANTHROPIC_API_KEY, ASK_SALT (sensitive) and ASK_DAILY_BUDGET_USD on production"
fi

res="$(api GET "/v10/projects/$project_id/env?slug=$team")"
[[ "$(status "$res")" == 200 ]] || fail "env list: $(status "$res")"
have="$(body "$res" | jq -r '[.envs[] | select(.target | index("production")) | .key] | join(" ")')"
for name in KV_REST_API_URL KV_REST_API_TOKEN ANTHROPIC_API_KEY ASK_SALT ASK_DAILY_BUDGET_USD; do
  [[ " $have " == *" $name "* ]] || fail "$name is not set on production"
done
echo "env ok: $store_name connected; KV_REST_API_URL, KV_REST_API_TOKEN, ANTHROPIC_API_KEY, ASK_SALT, ASK_DAILY_BUDGET_USD on production"
