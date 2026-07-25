#!/usr/bin/env bash
#
# generate.sh — convenience wrapper around the pregen CLI (src/cli.ts).
#
# The pregen CLI is the ONLY writer of island rows. Every generating command
# emits an idempotent INSERT-OR-REPLACE .sql (+ .jsonl manifest) under
# artifacts/sql/. Loading into D1 is always a separate, explicit step. This
# script bundles "generate + (optionally) load into the live D1" so the routine
# — especially topping up daily challenges — is one findable command.
#
#   ./generate.sh dailies [DAYS] [--push]   # add the next DAYS of dailies (default 14)
#   ./generate.sh pool --level L --count N [--push]
#   ./generate.sh tutorials [--push]        # regenerate + load the tutorial/training maps
#   ./generate.sh load <file.sql> [--local] # load an already-generated .sql (remote by default)
#   ./generate.sh verify                    # replay-check the manifests in artifacts/sql
#
# Without --push, nothing touches D1: the script generates the .sql and prints
# the exact `wrangler d1 execute` command for you to run. With --push it loads
# into the LIVE (--remote) database after a confirmation prompt.
#
# DAILIES SEED HAZARD: `dailies` advances per-level seed counters
# (artifacts/counters.json). Generating a date range consumes seeds, so
# regenerating an overlapping range would double-advance the counters and
# produce DIFFERENT islands than the ones already live. This script therefore
# always starts the new batch at (last generated day + 1), read from the newest
# artifacts/sql/seed-dailies-*.sql filename — never pass an overlapping range by
# hand.

set -euo pipefail

cd "$(dirname "$0")"            # packages/pregen
ART=artifacts/sql
DB=losttemple                  # D1 database name (see wrangler config / memory)

die()  { echo "error: $*" >&2; exit 1; }
info() { echo ">> $*" >&2; }

# Add N days to a YYYY-MM-DD date using BSD date (macOS).
add_days() { date -j -v+"$2"d -f "%Y-%m-%d" "$1" "+%Y-%m-%d"; }
today()    { date "+%Y-%m-%d"; }

# Load a .sql file into D1. Second arg "local" targets the local dev DB,
# anything else targets the LIVE remote DB (with a confirmation prompt).
load_sql() {
  local file="$1" where="${2:-remote}"
  [ -f "$file" ] || die "no such sql file: $file"
  if [ "$where" = "local" ]; then
    info "loading $file into LOCAL D1"
    npx wrangler d1 execute "$DB" --local --file "$file"
  else
    echo "About to load into the LIVE D1 ($DB --remote):" >&2
    echo "    $file" >&2
    read -r -p "Proceed? [y/N] " ok
    [ "$ok" = "y" ] || [ "$ok" = "Y" ] || die "aborted"
    npx wrangler d1 execute "$DB" --remote --file "$file"
  fi
}

# Find the newest daily end-date already generated (the "to" date embedded in
# the latest seed-dailies-<from>-<to>.sql filename). Empty if none exist.
last_daily_date() {
  ls "$ART"/seed-dailies-*.sql 2>/dev/null \
    | sed -E 's/.*seed-dailies-[0-9]{4}-[0-9]{2}-[0-9]{2}-([0-9]{4}-[0-9]{2}-[0-9]{2})\.sql/\1/' \
    | sort | tail -n1
}

cmd_dailies() {
  local days=14 push=0
  for a in "$@"; do
    case "$a" in
      --push) push=1 ;;
      [0-9]*) days="$a" ;;
      *) die "unknown dailies arg: $a" ;;
    esac
  done

  local last from to
  last="$(last_daily_date)"
  [ -n "$last" ] || die "no existing seed-dailies-*.sql to continue from.
  Bootstrap the first batch explicitly, e.g.:
    npm start -- dailies --from 2026-01-01 --to 2026-01-14
  then re-run this script for subsequent top-ups."
  from="$(add_days "$last" 1)"
  to="$(add_days "$from" $((days - 1)))"
  info "last generated daily: $last"
  info "generating $days new days: $from .. $to"

  npm start -- dailies --from "$from" --to "$to"

  local sql="$ART/seed-dailies-$from-$to.sql"
  [ -f "$sql" ] || die "expected $sql was not produced"
  if [ "$push" = 1 ]; then
    load_sql "$sql" remote
  else
    echo "Generated $sql (not loaded). To publish to the live game:" >&2
    echo "    ./generate.sh load $sql          # or re-run with --push" >&2
  fi
}

cmd_pool() {
  local push=0 passthru=()
  for a in "$@"; do
    if [ "$a" = "--push" ]; then push=1; else passthru+=("$a"); fi
  done
  # pool prints "wrote <path> ..."; capture it to know what to load.
  local out
  out="$(npm start -- pool "${passthru[@]}" | tee /dev/stderr)"
  local sql
  sql="$(echo "$out" | sed -nE 's/^wrote (.*\.sql).*/\1/p' | tail -n1)"
  [ -n "$sql" ] || die "could not determine generated pool sql from output"
  if [ "$push" = 1 ]; then load_sql "$sql" remote
  else echo "Generated $sql (not loaded). Run: ./generate.sh load $sql" >&2; fi
}

cmd_tutorials() {
  local push=0
  [ "${1:-}" = "--push" ] && push=1
  npm start -- import-tutorials
  local sql="$ART/seed-tutorials.sql"
  [ -f "$sql" ] || die "expected $sql was not produced"
  if [ "$push" = 1 ]; then load_sql "$sql" remote
  else echo "Generated $sql (not loaded). Run: ./generate.sh load $sql" >&2; fi
}

case "${1:-}" in
  dailies)   shift; cmd_dailies "$@" ;;
  pool)      shift; cmd_pool "$@" ;;
  tutorials) shift; cmd_tutorials "$@" ;;
  verify)    shift; npm start -- verify "$@" ;;
  load)
    shift
    file="${1:-}"; [ -n "$file" ] || die "load: give a .sql file"
    [ "${2:-}" = "--local" ] && load_sql "$file" local || load_sql "$file" remote
    ;;
  *)
    awk 'NR>2 && /^#/ {sub(/^# ?/,""); print; next} NR>2 {exit}' "$0"  # print header comment as help
    exit 2
    ;;
esac
