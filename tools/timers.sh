#!/usr/bin/env bash
# Installs the brain's timers as systemd user units (tools/systemd/), and reports on them.
#
#   tools/timers.sh install         write the units, enable hourly, daily and weekly
#   tools/timers.sh research on|off the paid daily research timer, off until the owner turns it on
#   tools/timers.sh status          the timers, their next runs, and today's tick log
#   tools/timers.sh uninstall       stop and remove every blocklore-* unit
#
# Only blocklore-* units are written or removed; other projects' units are never touched.
set -euo pipefail

root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
free=(blocklore-tick-hourly.timer blocklore-tick-daily.timer blocklore-tick-weekly.timer)
paid=blocklore-tick-research.timer

install_units() {
  mkdir -p "$units" "$root/var/loop"
  local path="$(dirname "$(command -v node)"):/usr/local/bin:/usr/bin:/bin"
  for f in "$root"/tools/systemd/blocklore-*; do
    sed -e "s#@ROOT@#$root#g" -e "s#@PATH@#$path#g" "$f" >"$units/$(basename "$f")"
  done
  systemctl --user daemon-reload
  systemctl --user enable --now "${free[@]}" >/dev/null
  echo "installed: ${free[*]} enabled; $paid installed, off (tools/timers.sh research on)"
}

case "${1:-}" in
  install) install_units ;;
  research)
    case "${2:-}" in
      on) systemctl --user enable --now "$paid" >/dev/null && echo "research timer on" ;;
      off) systemctl --user disable --now "$paid" >/dev/null && echo "research timer off" ;;
      *) echo "usage: tools/timers.sh research on|off" >&2 && exit 2 ;;
    esac
    ;;
  status)
    systemctl --user list-timers --all 'blocklore-*' --no-pager
    log="$root/var/loop/$(date -u +%F).jsonl"
    if [[ -f "$log" ]]; then
      echo
      echo "today's ticks ($log):"
      tail -n 20 "$log"
    fi
    ;;
  uninstall)
    systemctl --user disable --now "${free[@]}" "$paid" >/dev/null 2>&1 || true
    rm -f "$units"/blocklore-*
    systemctl --user daemon-reload
    echo "removed every blocklore-* unit"
    ;;
  *)
    sed -n 2,9p "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
