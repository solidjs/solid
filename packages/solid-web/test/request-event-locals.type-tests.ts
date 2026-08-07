// Acceptance test for the `RequestEventLocals` augmentation point: a
// consumer augments `@solidjs/web` — the blessed target — and the merge
// must flow to `getRequestEvent()!.locals` everywhere the event surfaces
// (main entry, `createRequestEvent`, the server-functions event, storage's
// provider constraint). Compile-only — runs under `test-types`
// (tsconfig.test.json) against the BUILT package types via the self-link
// (`pnpm types` first), which is the point: the interface is declared in
// the copied server.d.ts and reaches "@solidjs/web" through the
// index → client → server re-export chain, and augmentation identity must
// survive that chain exactly as published.
import {
  commitEventResponse,
  createRequestEvent,
  getRequestEvent,
  type RequestEvent,
  type RequestEventLocals
} from "@solidjs/web";
import type { ServerFunctionEvent } from "@solidjs/web/server-functions/server";
import { provideRequestEvent } from "@solidjs/web/storage";

interface AugmentedUser {
  id: number;
  name: string;
}

// Optional on purpose: module augmentation is project-global, and a
// REQUIRED key would force every event construction in this test project
// (`locals: {}` in the runtime specs) to supply it — the exact consequence
// an application opts into when it augments with required keys. The
// exactness assertions below distinguish a merged optional key
// (`AugmentedUser | undefined`) from the index signature's `any` just as
// well.
declare module "@solidjs/web" {
  interface RequestEventLocals {
    user?: AugmentedUser;
  }
}

declare const event: RequestEvent;

// The augmented key surfaces with its EXACT type — not the index
// signature's `any`. The @ts-expect-error is the load-bearing half: were
// `user` still `any` (merge failed, index signature answered), the
// satisfies below would pass and the unused directive would fail the build.
event.locals.user satisfies AugmentedUser | undefined;
// @ts-expect-error user is AugmentedUser | undefined, not number
event.locals.user satisfies number;
// @ts-expect-error a write must match the augmented type
event.locals.user = 42;
event.locals.user = { id: 1, name: "ada" };

// Un-augmented keys stay permissive (the index signature): reads are `any`,
// writes are unchecked — existing untyped middleware keeps compiling.
event.locals.anythingElse = Symbol("free-form");
const looselyRead: string = event.locals.somethingUntyped;
looselyRead;

// The merge flows to the ambient read...
getRequestEvent()!.locals.user satisfies AugmentedUser | undefined;
// @ts-expect-error and stays exact there too
getRequestEvent()!.locals.user satisfies number;

// ...to the canonical event builder...
createRequestEvent(new Request("http://localhost/")).locals.user satisfies
  | AugmentedUser
  | undefined;

// ...and across the server-functions subpath, whose event extends the SAME
// RequestEvent declaration (../server.js) — one interface identity, one
// augmentation.
declare const sfEvent: ServerFunctionEvent;
sfEvent.locals.user satisfies AugmentedUser | undefined;
// @ts-expect-error exact across subpaths as well
sfEvent.locals.user satisfies number;

// The exported name is the interface itself, usable directly.
declare const locals: RequestEventLocals;
locals.user satisfies AugmentedUser | undefined;

// storage's provider constraint (`T extends RequestEvent`) accepts an event
// whose locals satisfy the augmented shape.
provideRequestEvent(
  { request: new Request("http://localhost/"), locals: { user: { id: 1, name: "ada" } } },
  () => undefined
);

// commitEventResponse is importable from the main entry with the handler
// signature: response first, the event optional (ambient default).
declare const outgoing: Response;
commitEventResponse(outgoing) satisfies Response;
commitEventResponse(outgoing, event) satisfies Response;
// @ts-expect-error the response argument is required
commitEventResponse();
