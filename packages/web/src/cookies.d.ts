// Cookie wire format: the platform-gap primitives, and ALL of core's
// cookie surface — core owns the exchange (the request's headers in, the
// response stub's headers out) and the codec, nothing ambient. Blessed
// patterns:
//
//   parseCookieHeader(event.request.headers.get("cookie"))
//   event.response.headers.append("set-cookie", serializeCookie(name, value, options))
//
// Dependency-free and isomorphic (exported from both entries — real
// implementation, never a stub); integrity/confidentiality layers
// (sessions) belong to the caller, on top of these primitives.

/**
 * Attributes for a `Set-Cookie` header, mirroring RFC 6265. `path`
 * defaults to `/`; nothing else is defaulted.
 */
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
}

/**
 * Parses a `Cookie` request header into a name → value map. Names and
 * values are `decodeURIComponent`-decoded (falling back to the raw text
 * when decoding throws); a quoted value keeps its content. `null`/empty
 * input parses to an empty map.
 *
 * The read half of the platform gap — the blessed request-cookie read is
 * `parseCookieHeader(event.request.headers.get("cookie"))`.
 */
export function parseCookieHeader(header: string | null | undefined): Record<string, string>;

/**
 * Serializes a cookie to a `Set-Cookie` header value. The name and value
 * are `encodeURIComponent`-encoded (the parser decodes symmetrically);
 * `path` defaults to `/` and every other attribute is emitted exactly
 * when the caller asked for it.
 *
 * The write half of the platform gap — the blessed response-cookie write
 * is `event.response.headers.append("set-cookie", serializeCookie(name,
 * value, options))`, which every head materialization path carries to the
 * wire entry-by-entry.
 */
export function serializeCookie(name: string, value: string, options?: CookieOptions): string;

/**
 * Name of the cookie carrying the outcome of a server function call made
 * without the client runtime (`"flash"`). A no-JS form post has no way to
 * receive a value — the browser follows the redirect and renders the next
 * page — so the handler stashes the outcome here for the render after it
 * to pick up, which is how a form submitted without JavaScript still shows
 * its result.
 *
 * The name, detection and clearing are cookie utilities and isomorphic
 * (integrations read the cookie from code that also ships to the browser);
 * the codec that fills and decodes it is server-only and lives behind the
 * server-functions server entry.
 */
export const FLASH_COOKIE: string;

/**
 * Whether a Cookie header carries a flash cookie, readable or not. Cheap
 * enough to call on every render so the clear can be queued before the
 * response headers flush.
 */
export function hasFlashCookie(cookieHeader: string | null): boolean;

/**
 * The `Set-Cookie` value clearing the flash cookie. The outcome is
 * one-shot: append this as soon as the cookie is detected, whether or not
 * it decodes, so a stale outcome cannot resurface on a later request.
 */
export function clearFlashCookie(): string;

/**
 * The raw encoded flash payload out of a Cookie header, if present — the
 * codec's own accessor.
 *
 * @internal
 */
export function matchFlashCookie(cookieHeader: string | null): string | undefined;
