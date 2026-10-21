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
import { DOMWithState } from "./constants.js";

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

const lowercaseEventAttributesReported = /*#__PURE__*/ new Set<string>();

/**
 * Dev CHECK: a function reached an attribute whose name starts with `on` but
 * is not an event handler — a lowercase `onclick`, or a 1.x `on:click`. Only
 * `on` + an uppercase letter (`onClick`) binds an event in 2.0; anything else
 * is a plain attribute, so the function is stringified into the attribute's
 * text. Reported once per attribute name so a row template reports once.
 */
export function lowercaseEventAttribute(name: string, node: Element): void {
  if (lowercaseEventAttributesReported.has(name)) return;
  lowercaseEventAttributesReported.add(name);
  const event = name.slice(name.charAt(2) === ":" ? 3 : 2);
  const handler = "on" + event.charAt(0).toUpperCase() + event.slice(1);
  devCheck({
    code: "LOWERCASE_EVENT_ATTRIBUTE",
    kind: "render",
    severity: "warn",
    message:
      `[LOWERCASE_EVENT_ATTRIBUTE] \`${name}\` received a function, but \`${name}\` is an attribute ` +
      `in Solid 2.0, not an event handler: the function was set as the attribute's text. ` +
      `Use \`${handler}\` for event handlers.`,
    data: { name, handler, tag: node.localName }
  });
}

// Per element, per stateful property: the value Solid last wrote (`v`), what
// the element read back right after that write (`d`, so the browser's own
// coercion and sanitization never look like a user edit), and whether the
// warning already fired for it (`w`). Dev only: every reader and writer is
// behind a `"_SOLID_DEV_"` gate, so the prod and observe artifacts drop it.
const statefulWrites = /*#__PURE__*/ new WeakMap<
  Element,
  Record<string, { v: unknown; d: unknown; w?: 1 }>
>();

/** The DOM property's state, or undefined when the write is not checked. */
function statefulRecord(node: Element, prop: string) {
  // `<select value>` is excluded: its write is deferred until matching
  // options exist and a multiple select takes an array, so the value read
  // back after a write is not what the user last left there.
  if (DOMWithState[node.nodeName]?.[prop] !== 1 || node.nodeName === "SELECT") return;
  let records = statefulWrites.get(node);
  if (!records) statefulWrites.set(node, (records = {}));
  return records;
}

/**
 * Dev CHECK, before every compiled or spread write of a stateful DOM
 * property (`input.value`, `input.checked`, `option.selected`,
 * `video.muted`, ...): Solid is about to write the same value it wrote last
 * time, but the element no longer holds what that write left there. Nothing
 * Solid wrote changed it, so the user did — typed, clicked, toggled — and
 * that edit never reached the bound signal; the write is about to erase it.
 * The write re-applies an unchanged value because the binding re-ran
 * without its value changing: another binding in the same template effect
 * changed, a spread re-ran, or the source fired with an equal value
 * (`equals: false`). Warns once per element and property; the write itself
 * goes ahead unchanged. Pair with `recordStatefulWrite` after the write.
 */
export function checkStatefulWrite(node: Element, prop: string, value: unknown): void {
  const record = statefulRecord(node, prop)?.[prop];
  if (!record || record.w || value !== record.v || (node as any)[prop] === record.d) return;
  record.w = 1;
  const tag = node.localName;
  const type = tag === "input" ? (node as HTMLInputElement).type : undefined;
  const name = node.getAttribute("name") || undefined,
    id = node.id || undefined;
  let element = `<${tag}`;
  if (type) element += ` type="${type}"`;
  if (name) element += ` name="${name}"`;
  else if (id) element += ` id="${id}"`;
  element += `>.${prop}`;
  const handler = prop === "muted" ? "onVolumeChange" : prop === "value" ? "onInput" : "onChange";
  const defaultProp = "default" + prop.charAt(0).toUpperCase() + prop.slice(1);
  devCheck({
    code: "UNCOMMITTED_INPUT_OVERWRITTEN",
    kind: "render",
    severity: "warn",
    message:
      `[UNCOMMITTED_INPUT_OVERWRITTEN] ${element} was changed by the user, but the change was ` +
      `never committed to the signal bound to \`${prop}\`, and Solid is writing the bound value ` +
      `back over it: the user's input is lost. A compiled \`${prop}\` binding re-applies the ` +
      `bound value whenever its effect runs — here with the value unchanged, because another ` +
      `binding in the same template changed, a spread re-ran, or the source fired with an equal ` +
      `value — and the signal is the source of truth. Write the signal on every edit ` +
      `(\`${handler}={e => setValue(e.currentTarget.${prop})}\`, a draft signal you commit ` +
      `later), use \`${defaultProp}\` for an uncontrolled element, or write a rejected edit back ` +
      `explicitly (\`e.currentTarget.${prop} = next\`).`,
    data: { tag, prop, type, name, id }
  });
}

/** Dev: remembers what a stateful write left on the element (see `checkStatefulWrite`). */
export function recordStatefulWrite(node: Element, prop: string, value: unknown): void {
  const records = statefulRecord(node, prop);
  if (records) records[prop] = { v: value, d: (node as any)[prop], w: records[prop]?.w };
}

/** `Name: message` for an Error, `String(value)` otherwise. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message ? `${error.name}: ${error.message}` : error.name;
  return String(error);
}
