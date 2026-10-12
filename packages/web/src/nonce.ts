// CSP nonce projection: one destination's half of a render `nonce`, for the
// surfaces that take a single nonce string. Pure and isomorphic, so both
// entries export this one implementation, like the cookie codec: a document
// rendered on both sides can call it, and client builds that don't call it
// tree-shake it away.
import type { CSPNonce } from "./server-mock.js";

function destinationNonce(
  nonce: CSPNonce | null | undefined,
  destination: "script" | "style"
): string | undefined {
  if (nonce == null) return undefined;
  if (typeof nonce === "string") return nonce || undefined;
  const value = nonce[destination];
  return typeof value === "string" && value ? value : undefined;
}

/** The script-destination half of a render `nonce`. */
export function scriptNonce(nonce?: CSPNonce | null): string | undefined {
  return destinationNonce(nonce, "script");
}

/** The style-destination half of a render `nonce`. */
export function styleNonce(nonce?: CSPNonce | null): string | undefined {
  return destinationNonce(nonce, "style");
}
