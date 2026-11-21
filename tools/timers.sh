#!/usr/bin/env bash
# Installs the brain's systemd user units (tools/systemd/), and reports on them.
#
#   tools/timers.sh install     write the units; enable the hourly, daily and weekly timers and
#                               the brain daemon (research sessions run on the owner's schedule,
#                               set in the admin: ADMIN.md)
#   tools/timers.sh status      the timers, their next runs, the daemon, and today's tick log
#   tools/timers.sh uninstall   stop and remove every blocklore-* unit
#
# Only blocklore-* units are written or removed; other projects' units are never touched.
set -euo pipefail

root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
timers=(blocklore-tick-hourly.timer blocklore-tick-daily.timer blocklore-tick-weekly.timer)
daemon=blocklore-brain.service
# The research timer before the daemon scheduled research; removed on install.
retired=blocklore-tick-research.timer

install_units() {
  mkdir -p "$units" "$root/var/loop" "$root/var/control"
  local path="$(dirname "$(command -v node)"):/usr/local/bin:/usr/bin:/bin"
  if [[ -f "$units/$retired" ]]; then
    systemctl --user disable --now "$retired" >/dev/null 2>&1 || true
    rm -f "$units/$retired"
  fi
  for f in "$root"/tools/systemd/blocklore-*; do
    sed -e "s#@ROOT@#$root#g" -e "s#@PATH@#$path#g" "$f" >"$units/$(basename "$f")"
  done
  systemctl --user daemon-reload
  systemctl --user enable --now "${timers[@]}" >/dev/null
  systemctl --user enable "$daemon" >/dev/null
  systemctl --user restart "$daemon"
  echo "installed: ${timers[*]} and $daemon enabled and running"
}

case "${1:-}" in
  install) install_units ;;
  status)
    systemctl --user list-timers --all 'blocklore-*' --no-pager
    echo
    systemctl --user status "$daemon" --no-pager --lines 5 || true
    log="$root/var/loop/$(date -u +%F).jsonl"
    if [[ -f "$log" ]]; then
      echo
      echo "today's ticks ($log):"
      tail -n 20 "$log"
    fi
    ;;
  uninstall)
    systemctl --user disable --now "${timers[@]}" "$daemon" "$retired" >/dev/null 2>&1 || true
    rm -f "$units"/blocklore-*
    systemctl --user daemon-reload
    echo "removed every blocklore-* unit"
    ;;
  *)
    sed -n 2,10p "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
