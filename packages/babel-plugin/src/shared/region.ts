/**
 * Region eligibility + emission (DESIGN-REGIONS.md — the emitter).
 *
 * A template scope compiles to a REGION when at least one dynamic binding's
 * value is a pure expression over DEPTH-1 member reads of one stable subject
 * identifier (`subject.key` / `subject["k"]` / `subject[0]` — deeper chains
 * decline: the deep witness covers only the record's own keys). Bindings
 * that don't qualify become TRACKED RESIDUALS: their expressions evaluate in
 * the region's compute (classic per-key subscriptions — dynamic keys,
 * foreign stores, deep chains), fused into the SAME effect node.
 *
 * Emission:
 *
 *   _$region(
 *     subject,
 *     (_t$) => { _t$.r0 = <residual>; ... } | null,
 *     (_n$, _t$, _p$) => {
 *       let _v$ = <eligible expr, subject → _n$>;   // raw read at commit
 *       _v$ !== _p$.a0 && setAttr(..., (_p$.a0 = _v$));
 *       let _v$2 = _t$.r0;                           // residual, tracked
 *       _v$2 !== _p$.a1 && setAttr(..., (_p$.a1 = _v$2));
 *     }
 *   );
 *
 * The runtime combinator (signals `region()`) owns admission, demotion, and
 * the classic fallback — which runs the SAME body with the proxy as `_n$`,
 * so member reads track per-key and semantics are identical either way.
 */
import * as t from "@babel/types";
import type { NodePath } from "@babel/traverse";
import type { DynamicBinding } from "../types";

/** Static key of a member step: identifier / string / safe-integer numeric
 * literal, or null when the step is dynamic. */
function stepKey(m: t.MemberExpression): string | null {
  if (m.computed) {
    if (t.isStringLiteral(m.property)) return m.property.value;
    if (t.isNumericLiteral(m.property) && Number.isSafeInteger(m.property.value))
      return String(m.property.value);
    return null;
  }
  return t.isIdentifier(m.property) ? m.property.name : null;
}

/** Full chain rooted at the subject with static keys throughout
 * (["lastSample","topFiveQueries","0"]), else null. */
export function chainOf(node: t.Node, subject: string): string[] | null {
  const segs: string[] = [];
  let cur: t.Node = node;
  while (t.isMemberExpression(cur)) {
    const k = stepKey(cur);
    if (k === null) return null;
    segs.push(k);
    cur = cur.object;
  }
  if (!t.isIdentifier(cur) || cur.name !== subject) return null;
  return segs.reverse();
}

/** Eligible expression: literals, and compositions of STATIC-KEY member
 * chains of the subject (ternary/binary/logical/template/unary). Chains of
 * any depth qualify — the emitter subscribes a path witness per intermediate
 * record (dk has no ancestor bubbling; see the runtime's `path` helper). */
function isEligibleExpr(node: t.Node, subject: string): boolean {
  switch (node.type) {
    case "Identifier":
      return (node as t.Identifier).name === "undefined";
    case "MemberExpression":
      return chainOf(node, subject) !== null;
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
    case "NullLiteral":
    case "BigIntLiteral":
      return true;
    case "ConditionalExpression": {
      const c = node as t.ConditionalExpression;
      return (
        isEligibleExpr(c.test, subject) &&
        isEligibleExpr(c.consequent, subject) &&
        isEligibleExpr(c.alternate, subject)
      );
    }
    case "BinaryExpression": {
      const b = node as t.BinaryExpression;
      if (b.operator === "in" || b.operator === "instanceof") return false;
      return isEligibleExpr(b.left as t.Node, subject) && isEligibleExpr(b.right, subject);
    }
    case "LogicalExpression": {
      const l = node as t.LogicalExpression;
      return isEligibleExpr(l.left, subject) && isEligibleExpr(l.right, subject);
    }
    case "UnaryExpression": {
      const u = node as t.UnaryExpression;
      if (u.operator === "delete" || u.operator === "throw") return false;
      return isEligibleExpr(u.argument, subject);
    }
    case "TemplateLiteral":
      return (node as t.TemplateLiteral).expressions.every(e =>
        t.isExpression(e) ? isEligibleExpr(e, subject) : false
      );
    case "ParenthesizedExpression":
      return isEligibleExpr((node as t.ParenthesizedExpression).expression, subject);
    default:
      return false;
  }
}

/** Root identifier of the first static-key member chain found. */
function findSubjectCandidate(node: t.Node): string | null {
  if (t.isMemberExpression(node)) {
    let cur: t.Node = node;
    while (t.isMemberExpression(cur)) cur = cur.object;
    if (t.isIdentifier(cur) && cur.name !== "undefined") return cur.name;
    return null;
  }
  switch (node.type) {
    case "ConditionalExpression":
      return (
        findSubjectCandidate((node as t.ConditionalExpression).test) ??
        findSubjectCandidate((node as t.ConditionalExpression).consequent) ??
        findSubjectCandidate((node as t.ConditionalExpression).alternate)
      );
    case "BinaryExpression":
    case "LogicalExpression":
      return (
        findSubjectCandidate((node as any).left as t.Node) ??
        findSubjectCandidate((node as any).right as t.Node)
      );
    case "UnaryExpression":
      return findSubjectCandidate((node as t.UnaryExpression).argument);
    case "TemplateLiteral": {
      for (const e of (node as t.TemplateLiteral).expressions) {
        const s = findSubjectCandidate(e);
        if (s) return s;
      }
      return null;
    }
    case "ParenthesizedExpression":
      return findSubjectCandidate((node as t.ParenthesizedExpression).expression);
    default:
      return null;
  }
}

export interface RegionScope {
  subject: string;
  /** Parallel to the dynamics array: true = rides raw, false = residual. */
  eligible: boolean[];
  /** Unique INTERMEDIATE prefixes of every eligible chain, shortest first
   * (["lastSample"], ["lastSample","topFiveQueries"], ...): each gets one
   * path-witness subscription in the compute. Depth-1 chains contribute
   * none — the region's own deep witness covers the subject's keys. */
  deepPrefixes: string[][];
}

/** Collect every subject-rooted static chain in an eligible expression
 * (whole chains are consumed — no descent into their members). */
function collectChains(node: t.Node, subject: string, out: string[][]): void {
  if (t.isMemberExpression(node)) {
    const chain = chainOf(node, subject);
    if (chain !== null) {
      out.push(chain);
      return;
    }
  }
  for (const key of Object.keys(node)) {
    const value: any = (node as any)[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item.type === "string") collectChains(item, subject, out);
      }
    } else if (value && typeof value.type === "string") {
      if (t.isMemberExpression(node) && key === "property" && !node.computed) continue;
      collectChains(value, subject, out);
    }
  }
}

/** PROGRAM-WIDE assigned-name set (cached per Program node): the Oxc
 * compiler's binding table records assignment targets scope-insensitively
 * ("conservative in the safe direction"), so the Babel side must apply the
 * SAME contract for parity — a subject name assigned anywhere in the module
 * declines, even if the assignment targets a different binding. Revisit
 * with scope-aware Rust bindings alongside the envelope redesign. */
const assignedNamesCache = new WeakMap<object, Set<string>>();

function programAssignedNames(path: NodePath): Set<string> {
  const program = path.scope.getProgramParent().path.node as object;
  let names = assignedNamesCache.get(program);
  if (names === undefined) {
    names = new Set<string>();
    const collect = (node: any): void => {
      if (node == null || typeof node.type !== "string") return;
      if (node.type === "AssignmentExpression" && t.isIdentifier(node.left)) {
        names!.add(node.left.name);
      } else if (node.type === "UpdateExpression" && t.isIdentifier(node.argument)) {
        names!.add(node.argument.name);
      }
      for (const key of Object.keys(node)) {
        const value = node[key];
        if (Array.isArray(value)) {
          for (const item of value) collect(item);
        } else if (value && typeof value.type === "string") {
          collect(value);
        }
      }
    };
    collect(program);
    assignedNamesCache.set(program, names);
  }
  return names;
}

/** Analyze a scope's dynamics: pick the first depth-1 subject candidate and
 * classify every binding against it. Region-worthy when the subject binding
 * is CONSTANT and at least one binding is eligible. */
export function analyzeRegionScope(path: NodePath, dynamics: DynamicBinding[]): RegionScope | null {
  if (dynamics.length === 0) return null;
  let subject: string | null = null;
  for (const d of dynamics) {
    const s = findSubjectCandidate(d.value);
    if (s !== null && isEligibleExpr(d.value, s)) {
      subject = s;
      break;
    }
  }
  if (subject === null) return null;
  const binding = path.scope.getBinding(subject);
  // The classic fallback re-reads the subject reference per run, but a
  // region captures it once — reassignable subjects keep classic semantics.
  if (!binding || !binding.constant) return null;
  if (programAssignedNames(path).has(subject)) return null;
  const eligible = dynamics.map(d => isEligibleExpr(d.value, subject!));
  if (!eligible.some(Boolean)) return null;
  const chains: string[][] = [];
  for (let i = 0; i < dynamics.length; i++) {
    if (eligible[i]) collectChains(dynamics[i].value, subject, chains);
  }
  const seen = new Set<string>();
  const deepPrefixes: string[][] = [];
  for (const chain of chains) {
    for (let len = 1; len < chain.length; len++) {
      const prefix = chain.slice(0, len);
      const key = prefix.join("\u0000");
      if (!seen.has(key)) {
        seen.add(key);
        deepPrefixes.push(prefix);
      }
    }
  }
  deepPrefixes.sort((a, b) => a.length - b.length);
  return { subject, eligible, deepPrefixes };
}

/** Clone a RESIDUAL expression substituting DIRECT depth-1 subject reads
 * (`subject.key` not further membered) with reads off the tracked callback's
 * raw parameter. Sound because the region compute subscribes the deep
 * witness — any subject change reruns it — so a tracked per-key read would
 * only duplicate the wake (measured ~40% of keyed-row mount). Deeper chains
 * (`subject.a.b`) keep the proxy read: the witness only covers the record's
 * own keys. The classic fallback passes the PROXY as this parameter, so the
 * same emitted code stays per-key tracked there. */
export function substituteResidualSubject(
  expr: t.Expression,
  subject: string,
  replacement: t.Identifier
): t.Expression {
  const clone = t.cloneNode(expr, true);
  const rewrite = (node: t.Node, isMemberObject: boolean): void => {
    if (
      t.isMemberExpression(node) &&
      t.isIdentifier(node.object) &&
      node.object.name === subject &&
      !isMemberObject
    ) {
      node.object = t.cloneNode(replacement);
    }
    for (const key of Object.keys(node)) {
      const value: any = (node as any)[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item.type === "string") rewrite(item, false);
        }
      } else if (value && typeof value.type === "string") {
        if (t.isMemberExpression(node) && key === "property" && !node.computed) continue;
        rewrite(value, t.isMemberExpression(node) && key === "object");
      }
    }
  };
  rewrite(clone, false);
  return clone as t.Expression;
}

/** Clone `expr` substituting depth-1 subject reads' OBJECT position with
 * `replacement` (safe: eligibility rejected shadowing constructs). */
export function substituteSubject(
  expr: t.Expression,
  subject: string,
  replacement: t.Identifier
): t.Expression {
  const clone = t.cloneNode(expr, true);
  const rewrite = (node: t.Node): void => {
    for (const key of Object.keys(node)) {
      const value: any = (node as any)[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item.type === "string") rewrite(item);
        }
      } else if (value && typeof value.type === "string") {
        if (
          t.isIdentifier(value) &&
          value.name === subject &&
          t.isMemberExpression(node) &&
          key === "object"
        ) {
          (node as any)[key] = t.cloneNode(replacement);
        } else {
          if (t.isMemberExpression(node) && key === "property" && !node.computed) continue;
          rewrite(value);
        }
      }
    }
  };
  rewrite(clone);
  return clone as t.Expression;
}
