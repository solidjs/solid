// Client half of the server function runtime ABI. Compiled client output
// calls `createServerReference(id)` where a server function was referenced;
// the function body never reaches this bundle. Hoisted from SolidStart's
// fns/client.ts with neutral header names and a configurable endpoint.
import { REVALIDATE_HEADER } from "../response.js";
import {
  BODY_FORMAT_HEADER,
  BodyFormat,
  ERROR_HEADER,
  FUNCTION_HEADER,
  INSTANCE_HEADER,
  LIVE_SOURCE,
  SERVER_FUNCTION_METADATA,
  SINGLE_FLIGHT_HEADER,
  configureServerFunctionsCodec,
  decodeResponse,
  getFlightDataConsumer,
  getHeadersAndBody,
  getServerFunctionMetadata,
  isJSONSafe,
  isServerFunction,
  provideServerFunctionRPC,
  withMeta
} from "./shared.js";

// The flash cookie's name, detection and clearing are re-exported here so
// isomorphic integration code imports them from one specifier; the codec
// that fills the cookie is server-only and stays behind the server entry.
export {
  // Wire-protocol utilities re-exported for the frame transport: an
  // integration whose bundling would otherwise give the transport a private
  // copy of this module (solid-web's frames client) resolves its shared.js
  // import HERE instead — one copy of the framing/addressing code in the
  // app, and the codec/flight-consumer config the transport reads is the
  // shared built instance by construction.
  ChunkReader,
  ERROR_HEADER,
  FLASH_COOKIE,
  FUNCTION_HEADER,
  INSTANCE_HEADER,
  SINGLE_FLIGHT_HEADER,
  clearFlashCookie,
  createChunk,
  decodeErrorHeaderValue,
  decodeResponse,
  decodeResponsePayload,
  deserializeStream,
  encodeErrorHeaderValue,
  frameAddress,
  getFlightDataConsumer,
  getServerFunctionMetadata,
  getServerFunctionsCodec,
  hasFlashCookie,
  isServerFunction,
  // the rich-args entry's codec write half: its bundled form (solid-web's
  // server-functions/dist/rich-args.js) resolves shared.js imports here so
  // the codec config it reads is the shared built instance
  serializeString,
  subscribeFlightData,
  withMeta
} from "./shared.js";
export { REVALIDATE_HEADER } from "../response.js";

const config = {
  endpoint: "/_server",
  prepareRequest: undefined,
  responseHandler: undefined,
  serializeArgs: undefined
};

const CALL_OBSERVERS = new Set();

function notifyCallObservers(type, id, instance, value, meta) {
  if (CALL_OBSERVERS.size === 0) return;
  const field = type === "request" ? "request" : "response";
  const time = performance.now();
  for (const observer of new Set(CALL_OBSERVERS)) {
    try {
      observer({ type, id, instance, [field]: value.clone(), meta, time });
    } catch (error) {
      console.error(error);
    }
  }
}

export function observeServerFunctionCalls(observer) {
  CALL_OBSERVERS.add(observer);
  return () => CALL_OBSERVERS.delete(observer);
}

function serializeArguments(args) {
  if (!config.serializeArgs) {
    throw new Error(
      "Server function arguments are sent as JSON by default and these " +
        "arguments are not JSON-serializable. Call enableRichArguments() " +
        '(from "@solidjs/web/server-functions/rich-args") once at startup ' +
        "to send Dates, Maps, Sets, typed arrays, etc. through the codec — " +
        "or pass a single Blob/FormData/File argument, which has a native " +
        "HTTP encoding."
    );
  }
  return config.serializeArgs(args);
}

/**
 * Configures the transport before any server function is called: the
 * endpoint the server handler is mounted on, the codec options (extra
 * plugins etc. — must match the server's; stored in the shared layer so
 * `decodeResponse` sees them too), and the `prepareRequest` hook applied
 * to every outgoing server-function fetch (session-dynamic transport
 * policy — bearer tokens, tracing headers).
 *
 * `responseHandler` is the response-side integration seam — the client
 * mirror of the handler's `transformResult`. `handle(response, ctx)` sees
 * every response before the transport decodes it; returning anything but
 * undefined resolves the call with that value instead. `capture(info)`
 * runs synchronously at the call site, before any await, and its return
 * arrives as `ctx.context` — ambient per-call state (e.g. a reactive
 * owner) survives to response time even though handling is async.
 */
export function configureServerFunctionsClient({
  endpoint,
  codec,
  prepareRequest,
  responseHandler,
  serializeArgs
} = {}) {
  if (endpoint !== undefined) config.endpoint = endpoint;
  if (codec !== undefined) configureServerFunctionsCodec(codec);
  if (prepareRequest !== undefined) config.prepareRequest = prepareRequest;
  if (responseHandler !== undefined) config.responseHandler = responseHandler;
  if (serializeArgs !== undefined) config.serializeArgs = serializeArgs;
}

let INSTANCE = 0;

// Fills the late-bound RPC seam (registry.js) with this transport's
// surface. Called from createServerReference/GET — the code compiled
// `'use server'` output invokes at module scope — NOT at this module's own
// scope: routers import codec-free helpers from the same built entry, and a
// top-level registration would be an unshakeable side effect pinning `GET`,
// `decodeResponse` and the codec behind them into every such bundle. Hung
// off the reference constructors, the whole transport (seroval included)
// tree-shakes away unless a reference actually exists — and when one does,
// the seam is filled before any integration code can hold it.
let rpcProvided = false;
function provideRPC() {
  if (rpcProvided) return;
  rpcProvided = true;
  provideServerFunctionRPC({ GET, decodeResponse });
}

function serverFunctionFailure(response, value) {
  const error = value ?? new Error(`Server function call failed with status ${response.status}`);
  // Stamp the HTTP status so policy layers (live retry loops, router
  // channels) can classify the failure: 4xx is a definite rejection that
  // retrying cannot change, 5xx/status-less is transient. An error that
  // already carries a status (app-authored) keeps its own.
  if (error instanceof Error && !("status" in error)) error.status = response.status;
  return error;
}

async function createRequest(base, id, instance, options, meta) {
  const headers = {
    ...options.headers,
    [FUNCTION_HEADER]: id,
    [INSTANCE_HEADER]: instance
  };
  // Subscribing to flight data IS the single-flight opt-in: with a consumer
  // registered the transport asks the server for collection on every
  // mutation call; a consumer-less app never asks the server to do
  // collection work. GET-encoded calls are reads (cacheable URLs) and stay
  // plain — folding per-request flight data into them would defeat caching.
  // `read: true` marks a POST-shaped call as a read the same way (e.g.
  // live sources: streams have no envelope story and flight hooks are
  // mutation policy).
  if (
    getFlightDataConsumer() &&
    !options.read &&
    (!options.method || options.method.toUpperCase() !== "GET")
  ) {
    headers[SINGLE_FLIGHT_HEADER] = "true";
  }
  let init = {
    method: "POST",
    ...options,
    headers
  };
  // The session-dynamic transport hook runs last, over the final
  // RequestInit (transport headers included), so session policy can adjust
  // anything the transport is about to send.
  if (config.prepareRequest) {
    init = (await config.prepareRequest(init, { id, meta })) || init;
  }
  if (CALL_OBSERVERS.size === 0) return fetch(base, init);

  const request = new Request(new URL(base, globalThis.location?.href || "http://localhost"), init);
  notifyCallObservers("request", id, instance, request, meta);
  const response = await fetch(request);
  notifyCallObservers("response", id, instance, response, meta);
  return response;
}

async function initializeResponse(base, id, instance, options, args, meta) {
  // No args, skip serialization
  if (args.length === 0) {
    return createRequest(base, id, instance, options, meta);
  }
  // A single argument with a natural HTTP encoding goes as-is
  if (args.length === 1) {
    const result = getHeadersAndBody(args[0]);
    if (result) {
      return createRequest(
        base,
        id,
        instance,
        {
          ...options,
          body: result.body,
          headers: {
            ...options.headers,
            ...result.headers
          }
        },
        meta
      );
    }
  }
  // JSON-safe argument lists go as plain JSON — no codec on the wire, and
  // (because nothing else here references the serializer) no serialize-half
  // of the codec in the bundle. The try mirrors the server's encodeResult:
  // isJSONSafe answers "not safe" for cycles/depth instead of throwing, so
  // this only catches what negotiation can still hit (a throwing getter,
  // an engine limit) — falling through to the codec below, never rejecting
  // the call over the format choice itself.
  try {
    if (isJSONSafe(args)) {
      return createRequest(
        base,
        id,
        instance,
        {
          ...options,
          body: JSON.stringify(args),
          headers: {
            ...options.headers,
            "Content-Type": "application/json",
            [BODY_FORMAT_HEADER]: BodyFormat.Json
          }
        },
        meta
      );
    }
  } catch {
    // fall through to the codec
  }
  // Bound calls ending in a natural HTTP encoding — `action.with(id)`
  // posting FormData/URLSearchParams — reuse the server-rendered form-post
  // convention: JSON-safe leading arguments ride the url's `?args` (the
  // handler prepends url arguments before natural-encoding bodies) and the
  // trailing argument IS the body. The same wire shape the no-JS fallback
  // produces, so bound form actions need no codec. `undefined` coerces to
  // null exactly as it does in a rendered action url (JSON has none).
  if (args.length > 1) {
    try {
      const trailing = getHeadersAndBody(args[args.length - 1]);
      const leading = args.slice(0, -1).map(arg => (arg === undefined ? null : arg));
      if (trailing && isJSONSafe(leading)) {
        const target =
          base +
          (base.includes("?") ? "&" : "?") +
          "args=" +
          encodeURIComponent(JSON.stringify(leading));
        return createRequest(
          target,
          id,
          instance,
          {
            ...options,
            body: trailing.body,
            headers: {
              ...options.headers,
              ...trailing.headers
            }
          },
          meta
        );
      }
    } catch {
      // same contract as above — negotiation failures fall to the codec
    }
  }
  // Everything else needs the codec, which is opt-in (enableRichArguments).
  return createRequest(
    base,
    id,
    instance,
    {
      ...options,
      body: await serializeArguments(args),
      headers: {
        ...options.headers,
        "Content-Type": "text/plain",
        [BODY_FORMAT_HEADER]: BodyFormat.Serialized
      }
    },
    meta
  );
}

// `args` is the wire encoding's argument list; `callArgs` is the call's REAL
// arguments for the handler's context. They differ for GET calls, whose
// arguments ride pre-encoded in the url (wire args empty) — a handler keying
// state by the call (function + arguments) must still see the real ones.
async function fetchServerFunction(base, id, options, args, meta, callArgs = args) {
  const instance = `server-function:${INSTANCE++}`;
  // Captured synchronously at the call site (an async function body runs
  // sync up to its first await), so ambient call context is still live.
  const handler = config.responseHandler;
  const context = handler && handler.capture ? handler.capture({ id, meta }) : undefined;

  // The call owns an AbortController so a streaming result can be ENDED, not
  // just abandoned: `iterator.return()` on the received iterable aborts the
  // fetch, which closes the response body here (settling the codec's
  // bookkeeping through the drain's failure sweep) and fires
  // `request.signal` on the server (tearing the producer down). Only minted
  // when the caller didn't bring a signal — a caller-supplied signal already
  // owns the wire, and cancellation stays theirs.
  const controller = options.signal ? undefined : new AbortController();
  if (controller) options = { ...options, signal: controller.signal };

  const response = await initializeResponse(base, id, instance, options, args, meta);

  // The integration seam sees the response first: a handler that claims it
  // (returns non-undefined) owns the call's result.
  if (handler) {
    const handled = handler.handle(response, { id, meta, args: callArgs, context });
    if (handled !== undefined) return handled;
  }

  // Proxies may omit the protocol error header on 5xx responses.
  const failed = response.headers.has(ERROR_HEADER) || response.status >= 500;

  // Single-flight responses: with a registered consumer the transport owns
  // the unwrap — the standardized `{ value, data }` body is decoded, `data`
  // is delivered to the consumer (with the response as envelope context:
  // redirect location, revalidation keys, status), and `value` returns to
  // the caller as if the call were plain. Error semantics mirror the
  // passthrough path below: responses carrying integration metadata
  // (Location/X-Revalidate) are control flow for the consumer to interpret,
  // bare error-tagged ones throw the value.
  if (response.headers.has(SINGLE_FLIGHT_HEADER)) {
    const consumer = getFlightDataConsumer();
    if (consumer) {
      const payload = await decodeResponse(response);
      await consumer(payload.data, { response });
      if (failed && !response.headers.has("Location") && !response.headers.has(REVALIDATE_HEADER)) {
        throw serverFunctionFailure(response, payload.value);
      }
      return payload.value;
    }
  }

  // Responses the caller's integration needs to see whole (redirects,
  // revalidation, single-flight payloads without a registered consumer)
  // pass through untouched — the integration decodes the body itself with
  // `decodeResponse`.
  if (
    response.headers.has("Location") ||
    response.headers.has(REVALIDATE_HEADER) ||
    response.headers.has(SINGLE_FLIGHT_HEADER)
  ) {
    return response;
  }

  const result = await decodeResponse(response.clone());
  if (failed) {
    throw serverFunctionFailure(response, result);
  }
  // Streaming result: wrap so stopping consumption stops the CALL. Without
  // this, `return()` (a `break` in for-await) only detaches the local
  // iterator — the fetch keeps downloading and the server keeps producing.
  // Top-level only, matching the server's value-tier teardown scope.
  if (controller && result?.[Symbol.asyncIterator]) {
    return {
      [Symbol.asyncIterator]() {
        const it = result[Symbol.asyncIterator]();
        return {
          next: () => it.next(),
          return: value => (controller.abort(), Promise.resolve({ done: true, value }))
        };
      }
    };
  }
  return result;
}

/**
 * Produces the client-side callable for a server function id. The returned
 * proxy exposes `id` (the build-stable function id) and `url` (direct HTTP
 * invocation — form actions, progressive enhancement) and carries the
 * declaration-metadata brand so `isServerFunction` recognizes it.
 *
 * Development output passes the function's source name as the trailing
 * argument; it seeds the metadata channel as a default — explicit
 * `withMeta`/`GET` writes shallow-merge over it like any other write.
 */
export function createServerReference(id, name, base) {
  provideRPC();
  const metadata = name === undefined ? {} : { name };
  // An explicit base targets that url verbatim — integrations reconstructing
  // a callable from a server-rendered action url (`?id=...&args=...`) keep
  // its bound arguments in the query string, where the server reads them
  // for natural-encoding bodies. Default calls derive from the configured
  // endpoint (lazily — it may be configured after module scope runs).
  const fn = (...args) => {
    // Local-answer seam, SYNCHRONOUS on purpose: an integration that already
    // holds this call's result (e.g. a document-SSR'd server-component
    // boundary at hydration time) answers without a promise — so async
    // consumers (dynamic under a hydrating Loading) never observe a pending
    // beat that would commit them to a fallback and discard SSR'd content.
    const handler = config.responseHandler;
    if (handler && handler.intercept) {
      const hit = handler.intercept({ id, meta: metadata, args });
      if (hit !== undefined) return hit;
    }
    return fetchServerFunction(base || config.endpoint, id, {}, args, metadata);
  };
  fn[SERVER_FUNCTION_METADATA] = metadata;

  return new Proxy(fn, {
    get(target, prop) {
      if (prop === "id") return id;
      if (prop === "url") {
        return base || `${config.endpoint}?id=${encodeURIComponent(id)}`;
      }
      return target[prop];
    }
  });
}

/**
 * Declares a server function callable over HTTP GET: calls to the returned
 * reference go out as GET requests with the arguments codec-encoded in the
 * query string — cacheable by HTTP infrastructure. The declaration is
 * recorded on the metadata channel (`getServerFunctionMetadata(fn).method
 * === "GET"`) for routers and integrations to read, and the server half
 * honors it: the declaration grants GET dispatch without revoking the
 * default POST transport, while GET requests to undeclared functions
 * answer 405.
 *
 * Wrap the reference at its declaration; the compiler round-trips the call
 * in both builds:
 *
 * ```ts
 * export const getUser = GET(async (id: string) => {
 *   "use server";
 *   return db.users.find(id);
 * });
 * ```
 */
export function GET(fn) {
  if (!isServerFunction(fn)) {
    throw new Error("GET expects a server function reference");
  }
  provideRPC();
  const id = fn.id;
  // the GET-transport callable inherits the source reference's declared
  // metadata (withMeta composes with GET in either order)
  const metadata = { ...getServerFunctionMetadata(fn) };
  const wrapped = async (...args) => {
    const handler = config.responseHandler;
    if (handler && handler.intercept) {
      const hit = handler.intercept({ id, meta: metadata, args });
      if (hit !== undefined) return hit;
    }
    let base = `${config.endpoint}?id=${encodeURIComponent(id)}`;
    if (args.length) {
      // The handler's GET path accepts both encodings: plain JSON and the
      // codec's framed string (distinguished by the `;0x` frame prefix).
      const encoded = isJSONSafe(args) ? JSON.stringify(args) : await serializeArguments(args);
      base += `&args=${encodeURIComponent(encoded)}`;
    }
    return fetchServerFunction(base, id, { method: "GET" }, [], metadata, args);
  };
  wrapped[SERVER_FUNCTION_METADATA] = metadata;
  wrapped.id = id;
  // lazy like the base proxy's: the endpoint may be configured after the
  // module-scope GET(...) call runs
  Object.defineProperty(wrapped, "url", {
    get: () => `${config.endpoint}?id=${encodeURIComponent(id)}`,
    configurable: true
  });
  // the declaration itself is a metadata write like any other
  return withMeta(wrapped, { method: "GET" });
}

/**
 * Declares a value-shaped live source: a server function returning an async
 * iterable whose yields are successive VALUES of one logical query. The
 * declaration buys the wire-level lifecycle a raw stream doesn't have:
 * calls to the returned reference produce an iterable that survives the
 * connection — when the stream dies (network drop, server restart; the
 * rejections the transport's failure wiring produces) it re-invokes the
 * function with exponential backoff and keeps yielding, resetting the
 * backoff on every healthy value. A failure on the FIRST connect still
 * rejects like a normal call (a typo shouldn't retry silently), normal
 * completion completes the iterable, and `break` aborts the in-flight
 * request through the transport's return() wiring.
 *
 * Deliberately wire-level ONLY. Each iteration of the returned iterable is
 * its own connection (that's what makes reconnect trivial); sharing is the
 * reactive graph's job — ONE call site consumes the stream and every
 * reader of that memo shares its latest value, so sharing across the tree
 * means hoisting the memo, the same idiom as any fetch. There is no cached
 * value by design: the value-shaped contract makes the SERVER the cache —
 * every (re)connect re-yields current state as its first value. This is
 * the wire contract a data layer builds ON, not a data layer itself: a
 * router-level live query can hold ONE iteration open and multicast it
 * (keying, replay-latest, refcounts all channel-side), and its refresh
 * stays honest — close the iteration, open a new one, fresh connection by
 * construction. There is no revalidation here (a live source self-updates;
 * a mutation's effects arrive through the open stream) and hence no
 * single-flight participation (live calls are reads and never request
 * enveloping). All behavior lives inside this declaration — apps that
 * never import `live` carry none of it. Compose with `GET` inside-out
 * (`live(GET(fn))`): live must be the outermost declaration, since its
 * behavior wraps the call.
 *
 * Wire state, if a UI wants it, rides an optional `onstatus` hook on the
 * returned iterable — a side channel for the facts the retry loop
 * deliberately erases from the value stream: `"connected"` on each
 * successful (re)connect, `"reconnecting"` (with the error) on each
 * post-connect death, `"closed"` when the source completes or the
 * consumer ends it. Retry is for transient deaths only: a definite
 * rejection (4xx — the server understood and refused) fails fast, firing
 * `"closed"` with the error and rejecting the consumer's pull.
 * First-connect failures emit nothing (the rejection
 * already surfaces through the call). The hook is per CALL: iterating one
 * object twice interleaves both lifecycles into it. Data freshness is
 * usually the better question and belongs in the value (timestamps /
 * heartbeats) — the hook is for genuinely wire-shaped UI.
 *
 * ```ts
 * export const stockPrice = live(async function* (symbol: string) {
 *   "use server";
 *   for await (const tick of subscribe(symbol)) yield tick.price;
 * });
 *
 * // consumer, wiring status to a signal:
 * const src = stockPrice("ACME");
 * src.onstatus = setStatus;
 * const price = createMemo(() => src);
 * ```
 */
export function live(fn) {
  if (!isServerFunction(fn)) {
    throw new Error("live expects a server function reference");
  }
  const id = fn.id;
  const metadata = { ...getServerFunctionMetadata(fn), live: true };
  const wrapped = (...args) => {
    const iterable = {
      [LIVE_SOURCE]: true,
      [Symbol.asyncIterator]() {
        let it; // current underlying iterator (undefined between connections)
        let connected = false; // a connect succeeded once — later deaths reconnect
        let attempts = 0;
        let stopped = false;
        let ended = false; // "closed" fires exactly once per iteration
        let timer, wake; // interruptible backoff sleep
        const DONE = { done: true, value: undefined };
        // Wire-state side channel: the retry loop erases deaths from the
        // value stream BY DESIGN (encapsulated reconnect), so the hook is
        // the only place downstream can learn them. Read late (at fire
        // time) so consumers can assign after receiving the object; a
        // throwing hook must not corrupt the loop. Facts only the
        // transport knows: "connected" (each successful (re)connect),
        // "reconnecting" (each post-connect death, with the error),
        // "closed" (source completed or consumer ended — invisible to a
        // memo consumer, which just latches). First-connect failures emit
        // nothing: the rejection already surfaces through the call.
        const emit = (state, error) => {
          try {
            iterable.onstatus && iterable.onstatus(state, error);
          } catch {}
        };
        const emitClosed = error => {
          if (ended) return;
          ended = true;
          emit("closed", error);
        };
        const closeIt = value => {
          const current = it;
          it = undefined;
          if (current) {
            try {
              const r = current.return && current.return(value);
              if (r && typeof r.then === "function") r.then(undefined, () => {});
            } catch {}
          }
        };
        const callOnce = () => {
          // A GET-composed reference is already a flight-free read with its
          // own query-string encoding — delegate to it. Otherwise call the
          // transport directly so the POST is marked a read: live responses
          // are streams, which have no single-flight envelope story (and
          // flight collection is mutation policy).
          if (metadata.method === "GET") return fn(...args);
          const handler = config.responseHandler;
          if (handler && handler.intercept) {
            const hit = handler.intercept({ id, meta: metadata, args });
            if (hit !== undefined) return hit;
          }
          return fetchServerFunction(fn.url, id, { read: true }, args, metadata, args);
        };
        const pull = async () => {
          while (!stopped) {
            try {
              if (!it) {
                const result = await callOnce();
                connected = true;
                // a plain-value answer is a one-value stream
                it =
                  result !== null && typeof result === "object" && result[Symbol.asyncIterator]
                    ? result[Symbol.asyncIterator]()
                    : (async function* () {
                        yield result;
                      })();
                // stopped while connecting: the just-arrived stream must still
                // be ended (its return() aborts the request)
                if (stopped) {
                  closeIt();
                  return DONE;
                }
                emit("connected");
              }
              const r = await it.next();
              if (r.done) {
                emitClosed();
                return DONE;
              }
              if (stopped) return DONE;
              attempts = 0; // healthy value: backoff resets
              return r;
            } catch (error) {
              // First-connect failures surface (normal call semantics); a
              // stream that had connected died — retry with backoff. The next
              // successful connect starts a NEW logical answer: value-shaped
              // sources re-yield current state on invocation by contract.
              if (!connected) throw error;
              // Definite rejections fail fast: a 4xx means the server
              // understood and refused — auth revoked, resource gone —
              // and retrying cannot change the answer. The error surfaces
              // through the consumer like a first-connect failure would.
              if (
                error !== null &&
                typeof error === "object" &&
                typeof error.status === "number" &&
                error.status >= 400 &&
                error.status < 500
              ) {
                stopped = true;
                emitClosed(error);
                throw error;
              }
              it = undefined;
              emit("reconnecting", error);
              await new Promise(resolve => {
                wake = resolve;
                timer = setTimeout(resolve, Math.min(500 * 2 ** attempts++, 10000));
                // connectivity returning wakes the sleep — no reason to sit
                // out an 8s backoff when the network just came back (typeof
                // guard: non-browser consumers have no global EventTarget)
                if (typeof addEventListener === "function")
                  addEventListener("online", resolve, { once: true });
              });
              clearTimeout(timer);
              if (typeof removeEventListener === "function") removeEventListener("online", wake);
              timer = wake = undefined;
            }
          }
          return DONE;
        };
        return {
          next: () => pull(),
          return(value) {
            stopped = true;
            if (timer !== undefined) clearTimeout(timer);
            if (wake) wake();
            // ends the in-flight call through the transport's return() wiring
            closeIt(value);
            emitClosed();
            return Promise.resolve({ done: true, value });
          }
        };
      }
    };
    return iterable;
  };
  wrapped[SERVER_FUNCTION_METADATA] = metadata;
  wrapped.id = id;
  // lazy like the base proxy's: the endpoint may be configured after the
  // module-scope live(...) call runs
  Object.defineProperty(wrapped, "url", {
    get: () => fn.url,
    configurable: true
  });
  return wrapped;
}

// Only ever referenced by server-mode compiler output; present so a
// misconfigured build fails loudly instead of with a missing-export error.
export function registerServerReference() {
  throw new Error("registerServerReference must not be called in the client build");
}

// Client no-op mirror of the server entry's accessor: there is never a
// server function call in flight on the client, so this answers undefined.
// Present so `"use server"` modules that import it stay import-stable in
// client builds before dead-code elimination.
export function getServerFunctionInvocation() {
  return undefined;
}
