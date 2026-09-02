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

/** Depth-1 eligible expression: literals, and compositions of ONE-LEVEL
 * member reads of the subject (ternary/binary/logical/template/unary). */
function isEligibleExpr(node: t.Node, subject: string): boolean {
  switch (node.type) {
    case "Identifier":
      return (node as t.Identifier).name === "undefined";
    case "MemberExpression": {
      const m = node as t.MemberExpression;
      if (!t.isIdentifier(m.object) || m.object.name !== subject) return false;
      if (m.computed) {
        if (t.isStringLiteral(m.property)) return m.property.value.indexOf(".") === -1;
        return t.isNumericLiteral(m.property) && Number.isSafeInteger(m.property.value);
      }
      return t.isIdentifier(m.property);
    }
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

/** Root identifier of the first depth-1 member read found. */
function findSubjectCandidate(node: t.Node): string | null {
  if (t.isMemberExpression(node) && t.isIdentifier(node.object)) return node.object.name;
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
  const eligible = dynamics.map(d => isEligibleExpr(d.value, subject!));
  if (!eligible.some(Boolean)) return null;
  return { subject, eligible };
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
