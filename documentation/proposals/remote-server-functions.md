# IDEA: Server functions on a separate host

Status: IDEA, deferred. Nothing here is scheduled. Written 2026-09-18 to
record a design shape before the request arrives, so the first person who
asks gets a link and a shape instead of "not supported". Prompted by a
Discord question about a client-only Solid build bundled into a Capacitor
app calling a server bundle hosted on Netlify.

Filed today, and the only part with an issue: solidjs/solid#3538, the CSRF
origin allowlist is never consulted for a cross-site caller.

Decided today: non-JS backends (server functions implemented in Go, etc.)
are not a design goal. Section 4 records what one would cost so the
decision is a decision and not an omission.

---

## The three requests behind "I want my backend elsewhere"

People will ask one question and mean one of three things. They differ in
size by an order of magnitude each, and the answer depends on which one is
meant.

1. **A browser client on another origin calls the server bundle.** Static
   client (native shell, browser extension, embedded widget, marketing site)
   hosted somewhere the server bundle is not. Gate change plus CORS. Filed
   as #3538. Small.
2. **SSR renders on one host and server functions run on another.** The
   render box calls functions over the wire instead of in-process. Plugin
   flag, a third build output, and one new runtime hook. Medium.
3. **Server functions not written in Solid.** The wire format becomes a
   public, versioned protocol. Large, and a commitment. Not a goal.

Same-origin and same-deployment are different properties, and today's
constraint is only the second one for SSR. A client-only build already
splits: `dist/client` on one host, `dist/server` on another, routed under
one origin by the CDN or proxy that serves the pages. That works now with no
configuration and is documented on the Deployment page.

## Governing principle: the render box is a client

Solid's SSR is isomorphic. The render already reads the way the browser
does: reads created together, blocking low, the waterfall discipline the
client needs anyway. So a remote function host does not introduce a new
performance model, and it does not need a new call path. The render box
becomes another client of the function box: same client runtime, same
parallelism, same rules.

Everything below follows from that. The client runtime is used as-is on the
render box; the only gaps are the things a browser does for itself that a
render has to do explicitly.

## 1. Browser client on another origin (#3538)

Recorded here for completeness; the issue carries the detail.

`configureServerFunctionsServer({ csrf: { origin } })` reads as an allowlist
but is never consulted when `Sec-Fetch-Site: cross-site` is present, and
every current browser and WebView (WebKit since 16.4) sends that header. The
handler emits no `Access-Control-*` headers. The client side already works
mechanically: `configureServerFunctionsClient({ endpoint })` builds absolute
addresses, and `prepareRequest` names bearer tokens as its motivating case.

Proposal: consult the matcher for `cross-site` when `Origin` is present,
refuse by default and on any non-`true` return; emit CORS headers only for
allowed origins, `Allow-Credentials` only when configured; document the
absolute `endpoint`.

Independent of section 2: a render box's Node `fetch` sends no `Origin`
and no `Sec-Fetch-Site`, so it takes a different path through the gate.

## 2. Split SSR: render host and function host

### The compiler is already done

`TransformDirectivesOptions.mode` has two values. `"server"` keeps the
module and registers extracted functions; `"client"` replaces them with
reference proxies and strips server-only code. The directive pass and the
JSX pass (`generate: "ssr" | "dom"`) are independent options.

A split SSR build is the SSR bundle compiled with `mode: "client"` for
directives and `generate: "ssr"` for JSX: the render box gets reference
proxies and no implementations. The function box is a third build output
compiled with `mode: "server"`, containing the handler and the
registrations. No new transform.

### The plugin: a flag and a third output

- A `serverFunctions` option naming the remote host (shape open:
  `remote: "https://fn.example.com"`, or a platform preset, see section 3).
- A third output, `dist/functions`, that is the Fetchable module the handler
  already exports (`export default { fetch }`), plus whatever wrapper the
  target platform wants.
- The endpoint rewrite the plugin already performs for a non-default
  `endpoint` ("compiled modules configure both runtime sides with that
  resolved endpoint") extended to an absolute URL.
- Dev unchanged: the handler mounts in the dev server as today. Only the
  build swaps to remote. Same code both ways, which is the isomorphic point
  again.

### The runtime: three gaps, one of them new code

An in-process call gets a derived request event for free: the page
request's cookies and headers, `locals`, and a place for the function's own
response metadata to land. Over the wire each of those has to be explicit.

1. **Outbound: the user's credentials onto each call.** The render box
   reads the ambient request event and forwards cookies and auth headers.
   `prepareRequest` fits this exactly; a plugin-emitted default would read
   `getRequestEvent()` and set `Cookie`, plus `getTraceContext().entries`
   for tracing. Existing hook.
2. **Inbound: the function's response metadata onto the page response.**
   A function that calls `respond()`, sets a cookie, or `httpHeader()`
   during render today writes onto the derived event and commits with the
   page. Over the wire those arrive as headers on the function response,
   and the render box has to replay them onto the page response:
   `Set-Cookie`, status from `respond()`, redirects. The client runtime's
   `responseHandler` sees every response before decoding, so it is the seam,
   but nothing today maps a function response back onto the render's
   request event. **This is the one piece of new runtime code.**
3. **The render box proving itself to the function box.** A Node `fetch`
   carries no `Origin`, so the gate falls through to
   `allowRequestsWithoutOriginCheck`. Over HTTP the answer is a shared
   secret header, set by the render box's `prepareRequest` and verified in
   the function box's `wrapInvocation`, with the plugin generating both
   sides from one environment variable. With a platform binding (section
   3), a trusted caller by construction and no secret needed.

### `locals` is a statement, not a gap

`locals` does not travel, and should not. Middleware on the function box
owns identity and re-derives it from the cookie, the same as it would for a
browser caller. An app that stashes something in `locals` for functions to
read moves it into a header or the session. This is the same discipline the
browser path already imposes, which is the point of "the render box is a
client".

### What does not change

Single-flight, flash cookies for no-JS posts, revalidation envelopes, safe
errors, streams and `live()` all ride the client runtime, which the render
box now runs. The wire is the same wire the browser speaks.

## 3. Platform wiring from configuration

With the render box as a client, the plugin can emit the function host as a
separate deployable for a named platform, from configuration alone.

- **Output.** The Fetchable module is already the shape Netlify Functions
  and Cloudflare Workers consume. The plugin emits the wrapper and the
  config file (`netlify.toml` functions dir, `wrangler.toml`).
- **Render box to function box.** The client runtime's `fetch` slot exists
  for this ("sends every server-function request — retries, telemetry, a
  test double, or an app's own route"). On Cloudflare that is a service
  binding, `env.FUNCTIONS.fetch(request)`, which is not an HTTP hop and
  needs no shared secret. On Netlify it is a plain fetch to the function
  URL with the secret from an env var.
- **Browser to function box.** Two choices, and the plugin knows the
  platform so it can pick the default. Platform-routed: Netlify serves
  functions under the site's origin, Cloudflare routes `/_server/*` to the
  function Worker from the same zone; the browser sees one origin and the
  gate needs nothing. Direct: the browser calls the function host's origin,
  which is #3538. Platform-routed is the better default.
- **Dev.** One process, as today.

## 4. Non-JS backends: not a goal, and what it would cost

Server functions implemented in another language on another server would
make the wire format a public contract. Today it is explicitly not one: the
server half's header comment says core owns "the wire shapes both peers must
agree on", both peers being Solid, and the docs site's reference extractor
excludes the serialization entry as an integration-tier codec surface that
can change.

A foreign server would have to speak:

- Addresses: `<endpoint>/data/<id>` for scripted calls, `<endpoint>/<id>`
  for the bare address, `?args=` for `GET` reads and bound arguments.
- Ids: today a compiler-assigned hash of the root-relative path and name. A
  foreign server cannot derive those, so ids would need to be user-named,
  and the client would need a way to declare a function it has no source
  for. The client's `createServerReference(id, name, base)` is that
  primitive, `@internal` today; a public declaration wrapper would sit on
  it.
- Request: the body-format header, JSON argument arrays, the rich-args
  codec for anything JSON cannot carry. The codec is the hardest part to
  port and the most likely to move.
- Response: the envelope distinguishing a value, a thrown value, a
  redirect, a `respond()` stub; safe-error serialization; the single-flight
  header and envelope; the flash cookie; the version-skew label; streams and
  `live()`.

Two profiles are conceivable. A minimal one (JSON in, JSON out, user-named
ids, no streams, no rich args, no single-flight) is an afternoon for a Go
developer and covers most of what "my API is in Go" means. The full profile
makes the client runtime a protocol and every change to it a breaking change
for third-party servers.

Deferred because the commitment is the cost, not the code. Revisit after
2.0 has settled and the wire has stopped moving. If either profile becomes a
goal, a "Server function protocol" reference page becomes a documentation
deliverable and the current stance on serialization reverses.

## Documentation today

The docs state the current constraint on the Deployment page: pages and
server functions are one deployment because a render calls a function
in-process with the request event; a client-only build may put pages and
the function endpoint on different hosts as long as the browser sees one
origin. Both sentences stay true until sections 1 or 2 land, and each has a
known replacement:

- Section 1: "same-origin by default; list the origins you trust to allow a
  static client elsewhere."
- Section 2: "pages and functions may deploy separately; the render calls
  functions the way the browser does."

## Open questions

- Shape of the plugin option: a URL, a platform preset, or both.
- Whether the inbound replay (section 2, gap 2) is a `responseHandler`
  default the plugin installs or a first-class runtime hook with its own
  name.
- Whether `allowRequestsWithoutOriginCheck` plus a secret is the right
  server-to-server story over HTTP, or whether a dedicated caller-identity
  option is warranted once there are two kinds of trusted caller (platform
  binding, secret).
- Dev parity: whether to offer a mode that runs the function host as a
  separate process in development, to surface gap 2 and gap 3 before
  deploy.
