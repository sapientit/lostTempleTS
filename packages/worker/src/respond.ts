/**
 * ApiResponse envelope construction + Cache-Control policy helpers.
 * Optional envelope fields are ABSENT (never null) to match kotlinx's
 * encodeDefaults=false omission (S§2). Compact JSON — whitespace is not
 * part of the contract.
 */

import type { ApiResponse } from "@losttemple/core";

export const CACHE_A_DAY = "public, max-age=86400";
export const NO_STORE = "no-store";

export function respond(
  status: number,
  body: ApiResponse,
  cacheControl: string | null,
  cors: Record<string, string>,
): Response {
  const headers: Record<string, string> = {
    ...cors,
    "Content-Type": "application/json; charset=utf-8",
  };
  if (cacheControl !== null) headers["Cache-Control"] = cacheControl;
  return new Response(JSON.stringify(body), { status, headers });
}
