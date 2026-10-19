#!/bin/sh
# Usage: stills.sh <module-id> [progress ...]  -> stills/<id>-desk-<p>.png (1440x860) and stills/<id>-phone-<p>.png (390x800)
set -u
dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
id=$1; shift
[ $# -eq 0 ] && set -- 0 0.2 0.4 0.6 0.8 1
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$dir/stills"
one() { # $1 query $2 size $3 out
  out=$3; rm -f "$out"; prof=$(mktemp -d)
  "$CH" --headless=new --use-angle=metal --enable-webgl --ignore-gpu-blocklist --hide-scrollbars \
    --window-size=$2 --force-device-scale-factor=2 --virtual-time-budget=7000 --user-data-dir="$prof" \
    --no-first-run --no-default-browser-check --screenshot="$out" "http://127.0.0.1:4173/dev.html?$1" >/dev/null 2>&1 &
  pid=$!; n=0
  while [ $n -lt 60 ]; do [ -s "$out" ] && { sleep 0.4; break; }; kill -0 $pid 2>/dev/null || break; sleep 0.5; n=$((n+1)); done
  kill $pid 2>/dev/null; wait $pid 2>/dev/null
  case "$prof" in /var/folders/?*|/private/var/folders/?*|/tmp/?*|/private/tmp/?*) rm -rf "$prof";; esac
  [ -s "$out" ] && echo "ok $out" || echo "FAIL $out"
}
for p in "$@"; do
  one "m=$id&jump=$p&bare=1" 1440,860 "$dir/stills/$id-desk-$p.png" &
  { one "m=$id&jump=$p&bare=1&device=phone" 520,800 "$dir/stills/$id-phone-$p.png" && ffmpeg -loglevel error -y -i "$dir/stills/$id-phone-$p.png" -vf crop=780:1600:0:0 "$dir/stills/$id-phone-$p.c.png" && mv "$dir/stills/$id-phone-$p.c.png" "$dir/stills/$id-phone-$p.png"; } &
done
wait
