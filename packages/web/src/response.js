// Response helpers: constructors for the control-flow signals integrations
// interpret — `Location`, `X-Revalidate`, statuses — expressed entirely
// through the standard Response API. More generic than the server function
// transport: client-only actions return these and the integration reads
// the Response in memory (never over HTTP), while server functions return
// (or throw) the same objects and the HTTP handler forwards their
// metadata. No dependency on the codec or the wire format.
//
// The revalidation keys are opaque strings here — whatever keyed cache the
// integration brings assigns them meaning.

// Identity must survive duplicated module instances (e.g. the core entry
// and the server-functions entry bundled separately both carrying a copy),
// so the envelope is detected by a registered-symbol brand, not instanceof.
const ENVELOPE = Symbol.for("solid.ResponseEnvelope");

/**
 * Envelope pairing HTTP metadata with a value. Produced by `respond()` and
 * by server-function `transformResult` implementations (e.g. single-flight
 * payloads); the HTTP handler forwards `response`'s headers and
 * (non-redirect) status and encodes `value` as the body through the codec,
 * while client-only integrations read `value` directly — no reparse.
 */
// PURE-annotated factory (same convention as solid's MockPromise): the brand
// lives on the prototype, but a bare top-level `C.prototype[X] = true` is a
// module side effect that pins the class into every bundle including this
// module — client bundles that never construct or brand-check an envelope
// were retaining it. Wrapping the declaration and the brand assignment in one
// pure expression lets the whole thing shake when unreferenced. (A `static {}`
// block would NOT work: bundlers treat static blocks as side-effectful.)
export const ResponseEnvelope = /* @__PURE__ */ (() => {
  class ResponseEnvelope {
    constructor(response, value) {
      this.response = response;
      this.value = value;
    }
  }
  ResponseEnvelope.prototype[ENVELOPE] = true;
  return ResponseEnvelope;
})();

/** Whether `value` is a `ResponseEnvelope` (robust across module copies). */
export function isResponseEnvelope(value) {
  return !!(value && typeof value === "object" && value[ENVELOPE]);
}

// Brand for URL-bearing values (e.g. a router's typed path objects). Like
// the envelope brand it's a registered symbol so identity survives
// duplicated module instances; `toString()` stays the coercion mechanism
// (attributes, Headers.set, template literals all call it) while the brand
// is the identity mechanism — a bare `{ toString(): string }` is satisfied
// by every object in the language, so without the brand the type would be
// decorative and `redirect(someObject)` would silently put
// "[object Object]" in a Location header.
const HREF = Symbol.for("solid.Href");
export { HREF };

/** Whether `value` is an `Href`-branded URL-bearing value. */
export function isHref(value) {
  return !!(value && (typeof value === "object" || typeof value === "function") && value[HREF]);
}

// Brand marking a thrown value as safe to serialize to the client verbatim.
// The server-function handler sanitizes plain thrown errors in production
// (message/stack/own-properties are dropped) so a driver/ORM error can't
// leak connection strings or queries over the wire; a value carrying this
// brand opts out and travels intact. A registered symbol like the brands
// above so identity survives duplicated module instances. It is symbol-keyed
// and non-enumerable, so it never itself serializes as an own-property.
const SAFE_ERROR = Symbol.for("solid.SafeError");
export { SAFE_ERROR };

/**
 * Marks `error` as safe to serialize to the client verbatim, opting it out
 * of production error sanitization (see `handleServerFunctionRequest`). Use
 * for errors whose message/properties are intentional client-facing content.
 * Returns the same value for convenient `throw markSafeError(new Error(...))`.
 */
export function markSafeError(error) {
  if (error && (typeof error === "object" || typeof error === "function")) {
    Object.defineProperty(error, SAFE_ERROR, {
      value: true,
      enumerable: false,
      configurable: true
    });
  }
  return error;
}

/** Whether `value` is branded safe to serialize (robust across module copies). */
export function isSafeError(value) {
  return !!(
    value &&
    (typeof value === "object" || typeof value === "function") &&
    value[SAFE_ERROR]
  );
}

/**
 * Response header naming the cache keys a mutation invalidated, comma
 * separated. Set by the helpers below and read by the client transport and
 * by integrations; core never inspects the keys, so how they are matched
 * (prefixes, exact names, namespaces) is the integration's business.
 */
export const REVALIDATE_HEADER = "X-Revalidate";

function initWithRevalidate(init) {
  const { revalidate, ...responseInit } = init;
  // Copy preserving multiple Set-Cookie values: Headers-to-Headers copying
  // through the constructor folds them into one comma-joined entry on some
  // runtimes (a folded Set-Cookie is corrupt). Plain-object inits cannot
  // carry duplicates and pass through as-is.
  let headers;
  if (responseInit.headers && responseInit.headers.getSetCookie) {
    headers = new Headers();
    responseInit.headers.forEach((value, key) => {
      if (key !== "set-cookie") headers.append(key, value);
    });
    for (const cookie of responseInit.headers.getSetCookie()) {
      headers.append("Set-Cookie", cookie);
    }
  } else {
    headers = new Headers(responseInit.headers);
  }
  revalidate !== undefined && headers.set(REVALIDATE_HEADER, revalidate.toString());
  return { responseInit, headers };
}

/**
 * Response redirecting to `url` (default 302). `revalidate` names the
 * cache keys the mutation invalidated.
 */
export function redirect(url, init = 302) {
  if (typeof url !== "string" && !isHref(url)) {
    throw new TypeError(
      "redirect() expects a string URL or an Href-branded value (Symbol.for('solid.Href'))."
    );
  }
  const { responseInit, headers } = initWithRevalidate(
    typeof init === "number" ? { status: init } : init
  );
  if (responseInit.status === undefined) {
    responseInit.status = 302;
  }
  headers.set("Location", String(url));
  return new Response(null, { ...responseInit, headers });
}

/**
 * Empty response requesting revalidation of the named cache keys (all of
 * them when omitted).
 */
export function reload(init = {}) {
  const { responseInit, headers } = initWithRevalidate(init);
  return new Response(null, { ...responseInit, headers });
}

/**
 * A value paired with response metadata (status, headers, `revalidate`) —
 * for the things a naked return can't express. Progressive enhancement
 * stays invisible: the carried response holds a plain JSON body so
 * consumers without the client runtime (no-JS form posts, direct HTTP)
 * get real JSON, while integrations read `value` — no reparse.
 */
export function respond(value, init = {}) {
  const { responseInit, headers } = initWithRevalidate(init);
  headers.set("Content-Type", "application/json");
  return new ResponseEnvelope(
    new Response(JSON.stringify(value), { ...responseInit, headers }),
    value
  );
}
