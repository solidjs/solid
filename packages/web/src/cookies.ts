// Cookie wire format: the platform-gap primitives. The web platform hands
// code whole `Cookie`/`Set-Cookie` headers but no codec for the pairs
// inside them — this module is that codec, and it is ALL of core's cookie
// surface: core owns the exchange (the request's headers in, the response
// stub's headers out) and the codec, nothing ambient. The blessed patterns:
//
//   parseCookieHeader(event.request.headers.get("cookie"))
//   event.response.headers.append("set-cookie", serializeCookie(name, value, options))
//
// Dependency-free and isomorphic — nothing here touches an event or the
// platform — and exported from BOTH entries: a pure value transformer has
// legitimate browser uses too (`document.cookie = serializeCookie(...)`,
// parsing `document.cookie`), and a no-op stub would hand back silent
// garbage. The pair codec below stays free of internal client-runtime
// importers, so it enters a client bundle exactly when user code calls it
// and tree-shakes away otherwise (guarded in scripts/size-guard.mjs); the
// flash-cookie helpers at the bottom are the one internal consumer surface
// — regex-matcher based on purpose, so they never retain the pair codec.
//
// Encoding contract: names and values travel `encodeURIComponent`-encoded
// and the parser decodes both, so any string round-trips. No signing, no
// encryption — integrity/confidentiality layers (sessions) belong to the
// caller, on top of these primitives.

export interface CookieOptions {
  /** Cookie `Path` attribute. Defaults to `/`. */
  path?: string;
  /** Cookie `Domain` attribute. Emitted only when provided. */
  domain?: string;
  /** Cookie `Max-Age` attribute, in seconds (truncated to an integer). */
  maxAge?: number;
  /** Cookie `Expires` attribute. */
  expires?: Date;
  /** Emit the `HttpOnly` attribute. */
  httpOnly?: boolean;
  /** Emit the `Secure` attribute. */
  secure?: boolean;
  /** Cookie `SameSite` attribute, any case. */
  sameSite?: "lax" | "strict" | "none" | "Lax" | "Strict" | "None";
  /**
   * Emit the `Partitioned` attribute (CHIPS): a third-party cookie keyed to
   * the top-level site it was set under — the only third-party cookie that
   * keeps working as browsers finish removing the rest. Requires `secure`.
   */
  partitioned?: boolean;
}

/**
 * Parses a `Cookie` request header into a name → value map. Names and
 * values are `decodeURIComponent`-decoded (falling back to the raw text
 * when decoding throws — cookies set by other producers are not
 * necessarily percent-encoded); a quoted value keeps its content, per the
 * RFC 6265 grammar. `null`/empty input parses to an empty map.
 *
 * The read half of the platform gap — the blessed request-cookie read is
 * `parseCookieHeader(event.request.headers.get("cookie"))`.
 */
export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = decodeSafe(part.slice(0, eq).trim());
    let value = part.slice(eq + 1).trim();
    if (value.length > 1 && value[0] === '"' && value[value.length - 1] === '"') {
      value = value.slice(1, -1);
    }
    cookies[name] = decodeSafe(value);
  }
  return cookies;
}

function decodeSafe(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Serializes a cookie to a `Set-Cookie` header value. The name and value
 * are `encodeURIComponent`-encoded (the parser decodes symmetrically);
 * `path` defaults to `/` — the only defaulted attribute — and every other
 * attribute is emitted exactly when the caller asked for it: `domain`,
 * `maxAge` (seconds, truncated to an integer), `expires` (a `Date`),
 * `httpOnly`, `secure`, `sameSite` (`"lax" | "strict" | "none"`, any
 * case).
 *
 * The write half of the platform gap — the blessed response-cookie write
 * is `event.response.headers.append("set-cookie", serializeCookie(name,
 * value, options))`, which every head materialization path carries to the
 * wire entry-by-entry.
 */
// Build-variant dev flag: the string literal is replaced at build time, so
// prod minification drops the guarded branch and the assert behind it — the
// validation costs no production bytes.
const DEV = "_SOLID_DEV_" as unknown as boolean;

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  if (DEV) assertServableCookie(name, options);
  let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
  cookie += `; Path=${options.path === undefined ? "/" : options.path}`;
  if (options.domain) cookie += `; Domain=${options.domain}`;
  if (options.maxAge !== undefined) cookie += `; Max-Age=${Math.trunc(options.maxAge)}`;
  if (options.expires) cookie += `; Expires=${options.expires.toUTCString()}`;
  if (options.httpOnly) cookie += "; HttpOnly";
  if (options.secure) cookie += "; Secure";
  if (options.partitioned) cookie += "; Partitioned";
  if (options.sameSite) {
    const sameSite = options.sameSite.toLowerCase();
    cookie += `; SameSite=${sameSite === "none" ? "None" : sameSite === "strict" ? "Strict" : "Lax"}`;
  }
  return cookie;
}

// Shapes the browser enforces ON ARRIVAL and rejects with no trace — no
// response error, no console line, nothing server-side; the cookie simply
// never comes back (#3138). For a `__Host-` session cookie that reads as
// "the user is never logged in", and the option that breaks it is the one
// you would naturally set (`path: "/admin"` — a sensible-looking scoping
// that silently disables login). Dev refuses to emit them, which is the
// only place the author is ever told; production emits exactly what it is
// handed — the check compiles out, no bytes change. The prefix match is
// case-insensitive, as browsers apply it (RFC 6265bis §4.1.3).
function assertServableCookie(name: string, options: CookieOptions): void {
  const reject = (reason: string) => {
    throw new Error(
      `serializeCookie: every browser silently rejects this cookie — ${reason}. ` +
        `It would never come back on a request, with no error anywhere.`
    );
  };
  const lower = name.toLowerCase();
  if (lower.startsWith("__host-")) {
    if (!options.secure) reject(`the __Host- prefix on \`${name}\` requires \`secure: true\``);
    if (options.path !== undefined && options.path !== "/")
      reject(
        `the __Host- prefix on \`${name}\` requires \`Path=/\` (got \`${options.path}\`) — ` +
          `host-locking is the prefix's whole contract, so it cannot be path-scoped`
      );
    if (options.domain)
      reject(`the __Host- prefix on \`${name}\` forbids \`Domain\` (got \`${options.domain}\`)`);
  } else if (lower.startsWith("__secure-") && !options.secure) {
    reject(`the __Secure- prefix on \`${name}\` requires \`secure: true\``);
  }
  if (options.sameSite && options.sameSite.toLowerCase() === "none" && !options.secure) {
    reject("`SameSite=None` requires `secure: true`");
  }
  if (options.partitioned && !options.secure) {
    reject("`Partitioned` requires `secure: true`");
  }
}

// ---- the flash cookie's isomorphic half ----
//
// Cookie carrying the outcome of a server function call made without the
// client runtime (a no-JS form post), so the page rendered after the
// redirect can show what happened. The name, detection and one-shot
// clearing are cookie utilities and live HERE — integrations (routers)
// consume the cookie eagerly per request from their isomorphic core (the
// clear must be appended before streaming flushes the response headers,
// and an unread outcome must not haunt a later request), and that consumer
// must not touch the server-functions package at all: its client entry is
// the transport + codec, which a router-only app never ships. The codec
// that fills and decodes the cookie is server-only and stays behind the
// server-functions server entry (server-functions/flash.js).
//
// The name carries the `__Host-` prefix because the cookie carries the
// SUBMISSION — a no-JS login form's password rides it as plaintext JSON
// (see the codec's own note on why it is plain JSON) — and the prefix is
// what bounds who can produce one: browsers refuse a `__Host-` cookie that
// names a `Domain`, so a sibling subdomain cannot toss a second `flash`
// entry at the app. It has to be the NAME, not a check at the read: a
// Cookie header is one string and `parseCookieHeader` cannot tell a
// sibling's entry from the app's own, so last-wins hands the render the
// attacker's outcome. The prefix's price is `Secure`, which the encoder
// already required: a no-JS outcome never reaches a plain-http origin, and
// localhost is potentially-trustworthy, so development is unaffected.
export const FLASH_COOKIE = "__Host-flash";

const FLASH_MATCHER = new RegExp(`(?:^|;\\s*)${FLASH_COOKIE}=([^;]+)`);

// Written ONCE, for both directions. The prefix rules bind the set and the
// clear together — a `__Host-` deletion cookie without `Secure` is
// rejected on arrival exactly like the cookie it meant to delete (#3138),
// silently, and the outcome then haunts every later request — so the two
// must not be spelled twice and allowed to drift. `SameSite=Lax` keeps a
// cross-site post's outcome out of the jar entirely.
//
// Spelled out rather than run through `serializeCookie` for the same
// reason the matcher above is a regex and not `parseCookieHeader`: an
// integration that only clears the cookie must not drag the pair codec
// into its client bundle. Nothing here is caller-supplied, so there is no
// combination for that function's dev-time prefix check to catch.
const FLASH_ATTRIBUTES = "Path=/; HttpOnly; Secure; SameSite=Lax";

// One redirect's worth of life. Clearing is the integration's (it consumes
// the cookie eagerly per request, see below), but no integration is
// REQUIRED to exist, and without a lifetime an unread outcome is a session
// cookie at `Path=/`: the submission, in the clear, attached to every
// subsequent request to the origin — assets included — and into every
// access and CDN log, for as long as the browser lives.
const FLASH_MAX_AGE = 60;

/** Whether a Cookie header carries a flash cookie (readable or not). */
export function hasFlashCookie(cookieHeader: string | null): boolean {
  return !!cookieHeader && FLASH_MATCHER.test(cookieHeader);
}

/** The raw encoded flash payload out of a Cookie header, if present. */
export function matchFlashCookie(cookieHeader: string | null): string | undefined {
  const match = cookieHeader && cookieHeader.match(FLASH_MATCHER);
  return match ? match[1] : undefined;
}

/**
 * The `Set-Cookie` value that carries `value` as the flash cookie: the one
 * writer, shared with the clear below so the attributes cannot drift apart.
 */
export function writeFlashCookie(value: string): string {
  return `${FLASH_COOKIE}=${encodeURIComponent(value)}; ${FLASH_ATTRIBUTES}; Max-Age=${FLASH_MAX_AGE}`;
}

/** The Set-Cookie value clearing the flash cookie after it has been read. */
export function clearFlashCookie(): string {
  return `${FLASH_COOKIE}=; ${FLASH_ATTRIBUTES}; Max-Age=0`;
}
