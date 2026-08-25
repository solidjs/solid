// @ts-nocheck
// Codec for the flash cookie: the no-JS leg of the server function
// transport. A form posted without the client runtime has no channel to
// receive a value — the browser follows the redirect and renders the next
// page — so the handler encodes the outcome into a one-shot cookie and the
// render after it decodes the outcome back out, letting an integration show
// the result exactly as it would for a scripted call.
//
// Server-only on both halves: the encode runs in the handler, the decode
// runs during the render of the request that follows. Only the cookie's
// name, detection and clearing are isomorphic — those live beside the
// cookie codec (../cookies.js, exported from the core entries) so
// integrations can consume the cookie from code that also ships to the
// browser without pulling this module — or the server-functions package at
// all — in with it.
//
// The payload is plain JSON rather than the wire codec: it has to survive a
// 4 KB cookie, and both halves here are synchronous while the codec is not.

import { FLASH_COOKIE, parseCookieHeader, serializeCookie } from "../../src/cookies.js";

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

// Form payloads have no JSON encoding, so entries are captured as pair
// arrays under a marker key ($f / $u) and revived to real FormData /
// URLSearchParams on the way out. File entries cannot ride a cookie and are
// dropped.
function encodeInputValue(value) {
  if (value instanceof FormData)
    return { $f: [...value.entries()].filter(([, v]) => typeof v === "string") };
  if (value instanceof URLSearchParams) return { $u: [...value.entries()] };
  return value;
}

function decodeInputValue(value) {
  if (value && typeof value === "object") {
    if (Array.isArray(value.$f)) {
      const form = new FormData();
      for (const [k, v] of value.$f) form.append(k, v);
      return form;
    }
    if (Array.isArray(value.$u)) return new URLSearchParams(value.$u);
  }
  return value;
} /**
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
 * Encodes the outcome of a no-JS call as a Set-Cookie value. `url` is the
 * call's url (pathname + search of the server function request) so the
 * integration can tell which submission the outcome belongs to; `thrown`
 * errors land on `error`, returned values on `result`, mirroring the split
 * a scripted call sees.
 */
export function encodeFlashCookie(url, result, input, thrown) {
  const isError = result instanceof Error;
  const payload = {
    url,
    result: isError ? result.message : result,
    error: isError,
    thrown: !!thrown,
    input: input.map(encodeInputValue)
  };
  return serializeCookie(FLASH_COOKIE, JSON.stringify(payload), { secure: true, httpOnly: true });
} /**
 * Decodes the flash cookie out of a request's `Cookie` header, for the
 * render that follows the redirect. Returns undefined when the cookie is
 * absent or unreadable — a malformed cookie never takes down the render,
 * and `clearFlashCookie` should be appended regardless.
 */
export function decodeFlashCookie(cookieHeader: string | null): FlashSubmission | undefined;

/**
 * Decodes the flash cookie out of a request's Cookie header. Returns
 * undefined when absent or unreadable — a malformed cookie must never take
 * down the render, and it is cleared either way.
 */
export function decodeFlashCookie(cookieHeader) {
  const match = parseCookieHeader(cookieHeader)[FLASH_COOKIE];
  if (!match) return;
  try {
    const payload = JSON.parse(match);
    if (!payload || !payload.result) return;
    const result = payload.error ? new Error(payload.result) : payload.result;
    return {
      input: Array.isArray(payload.input) ? payload.input.map(decodeInputValue) : [],
      url: payload.url,
      result: payload.thrown ? undefined : result,
      error: payload.thrown ? result : undefined
    };
  } catch (error) {
    console.error(error);
  }
}
