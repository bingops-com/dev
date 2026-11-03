#!/usr/bin/env bash
set -euo pipefail
umask 077
workspace_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/dev-workspace"
healthy() { curl --silent --fail --max-time 2 --output /dev/null http://127.0.0.1:4175/api/dev/status; }

if [[ "${1:-}" == --supervise ]]; then
  mkdir -p "$state_dir"
  exec 9>"$state_dir/agent.lock"
  flock --nonblock 9 || exit 0
  agent_pid=''
  trap 'trap - EXIT; if [[ -n "$agent_pid" ]]; then kill "$agent_pid" 2>/dev/null || true; wait "$agent_pid" 2>/dev/null || true; fi; exit 0' TERM INT EXIT
  while true; do
    python3 "$workspace_dir/agent.py" --root /home/coder/projects --port 4175 &
    agent_pid=$!
    wait "$agent_pid" || true
    agent_pid=''
    sleep 2
  done
fi

if healthy; then
  echo 'Workspace discovery already available on 127.0.0.1:4175.'
  exit 0
fi
mkdir -p "$state_dir"
screen -dmS dev-workspace-agent bash "$workspace_dir/start.sh" --supervise
for ((attempt=0; attempt<25; attempt++)); do
  if healthy; then
    echo 'Workspace discovery available on 127.0.0.1:4175 (supervised).'
    exit 0
  fi
  sleep 0.2
done
echo 'Workspace discovery could not start; inspect the dev-workspace-agent screen session.' >&2
exit 1
