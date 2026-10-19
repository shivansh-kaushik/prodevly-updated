#!/bin/sh
# Usage: shoot.sh <module-id> [progress ...]
# Captures dev.html?m=<id> at each progress, desktop (1280x900) and phone frame,
# into shots/<id>-desk-<p>.png and shots/<id>-phone-<p>.png. Needs the local
# server on 127.0.0.1:4173. Safe to run from several agents at once: every
# capture gets its own throwaway Chrome profile.
set -u
dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
id=$1; shift
[ $# -eq 0 ] && set -- 0 0.25 0.5 0.75 1
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$dir/shots"

shoot_one() { # $1 query  $2 outfile
  out=$2
  rm -f "$out"
  prof=$(mktemp -d)
  "$CH" --headless=new --use-angle=metal --enable-webgl --ignore-gpu-blocklist \
    --hide-scrollbars --window-size=1280,900 --virtual-time-budget=7000 \
    --user-data-dir="$prof" --no-first-run --no-default-browser-check \
    --screenshot="$out" "http://127.0.0.1:4173/dev.html?$1" >/dev/null 2>&1 &
  pid=$!
  n=0
  while [ $n -lt 60 ]; do
    if [ -s "$out" ]; then sleep 0.4; break; fi
    if ! kill -0 $pid 2>/dev/null; then break; fi
    sleep 0.5; n=$((n + 1))
  done
  kill $pid 2>/dev/null
  wait $pid 2>/dev/null
  case "$prof" in
    /var/folders/?*|/tmp/?*|/private/var/folders/?*|/private/tmp/?*) rm -rf "$prof" ;;
  esac
  [ -s "$out" ] && echo "ok   $out" || echo "FAIL $out"
}

for p in "$@"; do
  shoot_one "m=$id&jump=$p" "$dir/shots/$id-desk-$p.png" &
  shoot_one "m=$id&jump=$p&device=phone" "$dir/shots/$id-phone-$p.png" &
done
wait
