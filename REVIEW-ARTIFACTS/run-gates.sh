#!/usr/bin/env bash
# Sequential gate runner for the accountability close-out.
# Usage: bash REVIEW-ARTIFACTS/run-gates.sh <manifest> <outdir> <tag>
#   tag = baseline | final
# Never runs two gates in parallel: browser harnesses share :8765 (one serve.cjs
# fixture started here), wrangler harnesses self-start on their own ports.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$1"
OUTDIR="$2"
TAG="$3"
mkdir -p "$OUTDIR"
EXITS="$OUTDIR/EXIT-CODES.txt"
: > "$EXITS"

log() { printf '%s\n' "$*"; }

# Start one shared static server for browser harnesses.
start_serve() {
  if curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8765/manifest.webmanifest 2>/dev/null | grep -q 200; then
    log "serve.cjs already up on :8765 (reusing)"
    SRV_PID=""
    return
  fi
  ( cd "$ROOT" && node serve.cjs > "$OUTDIR/serve-static.log" 2>&1 & echo $! > "$OUTDIR/serve.pid" )
  SRV_PID="$(cat "$OUTDIR/serve.pid" 2>/dev/null || echo '')"
  for i in $(seq 1 60); do
    if curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8765/manifest.webmanifest 2>/dev/null | grep -q 200; then
      log "serve.cjs ready on :8765 (pid $SRV_PID)"
      return
    fi
    sleep 0.25
  done
  log "FATAL: serve.cjs did not answer on :8765"
  exit 90
}

stop_serve() {
  if [ -n "${SRV_PID:-}" ]; then
    kill "$SRV_PID" 2>/dev/null || true
    # Wait briefly so the port frees before any later run.
    sleep 1
    log "stopped serve.cjs (pid $SRV_PID)"
  fi
}

trap stop_serve EXIT

start_serve

i=0
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ''|'#'*) continue ;;
  esac
  i=$((i+1))
  slug=$(printf '%s' "$line" | sed -E 's/[^A-Za-z0-9]+/_/g; s/^_+|_+$//g')
  name=$(printf '%02d_%s' "$i" "$slug")
  logfile="$OUTDIR/$name.log"
  log "[$(date -u +%H:%M:%S)] [$TAG] $i: $line"
  ( cd "$ROOT" && timeout 600 bash -c "$line" ) > "$logfile" 2>&1
  code=$?
  printf '%-60s %s\n' "$name" "$code" >> "$EXITS"
  # echo a compact tail marker so the console shows progress without dumping logs
  tail3=$(tail -n 3 "$logfile" | tr '\n' ' ' | cut -c1-160)
  log "  exit=$code :: $tail3"
done < "$MANIFEST"

log "[$TAG] done. $i gates logged to $OUTDIR"
