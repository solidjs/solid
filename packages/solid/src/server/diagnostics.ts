// The server facade's findings, on the one structured channel — see
// documentation/plans/server-dev-build-plan.md (P1/P2) and RFC 08.
//
// Two tiers, two gates. `IS_OBSERVE` gates the WIRING: a fact the runtime
// reports whichever tier is running — a render error it contained, a
// subtree it abandoned. Those emit on `OBSERVE.diagnostics` for a
// production observability consumer and never touch the console. `IS_DEV`
// gates the CHECKS: guidance for a developer at a console (a write on the
// server, a nested Reveal) — emitted AND reported. Prod folds both out: the
// literals are replaced per build, and the prod server artifact neither
// imports `OBSERVE` nor pays for a message string.
import { DEV, OBSERVE, type DiagnosticEvent, type DiagnosticSubject } from "@solidjs/signals";
import { getOwner } from "./signals.js";

export const IS_DEV = "_SOLID_DEV_" as string | boolean;
export const IS_OBSERVE = "_SOLID_OBSERVE_" as string | boolean;

export type Finding = Omit<DiagnosticEvent, "sequence">;

/**
 * Records a finding on `OBSERVE.diagnostics` — observe and dev tiers — and,
 * in dev, reports it on the console through the core's one face (message,
 * `in <App> › <Page>`, the once-per-code footer). `subject` locates it; the
 * current owner by default, which is what the check sites want (they fire
 * inside the scope that misbehaved). Server owners are signals-shaped
 * enough for the core's `ownerPath` walk (`_parent` + `_name`), so component
 * labels (see `createComponent`) come through unchanged. No-op in prod.
 *
 * Advisory (`info`) findings are structured-channel only, as in the core:
 * a fact worth recording that has not earned the console.
 */
export function emitFinding(
  finding: Finding,
  subject: DiagnosticSubject | null = getOwner()
): void {
  if (!IS_OBSERVE) return;
  // `OBSERVE`/`DEV` are typed optional (undefined in the tiers below theirs);
  // the gates above are the same conditions that define them.
  const entry = OBSERVE!.diagnostics.emit(located(finding, subject), subject);
  if (IS_DEV && finding.severity !== "info") DEV!.report(entry);
}

/**
 * The finding with its `ownerPath` — the labels up this entry's OWN owner
 * chain (`createComponentOwner`'s `<Name>`) — filled in here rather than by
 * the core's walk: the core reads `_parent` under its own build's property
 * mangling (the observe and prod artifacts rename `_`-fields; `_name` alone
 * is reserved as the cross-package label), so its walk finds nothing on a
 * server owner in the observe artifact. An `ownerPath` already on the
 * finding wins, as in the core.
 */
function located(finding: Finding, subject: DiagnosticSubject | null): Finding {
  if (finding.ownerPath !== undefined || !subject || !("_parent" in subject)) return finding;
  const path: string[] = [];
  for (let owner: any = subject; owner; owner = owner._parent) {
    const name = owner._name;
    if (typeof name === "string" && name.length) path.push(name);
  }
  return path.length ? { ...finding, ownerPath: path.reverse() } : finding;
}

/**
 * The structured record alone, for a site that THROWS its message: the
 * thrown error is the console face, and the core lands the once-per-code
 * footer beneath it (see `emitDiagnostic`). Reporting as well would print
 * the finding twice.
 */
export function recordFinding(
  finding: Finding,
  subject: DiagnosticSubject | null = getOwner()
): void {
  if (IS_OBSERVE) OBSERVE!.diagnostics.emit(located(finding, subject), subject);
}

/**
 * A dev CHECK: `emitFinding` behind the dev gate, so the site reads as one
 * call and folds out of the observe and prod artifacts entirely (message
 * strings included). Returns nothing; sites that must also throw or
 * fall back keep doing so after the call.
 */
export function devCheck(finding: Finding, subject?: DiagnosticSubject | null): void {
  if (IS_DEV) emitFinding(finding, subject);
}

/** `Name: message` for an Error, `String(value)` otherwise — the text a finding's message carries. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message ? `${error.name}: ${error.message}` : error.name;
  return String(error);
}
