#!/usr/bin/env bash
set -euo pipefail
token="$(bash -ic 'printf %s "${PARALLEL_CODE_GITHUB_PAT:-}"' 2>/dev/null)"
if [ -z "$token" ]; then
  echo "PARALLEL_CODE_GITHUB_PAT is not set (expected in ~/.bashrc for interactive shells)" >&2
  exit 1
fi
GH_TOKEN="$token" exec gh "$@"
