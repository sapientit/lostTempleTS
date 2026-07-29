#!/usr/bin/env bash
#
# generate.sh — convenience wrapper around the pregen CLI (src/cli.ts).
#
# The pregen CLI is the ONLY writer of island rows. Every generating command
# emits an idempotent INSERT-OR-REPLACE .sql (+ .jsonl manifest) under
# artifacts/sql/. Loading into D1 is always a separate, explicit step. This
# script bundles "generate + (optionally) load" so the routine — especially
# topping up daily challenges — is one findable command.
#
#   ./generate.sh dailies [DAYS] [--dev|--live]   # add the next DAYS of dailies (default 14)
#   ./generate.sh pool --level L --count N [--dev|--live]
#   ./generate.sh tutorials [--dev|--live]        # regenerate the tutorial/training maps
#   ./generate.sh load <file.sql> --dev|--live    # load an already-generated .sql
#   ./generate.sh verify                          # replay-check the manifests in artifacts/sql
#
# Every command that can touch D1 requires an EXPLICIT --dev or --live — there
# is no default, so a bare command only ever generates the .sql and touches
# nothing:
#   --dev   loads into the LOCAL dev D1 (packages/worker's `wrangler dev
#           --persist-to .wrangler/state`), no prompt.
#   --live  loads into the LIVE remote D1, after a confirmation prompt.
# Neither flag: prints the .sql path and both follow-up commands; it is never
# implicitly pushed anywhere.
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
# pregen has no wrangler.toml of its own; the D1 binding lives in the worker
# package's config, so every wrangler invocation points at it explicitly —
# this must work regardless of which directory the wrangler subprocess runs
# from.
WRANGLER_CONFIG=../worker/wrangler.toml

die()  { echo "error: $*" >&2; exit 1; }
info() { echo ">> $*" >&2; }

# Add N days to a YYYY-MM-DD date using BSD date (macOS).
add_days() { date -j -v+"$2"d -f "%Y-%m-%d" "$1" "+%Y-%m-%d"; }
today()    { date "+%Y-%m-%d"; }

# Parse a --dev/--live flag out of "$@", dying on anything else (both given,
# e.g.). Sets the globals TARGET ("dev", "live", or "" if neither given) and
# PASSTHRU (remaining args) directly — NOT via command substitution: this
# must run in the caller's own shell, not a subshell, or its array/variable
# assignments would vanish the moment the subshell exits.
TARGET=""
PASSTHRU=()
parse_target() {
  TARGET=""
  PASSTHRU=()
  local a
  for a in "$@"; do
    case "$a" in
      --dev)
        [ -z "$TARGET" ] || die "pass only one of --dev / --live"
        TARGET=dev
        ;;
      --live)
        [ -z "$TARGET" ] || die "pass only one of --dev / --live"
        TARGET=live
        ;;
      *) PASSTHRU+=("$a") ;;
    esac
  done
}

# `set --` only rebinds the CURRENT function's positional params, so this
# can't be factored into a helper function — each caller below inlines:
#   if [ "${#PASSTHRU[@]}" -gt 0 ]; then set -- "${PASSTHRU[@]}"; else set --; fi
# (guarded per the bash 3.2 note above).

# Load a .sql file into D1. target must be exactly "dev" or "live" — there is
# no default, so a typo or omission fails loudly instead of silently picking
# a side.
load_sql() {
  local file="$1" target="$2"
  [ -f "$file" ] || die "no such sql file: $file"
  case "$target" in
    dev)
      info "loading $file into LOCAL dev D1"
      npx wrangler d1 execute "$DB" --local --config "$WRANGLER_CONFIG" --file "$file"
      ;;
    live)
      echo "About to load into the LIVE D1 ($DB --remote):" >&2
      echo "    $file" >&2
      read -r -p "Proceed? [y/N] " ok
      [ "$ok" = "y" ] || [ "$ok" = "Y" ] || die "aborted"
      npx wrangler d1 execute "$DB" --remote --config "$WRANGLER_CONFIG" --file "$file"
      ;;
    *)
      die "load_sql: target must be 'dev' or 'live', got '$target'"
      ;;
  esac
}

# What to print when a generating command is run with neither --dev nor
# --live: the .sql was written, nothing was loaded, here's exactly how to.
announce_unloaded() {
  local sql="$1"
  echo "Generated $sql (not loaded). To load it:" >&2
  echo "    ./generate.sh load $sql --dev     # local dev D1 only" >&2
  echo "    ./generate.sh load $sql --live    # LIVE remote D1 (prompts to confirm)" >&2
}

# Find the newest daily end-date already generated (the "to" date embedded in
# the latest seed-dailies-<from>-<to>.sql filename). Empty if none exist.
last_daily_date() {
  ls "$ART"/seed-dailies-*.sql 2>/dev/null \
    | sed -E 's/.*seed-dailies-[0-9]{4}-[0-9]{2}-[0-9]{2}-([0-9]{4}-[0-9]{2}-[0-9]{2})\.sql/\1/' \
    | sort | tail -n1
}

cmd_dailies() {
  local days=14
  parse_target "$@"
  local target="$TARGET"
  if [ "${#PASSTHRU[@]}" -gt 0 ]; then set -- "${PASSTHRU[@]}"; else set --; fi
  for a in "$@"; do
    case "$a" in
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
  if [ -n "$target" ]; then load_sql "$sql" "$target"; else announce_unloaded "$sql"; fi
}

cmd_pool() {
  parse_target "$@"
  local target="$TARGET"
  if [ "${#PASSTHRU[@]}" -gt 0 ]; then set -- "${PASSTHRU[@]}"; else set --; fi
  # pool prints "wrote <path> ..."; capture it to know what to load.
  local out
  out="$(npm start -- pool "$@" | tee /dev/stderr)"
  local sql
  sql="$(echo "$out" | sed -nE 's/^wrote (.*\.sql).*/\1/p' | tail -n1)"
  [ -n "$sql" ] || die "could not determine generated pool sql from output"
  if [ -n "$target" ]; then load_sql "$sql" "$target"; else announce_unloaded "$sql"; fi
}

cmd_tutorials() {
  parse_target "$@"
  local target="$TARGET"
  if [ "${#PASSTHRU[@]}" -gt 0 ]; then set -- "${PASSTHRU[@]}"; else set --; fi
  [ "$#" -eq 0 ] || die "unknown tutorials arg: $1"
  npm start -- import-tutorials
  local sql="$ART/seed-tutorials.sql"
  [ -f "$sql" ] || die "expected $sql was not produced"
  if [ -n "$target" ]; then load_sql "$sql" "$target"; else announce_unloaded "$sql"; fi
}

case "${1:-}" in
  dailies)   shift; cmd_dailies "$@" ;;
  pool)      shift; cmd_pool "$@" ;;
  tutorials) shift; cmd_tutorials "$@" ;;
  verify)    shift; npm start -- verify "$@" ;;
  load)
    shift
    file="${1:-}"; [ -n "$file" ] || die "load: give a .sql file"
    shift || true
    parse_target "$@"
    [ -n "$TARGET" ] || die "load: give exactly one of --dev or --live (no default — nothing loads without one)"
    load_sql "$file" "$TARGET"
    ;;
  *)
    awk 'NR>2 && /^#/ {sub(/^# ?/,""); print; next} NR>2 {exit}' "$0"  # print header comment as help
    exit 2
    ;;
esac
