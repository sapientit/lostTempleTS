/**
 * Strict parsing helpers matching Kotlin semantics (PORTING.md §9.6):
 * String.toIntOrNull (sign + digits only, Int32 range) and strict ISO
 * LocalDate.parse with real calendar validation.
 */

export const DAY_MS = 86_400_000;
export const DAILY_START_MS = Date.UTC(2026, 0, 1); // DailyIslands.START_DATE

/** Kotlin String.toIntOrNull: optional sign, digits, must fit in Int32. */
export function toIntOrNull(s: string | null | undefined): number | null {
  if (s == null || !/^[+-]?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n > 2147483647 || n < -2147483648) return null;
  return n;
}

/** Strict YYYY-MM-DD -> UTC-midnight epoch ms, or null (LocalDate.parse parity). */
export function parseIsoDateMs(s: string | null | undefined): number | null {
  if (s == null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return ms;
}

/** UTC midnight of "now". */
export function todayUtcMs(now: number): number {
  return Math.floor(now / DAY_MS) * DAY_MS;
}

/** Day number since the daily epoch for a UTC-midnight ms timestamp. */
export function dayNumber(dateMs: number): number {
  return Math.round((dateMs - DAILY_START_MS) / DAY_MS);
}
