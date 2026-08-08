// Augmentation from a plain `.ts` module that imports NOTHING from
// `@solidjs/web`: the merge must not depend on the augmenting file also
// importing the interface (or anything else) from the package — the
// existing type-tests file imports `RequestEventLocals` alongside its
// augmentation, which would mask a broken re-export chain. Mirrors an
// application module that only declares what its middleware hangs on
// `event.locals`. The merge assertions live in
// request-event-locals.type-tests.ts.
export {};

declare module "@solidjs/web" {
  interface RequestEventLocals {
    augmentedFromTs?: { source: "ts" };
  }
}
