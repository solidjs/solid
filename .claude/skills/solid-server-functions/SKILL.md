---
name: solid-server-functions
description: How to write and call Solid server functions. Use when adding or reviewing a "use server" function, a form action, a GET-declared read, or code that calls redirect, reload, respond, or markSafeError. Covers the closure rule the compiler enforces, the security expectations of the boundary, and the deployment secret.
---

# Solid server functions

A `"use server"` function runs on the server and is callable from the client
as an ordinary async function. The compiler extracts it, registers it under a
build-stable id, and replaces the client-side reference with a proxy.

```ts
export async function createPost(title: string) {
  "use server";
  return db.post.create({ data: { title } });
}
```

The directive can also sit at the top of a module, which makes the whole
module server-only.

## The closure rule

A function-level `"use server"` may only capture module-top-level bindings and
its own parameters. Capturing a variable from an intermediate scope is a
compile error, because the extracted function no longer has that scope.

```ts
// Rejected at compile time.
function handler(userId: string) {
  return async function save(title: string) {
    "use server";
    return db.post.create({ data: { title, userId } }); // userId is not top-level
  };
}
```

Pass the value as an argument instead. Do not work around the error by hoisting
a mutable module-level variable, because that is shared across concurrent
requests.

## Treat every server function as a public endpoint

The boundary is not authentication. Ids are derived from the function name and
the file path with a public algorithm, so they are discoverable, and the
same-origin gate only stops browser-driven cross-site calls. Anything that is
not a browser can present whatever headers it likes.

Check authorization inside the function, or once for all of them through the
`wrapInvocation` hook.

```ts
export async function deletePost(id: string) {
  "use server";
  const user = await requireUser(); // every call, no exceptions
  if (!user.canDelete(id)) throw new Error("forbidden");
  return db.post.delete({ where: { id } });
}
```

## GET declares a read, and gives up the origin gate

`GET(fn)` makes a function reachable over GET and HEAD so its responses can be
cached. It also skips the same-origin gate, so the function becomes executable
from any origin with the user's cookies. Cross-site code cannot read the
response, but it does cause the function to run.

Only wrap genuine reads. Never wrap anything that writes, charges, sends, or
is expensive enough to be worth triggering. Deployments that would rather gate
reads than cache them can set `csrf: { protectDeclaredReads: true }`.

## Returning and throwing responses

`redirect(url, init)`, `reload(init)`, and `respond(value, init)` build the
control-flow responses. Throw them for early exit, return them for a normal
result.

```ts
export async function login(form: FormData) {
  "use server";
  const session = await authenticate(form);
  if (!session) throw new Error("bad credentials");
  throw redirect("/dashboard");
}
```

Validate any redirect target that came from request data. The transport
refuses non-http(s) schemes, so `javascript:` cannot get through, but it does
not restrict the host: a `?next=` parameter passed straight to `redirect` is
an open redirect.

## Errors are sanitized on the way out

A plain thrown value is replaced with a generic `Error` outside dev builds, so
a driver error's message, failing query, and connection string do not reach
the client. Send a message deliberately with `markSafeError`.

```ts
throw markSafeError(new Error("That email is already registered"));
```

Only brand messages that are safe for a stranger to read. A branded error
keeps its content, and in a dev build its stack too.

## Calling with per-call options

Server function references are called like functions. Use `invoke` when one
call needs an `AbortSignal`, `keepalive`, or a priority hint.

```ts
const user = await invoke(getUser, { signal: controller.signal }, id);
```

Anything with a longer life than one call belongs elsewhere: session-dynamic
headers in the `prepareRequest` hook, declaration-static shape in `GET(fn)` or
`withMeta(fn, meta)`, and retries or deduplication in the data layer that owns
the call.

## Forms without client JavaScript

A form can post directly to a server function, and the runtime carries the
outcome to the next render in a one-shot encrypted cookie. That cookie needs a
deployment secret.

```ts
configureServerFunctionsServer({ secret: process.env.SOLID_SECRET });
```

Use a high-entropy value of 32 bytes or more, shared by every instance behind
the load balancer, and keep it out of source control. The Solid bundler plugin
injects a per-build key when the option is unset. With no key at all the form
still posts and redirects, and only the outcome echo is dropped.
