#!/usr/bin/env bash

set -euo pipefail

PORTS=(3000 24678)

for port in "${PORTS[@]}"; do
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"

  if [[ -n "${pids}" ]]; then
    echo "Releasing port ${port} (PID: ${pids})"
    kill ${pids} 2>/dev/null || true
    sleep 0.3

    stubborn_pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "${stubborn_pids}" ]]; then
      echo "Force-stopping remaining listener on ${port} (PID: ${stubborn_pids})"
      kill -9 ${stubborn_pids} 2>/dev/null || true
    fi
  else
    echo "Port ${port} is already free"
  fi
done

echo "Starting dev server..."
npm run dev
