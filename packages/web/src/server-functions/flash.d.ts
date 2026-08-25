/**
 * The outcome of a call made without the client runtime, as it rides the
 * flash cookie: what was submitted, where, and what came back. `result` and
 * `error` are mutually exclusive — a thrown outcome fills `error`, a
 * returned one fills `result` — mirroring the split a scripted call sees.
 */
export interface FlashSubmission {
  /** The arguments the call was made with (files are dropped). */
  input: any[];
  /** The call's url: pathname + search of the server function request. */
  url: string;
  /** The returned value, when the call returned. */
  result?: any;
  /** The thrown value, when the call threw. */
  error?: any;
}

/**
 * Encodes the outcome of a no-JS call as a `Set-Cookie` value, for the
 * handler to send with its redirect. `url` identifies which submission the
 * outcome belongs to; pass `thrown` when the call threw rather than
 * returned.
 *
 * The payload is JSON inside the cookie: `FormData` and `URLSearchParams`
 * arguments are captured as entry pairs and revived on decode, and `File`
 * entries are dropped (they cannot ride a cookie). Keep in mind the 4 KB
 * cookie budget — outcomes larger than that will not survive the round
 * trip.
 */
export function encodeFlashCookie(url: string, result: any, input: any[], thrown?: boolean): string;

/**
 * Decodes the flash cookie out of a request's `Cookie` header, for the
 * render that follows the redirect. Returns undefined when the cookie is
 * absent or unreadable — a malformed cookie never takes down the render,
 * and `clearFlashCookie` should be appended regardless.
 */
export function decodeFlashCookie(cookieHeader: string | null): FlashSubmission | undefined;
