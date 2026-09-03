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
// The payload is JSON rather than the wire codec (it has to survive a 4 KB
// cookie), and the JSON is AES-GCM ENCRYPTED before it becomes the cookie
// value (#3239): the flash carries the submitted form input — whatever the
// user typed, passwords included — and a plaintext cookie leaves that
// readable in proxy logs, in the jar at rest, and on every request it rides
// until cleared. Both codec halves run only on the server (the browser just
// stores and returns the value), so the cookie is an opaque server-to-server
// channel and encrypting it costs consumers nothing but the async signature.

import { FLASH_COOKIE, parseCookieHeader, serializeCookie } from "../../src/cookies.js";

const DEV = "_SOLID_DEV_" === true;

// ---------------------------------------------------------------------------
// Key resolution (#3239). The AES key derives from THE DEPLOYMENT SECRET —
// deliberately not a flash-specific key: the secret is the deployment-wide
// concept, and any future feature that needs a key derives its own from the
// same secret under its own domain string (see FLASH_KEY_DOMAIN below), so
// consumers configure one value, ever. Resolution order:
//
//   1. `configureServerFunctionsServer({ secret })` — the explicit option.
//   2. `globalThis.__SOLID_SECRET__` — the INTERNAL bundler contract: the
//      Solid vite plugin injects `globalThis.__SOLID_SECRET__ ??=
//      "<random-per-build>"` into the app's server entry, so every instance
//      of one deployment shares one secret with zero configuration. Injected
//      into server output only; not public API.
//   3. Neither — there is no way to store the outcome confidentially, so the
//      flash is withheld entirely: the no-JS post still redirects cleanly,
//      only the outcome echo is missing, and dev builds say why once.
//
// The secret must be shared by every instance that can serve the redirect
// that follows the 303 (an ephemeral per-process key would silently lose
// flashes behind a load balancer), which is why there is no generated
// fallback.
let configuredSecret;

export function setFlashSecret(secret) {
  configuredSecret = secret;
}

function resolveSecret() {
  return configuredSecret !== undefined ? configuredSecret : globalThis.__SOLID_SECRET__;
}

// The flash key is a DOMAIN-SEPARATED derivation of the deployment secret:
// SHA-256 over the domain string then the secret's UTF-8 bytes, imported as
// raw AES-256-GCM key material. The digest normalizes arbitrary-length
// secrets to the key size and keeps the secret itself out of the CryptoKey;
// the domain prefix means a future feature deriving its own key from the
// same secret (a different domain string) shares no key material with the
// flash — one secret, per-purpose keys, never cross-decryptable.
const FLASH_KEY_DOMAIN = "solid.flash.v1\0";

let cachedSecret;
let cachedKey;

function resolveFlashKey() {
  const secret = resolveSecret();
  if (typeof secret !== "string" || secret.length === 0) return null;
  if (secret !== cachedSecret) {
    cachedSecret = secret;
    cachedKey = crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(FLASH_KEY_DOMAIN + secret))
      .then(digest =>
        crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])
      );
  }
  return cachedKey;
}

let warnedMissingKey = false;
function warnMissingKey() {
  if (!DEV || warnedMissingKey) return;
  warnedMissingKey = true;
  console.warn(
    "[solid] A no-JS form outcome was not flashed: the flash cookie is encrypted and no key " +
      "is configured. Set configureServerFunctionsServer({ secret }) — or build with the Solid " +
      "bundler plugin, which provides a per-deployment key automatically. The submission " +
      "committed and the redirect was served; only the outcome echo was withheld."
  );
}

// Wire format, versioned for evolution: the cookie value is
// `1.<base64url(iv || ciphertext || tag)>` — a leading format version, a
// 12-byte random IV, then AES-GCM output (whose trailing 16 bytes are the
// auth tag). base64url is cookie-safe as-is, so the value survives
// serializeCookie's percent-encoding byte-for-byte.
const FLASH_FORMAT_VERSION = "1.";
const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

function toBase64url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text) {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function encryptFlashValue(key, json) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(json))
  );
  const packed = new Uint8Array(IV_BYTES + ciphertext.length);
  packed.set(iv);
  packed.set(ciphertext, IV_BYTES);
  return FLASH_FORMAT_VERSION + toBase64url(packed);
}

async function decryptFlashValue(key, value) {
  if (!value.startsWith(FLASH_FORMAT_VERSION)) return;
  const packed = fromBase64url(value.slice(FLASH_FORMAT_VERSION.length));
  if (packed.length <= IV_BYTES + GCM_TAG_BYTES) return;
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: packed.subarray(0, IV_BYTES) },
    key,
    packed.subarray(IV_BYTES)
  );
  return new TextDecoder().decode(plain);
}

/**
 * The outcome of a call made without the client runtime, as it rides the
 * flash cookie: what was submitted, where, and what came back. `result` and
 * `error` are mutually exclusive — a thrown outcome fills `error`, a
 * returned one fills `result` — mirroring the split a scripted call sees.
 */
export interface FlashSubmission {
  /** The arguments the call was made with (files are dropped). */
  input: any[];
  /**
   * The call's url: the UNBOUND function base — the server function
   * request's pathname (`<endpoint>/<id>`), without the `?args=` query a
   * `.with()`-bound form's action carries (or any other query decoration).
   * Matches what the scripted road records as a submission's url, so
   * integrations can match flash and scripted submissions with the same
   * `s.url === fn.base` test; bound arguments arrive in `input` instead,
   * prepended exactly like a scripted call's.
   */
  url: string;
  /** The returned value, when the call returned. */
  result?: any;
  /** The thrown value, when the call threw. */
  error?: any;
  /**
   * Set when the outcome was too large for the cookie's 4 KB ceiling and
   * was degraded to fit (#3137): the input echo is dropped, and `result` /
   * `error` may carry a bounded prefix — or the bare outcome flag `true` —
   * rather than the full value. The submission still says what happened
   * and where; integrations should render it as "succeeded (result too
   * large to display)" rather than replaying the value.
   */
  truncated?: boolean;
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
 * The payload is JSON, AES-GCM encrypted into the cookie value (#3239; see
 * the key resolution notes above — without a configured key the flash is
 * withheld and this returns `null`): `FormData` and `URLSearchParams`
 * arguments are captured as entry pairs and revived on decode, and `File`
 * entries are dropped (they cannot ride a cookie). Outcomes larger than
 * the 4 KB cookie ceiling — measured on the encrypted value the browser
 * stores — are degraded to fit rather than silently lost: the input echo
 * goes first, then the value is bounded, arriving with `truncated` set
 * (#3137). When even the fully-degraded payload cannot fit (a
 * caller-chosen `url` alone past the ceiling), the flash is REFUSED —
 * `null`, no cookie — rather than truncated to a prefix that would attach
 * the outcome to a submission it does not identify (#3249); the handler
 * falls back to the plain redirect.
 */
export function encodeFlashCookie(
  url: string,
  result: any,
  input: any[],
  thrown?: boolean
): Promise<string | null>;

/**
 * Encodes the outcome of a no-JS call as a Set-Cookie value, or `null`
 * when no storable cookie exists for it — the outcome cannot fit the
 * cookie ceiling (#3249), or no encryption key is configured (#3239: the
 * payload carries form input and never rides plaintext; without a key the
 * flash is withheld and dev builds warn once). `url` is the call's url
 * (the unbound function base — the request's pathname) so the integration
 * can tell which submission the outcome belongs to; `thrown` errors land
 * on `error`, returned values on `result`, mirroring the split a scripted
 * call sees.
 */
export async function encodeFlashCookie(url, result, input, thrown) {
  const key = resolveFlashKey();
  if (!key) {
    warnMissingKey();
    return null;
  }
  const isError = result instanceof Error;
  const payload = {
    url,
    result: isError ? result.message : result,
    error: isError,
    thrown: !!thrown,
    input: input.map(encodeInputValue)
  };
  if (fitsCookie(payload)) return flashCookie(payload, await key);
  // A cookie has a hard ceiling and no failure signal: past it the browser
  // discards the whole Set-Cookie — nothing in the response, nothing in the
  // console, nothing server-side — and the page after the redirect is
  // indistinguishable from one where nothing was submitted. The mutation
  // has already COMMITTED by the time this encodes, so the outcome must
  // degrade rather than vanish (#3137): the natural response to a missing
  // confirmation is to retry, and for a non-idempotent handler that is the
  // second write. Ladder: drop the input echo (usually the bulk), then
  // bound the value itself — a string keeps the longest prefix that fits
  // (halving, because percent-encoding inflates unevenly), anything
  // structured has no partial JSON and reduces to the outcome flag `true`.
  // `url` and the error/thrown flags always survive: what happened, and to
  // which submission, is the part that must not be lost.
  payload.truncated = true;
  payload.input = [];
  if (!fitsCookie(payload)) {
    if (typeof payload.result === "string") {
      let prefix = payload.result;
      while (prefix.length > 0 && !fitsCookie({ ...payload, result: prefix })) {
        prefix = prefix.slice(0, prefix.length >> 1);
      }
      payload.result = prefix.length > 0 ? prefix : true;
    } else {
      payload.result = true;
    }
  }
  // The ladder has spent everything it may spend and the payload still does
  // not fit: `url` — an address the CALLER chose (for the no-JS handler,
  // the request's pathname: endpoint mount + function id) — is
  // past the ceiling on its own. It is the identifier of last resort, and a
  // prefix of an identifier is a WRONG identifier: the outcome would attach
  // to a submission it does not name, silently. Emitting the oversized
  // cookie is no better — the browser discards it whole, with `truncated:
  // true` inside asserting a degradation that never stored. So the flash is
  // refused (#3249): no cookie, and the no-JS handler falls back to the
  // plain redirect — the navigation still lands, only the outcome echo is
  // withheld.
  if (!fitsCookie(payload)) return null;
  return flashCookie(payload, await key);
}

// The envelope (#3239): one-shot by design, so `Max-Age=60` bounds how long
// an unconsumed outcome — an interrupted redirect, a closed tab — rests in
// the jar; the consuming render is the very next navigation, milliseconds
// away. `SameSite=Lax` over Strict deliberately: the flash must ride the
// top-level GET that follows the 303 even when that navigation is
// cross-site-initiated, so a stray flash is consumed (and cleared) rather
// than lingering. Lax is not load-bearing for confidentiality — the value
// is ciphertext — nor for CSRF: the origin gate refuses cross-site POSTs
// before the no-JS handler is ever selected, so no flash exists for them.
const FLASH_MAX_AGE_SECONDS = 60;

async function flashCookie(payload, key) {
  return serializeCookie(FLASH_COOKIE, await encryptFlashValue(key, JSON.stringify(payload)), {
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    maxAge: FLASH_MAX_AGE_SECONDS
  });
}

// The browser ceiling is 4096 bytes of `name=value` (RFC 6265bis §5.6);
// RFC 6265 §6.1 states the same number but counts attributes too. 4000 for
// the pair leaves headroom for the attributes under either reading.
const COOKIE_PAIR_BUDGET = 4000;

// The ceiling is measured on what the browser stores: the ENCRYPTED value
// (#3249 composed with #3239). AES-GCM ciphertext length equals plaintext
// length, so the stored size is deterministic from the JSON's UTF-8 byte
// count — version prefix, IV, auth tag, then unpadded base64url inflation —
// and the degradation ladder can still probe fit cheaply on the plaintext
// payload it is shrinking.
function fitsCookie(payload) {
  const plaintextBytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  const packedBytes = IV_BYTES + plaintextBytes + GCM_TAG_BYTES;
  const valueLength = FLASH_FORMAT_VERSION.length + Math.ceil((packedBytes * 4) / 3);
  return FLASH_COOKIE.length + 1 + valueLength <= COOKIE_PAIR_BUDGET;
} /**
 * Decodes the flash cookie out of a request's `Cookie` header, for the
 * render that follows the redirect. Returns undefined when the cookie is
 * absent or unreadable — a malformed cookie never takes down the render,
 * and `clearFlashCookie` should be appended regardless.
 */
export function decodeFlashCookie(
  cookieHeader: string | null
): Promise<FlashSubmission | undefined>;

/**
 * Decodes the flash cookie out of a request's Cookie header. Returns
 * undefined when absent or unreadable — a malformed, tampered, foreign-key
 * or key-less cookie must never take down the render (#3239: decryption
 * failure reads as "no flash"), and it is cleared either way.
 */
export async function decodeFlashCookie(cookieHeader) {
  const match = parseCookieHeader(cookieHeader)[FLASH_COOKIE];
  if (!match) return;
  try {
    const key = resolveFlashKey();
    if (!key) return;
    const json = await decryptFlashValue(await key, match);
    if (json === undefined) return;
    const payload = JSON.parse(json);
    // Structural, not truthy: a well-formed cookie whose result is `""`,
    // `0`, `false` or `null` is a delivered outcome — a truthiness test here
    // discarded it after the encoder wrote it and the browser stored it, and
    // took a thrown `Error("")`'s error flag with it (#3248). Only a payload
    // without the result field at all decodes to nothing, as before.
    if (!payload || typeof payload !== "object" || !("result" in payload)) return;
    const result = payload.error ? new Error(payload.result) : payload.result;
    const submission = {
      input: Array.isArray(payload.input) ? payload.input.map(decodeInputValue) : [],
      url: payload.url,
      result: payload.thrown ? undefined : result,
      error: payload.thrown ? result : undefined
    };
    if (payload.truncated) submission.truncated = true;
    return submission;
  } catch (error) {
    // A cookie that fails to decrypt or parse is not an outcome: a tampered
    // value, a rotated deployment key, or plain garbage all read as "no
    // flash" — and the eager one-shot clear disposes of it either way. Noisy
    // only in dev; a key rotation must not error-log every affected request
    // in production.
    if (DEV) console.error(error);
  }
}
