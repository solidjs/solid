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

/** `Name: message` for an Error, `String(value)` otherwise. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message ? `${error.name}: ${error.message}` : error.name;
  return String(error);
}
