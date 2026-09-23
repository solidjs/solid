// The web runtime's findings, on the one structured channel
// (`OBSERVE.diagnostics`) — the same two gates as the facade's
// `solid-js/src/server/diagnostics.ts`: `IS_OBSERVE` for WIRING (a fact the
// runtime reports in any observing tier — a stream the client abandoned, a
// subtree the render gave up on, a header write that missed the wire),
// `IS_DEV` for CHECKS (guidance for a developer at a console — an invalid
// preload descriptor, a non-head tag in useHead), which emit AND report.
// Prod folds both out: the literals are replaced per build and the prod
// artifacts carry neither the emit nor the message strings.
//
// Shared by the server entries and the modules both halves bundle
// (`head.ts`): `getOwner` is the facade's on either side, so a check inside
// a component locates to it on the server (`SSROwner._name`) and the client
// (the owner's `_name`) alike.
//
// This package cannot import `@solidjs/signals` (a transitive dependency a
// strict layout does not expose), so the channel and the console face are
// reached through `solid-js` — `OBSERVE.diagnostics.emit` and `DEV.report`,
// the host-runtime seams the core exposes for exactly this.
import { DEV, OBSERVE, getOwner, type DiagnosticEvent } from "solid-js";

const IS_DEV = "_SOLID_DEV_" as unknown as boolean;
const IS_OBSERVE = "_SOLID_OBSERVE_" as unknown as boolean;

export type Finding = Omit<DiagnosticEvent, "sequence">;

/**
 * Records a finding — observe and dev tiers — and, in dev, reports it on the
 * console. `subject` locates it (the current server owner by default; its
 * component labels give the `ownerPath`); pass `null` for a finding with no
 * location by nature (a stream event). No-op in prod.
 */
export function emitFinding(finding: Finding, subject: unknown = getOwner()): void {
  if (!IS_OBSERVE || OBSERVE === undefined) return;
  const entry = OBSERVE.diagnostics.emit(finding, subject as any);
  if (IS_DEV && DEV !== undefined) DEV.report(entry);
}

/**
 * The structured record alone, for a site that THROWS its message: the
 * thrown error is the console face and the core lands the once-per-code
 * footer beneath it. Reporting as well would print the finding twice.
 */
export function recordFinding(finding: Finding, subject: unknown = getOwner()): void {
  if (IS_OBSERVE && OBSERVE !== undefined) OBSERVE.diagnostics.emit(finding, subject as any);
}

/**
 * A dev CHECK: `emitFinding` behind the dev gate, so the site reads as one
 * call and the observe and prod artifacts carry none of it. Extra console
 * arguments (the offending descriptor, the caught error) go on `data` — the
 * structured record keeps them, the console face prints the message.
 */
export function devCheck(finding: Finding, subject?: unknown): void {
  if (IS_DEV) emitFinding(finding, subject);
}

/**
 * Dev CHECK, one code on both platforms: a hole the compiler left unscoped
 * (a bare identifier — `{renderHead}` — is the one shape that can be a
 * function at runtime without the compiler seeing an expression to scope)
 * evaluated to a function that built hydratable content, and that content
 * took its ids from the ENCLOSING owner's counter. A scoped hole reserves
 * its slot at registration and nests its content under it, so it moves the
 * counter by exactly one, at the same point on both sides; an unscoped one
 * moves it by however much it built, when it ran — statement order on the
 * client, walk order on the server — and every id after it permutes. The
 * shape is unreachable from type-checked code (`JSX.Element` excludes
 * functions) and is not scoped in production; this check is its cost.
 *
 * Unscoped allocation alone is not the finding — a function hole that runs
 * at the same counter position on both sides (nothing scoped after it in
 * its template; a boundary's zero-arity fallback thunk at the end of an
 * element) hydrates fine. Each side reports the permutation it can see:
 * the server knows the position the hole was REGISTERED at (`registered`,
 * where the client builds it in statement order) and the one it EVALUATED
 * it at (`before`, walk order, after the scoped holes that follow it
 * reserved theirs) and reports when they differ; the client, which always
 * builds in place, reports when the content it built inside the hole
 * missed its server-rendered keys. `before`/`after` are the counter's next
 * id around the evaluation; `site` names the hole (`data.name` the
 * function, `data.hole` the position). Callers dedupe per site so a row
 * template reports once.
 */
export function unscopedHoleAllocatedIds(
  before: string,
  after: string,
  site: { name?: string; hole?: number; registered?: string },
  subject?: unknown
): void {
  const fn = site.name ? `\`${site.name}\`` : "a function";
  const where =
    site.registered !== undefined
      ? `the server evaluated it at ${before} (→ ${after}), after the scoped holes that follow it ` +
        `had reserved theirs, but it was registered at ${site.registered}, where the client builds ` +
        `it in place`
      : `the client built it in place at ${before} (→ ${after}) and its content missed its ` +
        `server-rendered keys, because the server evaluates it after the scoped holes that follow it`;
  devCheck(
    {
      code: "UNSCOPED_HOLE_ALLOCATED_IDS",
      kind: "render",
      severity: "warn",
      message:
        `[UNSCOPED_HOLE_ALLOCATED_IDS] A JSX hole received ${fn} instead of a value, and calling it ` +
        `built hydratable content. The hole is unscoped, so that content took ids from the enclosing ` +
        `scope's counter: ${where}. The hydration keys of this hole's content and of the holes after it ` +
        `permute between server and client. Pass the built value — call it at the hole ` +
        `(\`{${site.name || "render"}()}\`) or assign the result first — rather than the function; a ` +
        `function is not a JSX.Element, so this shape is reached only from JavaScript or through a cast.`,
      data: { before, after, ...site }
    },
    subject
  );
}

/** `Name: message` for an Error, `String(value)` otherwise. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message ? `${error.name}: ${error.message}` : error.name;
  return String(error);
}
