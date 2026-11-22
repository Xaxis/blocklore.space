#!/usr/bin/env bash
# Connects the brain to the owner's Claude subscription. Every model session (research, the
# verifier, the evaluator) runs on this token and nothing else: there is no API key and nothing is
# billed per token. Run it on the devbox, in your own terminal (not through an assistant), because
# the token is shown on screen once:
#
#   tools/subscription.sh            sign in, save the token to .env, check it, restart the brain
#   tools/subscription.sh --check    only check the saved token with a one-turn session
#
# The token goes into .env (mode 600) as CLAUDE_CODE_OAUTH_TOKEN. It never passes through a command
# line: it is read at a hidden prompt and written with shell builtins.
set -euo pipefail
cd "$(dirname "$0")/.."
env_file=.env
[ -f "$env_file" ] || install -m 600 /dev/null "$env_file"
chmod 600 "$env_file"

check() {
  local home
  home=$(mktemp -d)
  # A clean environment: only the subscription token, never an API key, a throwaway HOME.
  if (
    set -a
    # shellcheck disable=SC1090
    . <(grep -E '^CLAUDE_CODE_OAUTH_TOKEN=' "$env_file")
    set +a
    env -u ANTHROPIC_API_KEY HOME="$home" claude -p "Reply with the single word ok." \
      --model haiku --max-turns 1 --output-format text </dev/null 2>&1 | head -c 400
  ) | grep -qi '\bok\b'; then
    echo "subscription ok: a one-turn session ran on your Claude plan"
    rm -rf "$home"
    return 0
  fi
  echo "subscription check failed: the token did not start a session (expired, revoked, or the plan's limit)" >&2
  rm -rf "$home"
  return 1
}

if [ "${1:-}" = "--check" ]; then
  grep -qE '^CLAUDE_CODE_OAUTH_TOKEN=.' "$env_file" || { echo "no CLAUDE_CODE_OAUTH_TOKEN in .env" >&2; exit 1; }
  check
  exit $?
fi

echo "Step 1 of 3: sign in with your Claude account. Claude Code opens a browser and prints a token."
claude setup-token
echo
echo "Step 2 of 3: paste the token it printed (it starts with sk-ant-). The input is hidden."
IFS= read -rs token
echo
token=${token//[[:space:]]/}
case "$token" in
  sk-ant-*) ;;
  *) echo "That does not look like a Claude token (sk-ant-...). Nothing was saved." >&2; exit 1 ;;
esac

tmp=$(mktemp "$env_file.XXXXXX")
chmod 600 "$tmp"
grep -vE '^CLAUDE_CODE_OAUTH_TOKEN=' "$env_file" >"$tmp" || true
printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$token" >>"$tmp"
mv "$tmp" "$env_file"
unset token
echo "Saved to .env as CLAUDE_CODE_OAUTH_TOKEN."

echo "Step 3 of 3: checking it with a one-turn session."
check

if grep -qE '^ANTHROPIC_API_KEY=.' "$env_file"; then
  printf 'The brain no longer reads ANTHROPIC_API_KEY. Remove it from .env? [y/N] '
  read -r answer
  if [ "${answer:-n}" = "y" ]; then
    tmp=$(mktemp "$env_file.XXXXXX")
    chmod 600 "$tmp"
    grep -vE '^ANTHROPIC_API_KEY=' "$env_file" >"$tmp" || true
    mv "$tmp" "$env_file"
    echo "Removed. You can also revoke the key in the Anthropic console."
  fi
fi

if systemctl --user is-active --quiet blocklore-brain.service; then
  systemctl --user restart blocklore-brain.service
  echo "Restarted the brain; the admin shows your subscription as connected within a minute."
fi
