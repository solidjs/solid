// The response helpers are typed by what they mean to the caller of the
// function returning them: `respond(value)` is `value`, and a `redirect()`
// or `reload()` — control flow, not a value — never shows up. That holds
// for a bare `"use server"` function, typed by its own signature, as much
// as through `GET()`. Compile-only, under `test-types`.
import { GET as clientGET } from "../server-functions/src/client.js";
import { GET as serverGET } from "../server-functions/src/server.js";
import { redirect, reload, respond } from "../src/response.js";

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
function assertType<T extends true>(): T | void {}
type Resolved<F extends (...args: any[]) => any> = Awaited<ReturnType<F>>;
type User = { id: string };

assertType<Equal<ReturnType<typeof respond<{ id: number }>>, { id: number }>>();
const redirected = () => redirect("/login");
const reloaded = () => reload({ revalidate: "users" });
assertType<Equal<ReturnType<typeof redirected>, never>>();
assertType<Equal<ReturnType<typeof reloaded>, never>>();
// A type parameter defaulting to `never`, not a literal `never` return: the
// latter would also mark code after a bare call unreachable.
assertType<Equal<ReturnType<typeof redirect<Response>>, Response>>();
assertType<Equal<ReturnType<typeof reload<Response>>, Response>>();

// A bare server function's type is the caller's type.
async function getStory(id: number) {
  "use server";
  return respond({ id }, { headers: { "cache-control": "public, max-age=60" } });
}
assertType<Equal<Resolved<typeof getStory>, { id: number }>>();

// Control flow on any branch leaves only the value.
async function rename(id: string) {
  "use server";
  if (!id) return redirect("/login");
  if (id === "stale") return reload({ revalidate: "users" });
  return respond({ id, renamed: true }, { status: 201 });
}
assertType<Equal<Resolved<typeof rename>, { id: string; renamed: boolean }>>();

// Where the context names a type, the helper takes it: an annotated
// return, or a request handler that must answer with a Response.
async function annotated(id: string): Promise<User> {
  "use server";
  if (!id) return redirect("/login");
  return { id };
}
annotated;
const handler: (request: Request) => Response = request =>
  request.headers.has("cookie") ? Response.json({ ok: true }) : redirect("/login");
handler;

// A component wrapped for its headers is still a component to the caller.
for (const GET of [clientGET, serverGET]) {
  const getView = GET(async () => respond(() => "view"));
  assertType<Equal<Resolved<typeof getView>, () => "view">>();
}
