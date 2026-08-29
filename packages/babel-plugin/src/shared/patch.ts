/**
 * Patch-mode eligibility + emission (DESIGN-PATCH-CHANNEL.md, PR-C).
 *
 * A template scope qualifies for patch mode when EVERY dynamic binding's
 * value is a pure expression over member reads of ONE stable subject
 * identifier (Tier 1: bare member chains; Tier 2: ternary/binary/logical/
 * template-literal/unary compositions of Tier-1 reads and literals).
 * Anything else — calls, assignments, functions, foreign identifiers —
 * disqualifies the SCOPE (per-binding islands remain future work; v1 is
 * all-or-nothing per template scope, matching the fixture shape).
 *
 * Emission (dual driver, shared body):
 *
 *   _$patchDriver(subject, (_n$, _p$, _f$) => {
 *     let _v$;
 *     if (_f$ || (_v$ = <expr(_n$)>) !== <expr(_p$)>) <setAttr(..., _v$)>;
 *     ...
 *   });
 *
 * The runtime driver registers on the store's patch channel when the
 * subject is a patchable record, else falls back to a tracked force-mode
 * effect running the same body (reads through the subject track; force
 * short-circuits every compare, so `prev` is never dereferenced there).
 * Semantics are therefore IDENTICAL either way; patch mode only changes
 * who dispatches.
 */
import * as t from "@babel/types";

// Node types allowed inside an eligible binding expression (Tier 1+2).
// `asMemberBase` marks the position at the root of a member chain: the bare
// subject identifier is ONLY eligible there (re-audit 7) — a standalone
// `{subject}` read has no key envelope, so the static manifest could never
// cover it; those scopes keep classic effects.
function isEligibleExpr(node: t.Node, subject: string, asMemberBase = false): boolean {
  switch (node.type) {
    case "Identifier":
      return (asMemberBase && node.name === subject) || node.name === "undefined";
    case "MemberExpression": {
      const m = node as t.MemberExpression;
      if (m.computed) {
        // Literal keys only — and no "." inside string keys, which would
        // collide with the manifest's path separator (re-audit 7).
        if (t.isStringLiteral(m.property)) {
          if (m.property.value.indexOf(".") !== -1) return false;
        } else if (!t.isNumericLiteral(m.property)) {
          return false;
        }
      } else if (!t.isIdentifier(m.property)) {
        return false;
      }
      return isEligibleExpr(m.object, subject, true);
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
      return isEligibleExpr(b.left, subject) && isEligibleExpr(b.right, subject);
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

/** Find the single subject: the root identifier of the FIRST member chain
 * encountered. Every other read must root at the same name. */
function findSubject(node: t.Node): string | null {
  switch (node.type) {
    case "MemberExpression":
      return findSubject((node as t.MemberExpression).object);
    case "Identifier":
      return (node as t.Identifier).name === "undefined" ? null : (node as t.Identifier).name;
    case "ConditionalExpression":
      return (
        findSubject((node as t.ConditionalExpression).test) ??
        findSubject((node as t.ConditionalExpression).consequent) ??
        findSubject((node as t.ConditionalExpression).alternate)
      );
    case "BinaryExpression":
    case "LogicalExpression":
      return (
        findSubject((node as any).left as t.Node) ?? findSubject((node as any).right as t.Node)
      );
    case "UnaryExpression":
      return findSubject((node as t.UnaryExpression).argument);
    case "TemplateLiteral": {
      for (const e of (node as t.TemplateLiteral).expressions) {
        const s = findSubject(e);
        if (s) return s;
      }
      return null;
    }
    case "ParenthesizedExpression":
      return findSubject((node as t.ParenthesizedExpression).expression);
    default:
      return null;
  }
}

export interface PatchEligibility {
  subject: string;
}

/** Analyze a template scope's dynamic binding values. Returns the subject
 * when EVERY value is an eligible pure expression over it, else null. */
export function analyzePatchEligibility(values: t.Expression[]): PatchEligibility | null {
  if (values.length === 0) return null;
  let subject: string | null = null;
  for (const v of values) {
    const s = findSubject(v);
    if (s === null) return null; // static-only binding: no dispatch source
    if (subject === null) subject = s;
    else if (subject !== s) return null; // multi-subject: Q3 territory, bail in v1
  }
  if (subject === null) return null;
  for (const v of values) {
    if (!isEligibleExpr(v, subject)) return null;
  }
  return { subject };
}

/** Collect the STATIC read manifest (re-audit 7, P1-1): every member path
 * rooted at the subject, dot-joined ("label", "queries.0.elapsed"). The
 * grammar makes this complete — keys are identifier/literal-only, so every
 * read any branch can perform is syntactically present. The runtime probes
 * exactly these keys/paths at adoption seams; runtime recording could never
 * see an untaken ternary branch. Order: dynamics order, chains innermost-
 * first within each expression, first occurrence kept (mirrored byte-for-
 * byte by the Oxc compiler). */
export function collectSubjectPaths(values: t.Expression[], subject: string): string[] {
  const paths: string[] = [];
  const chainOf = (m: t.MemberExpression): string | null => {
    const segs: string[] = [];
    let cur: t.Node = m;
    while (t.isMemberExpression(cur)) {
      const prop = cur.property;
      if (t.isIdentifier(prop) && !cur.computed) segs.push(prop.name);
      else if (t.isStringLiteral(prop)) segs.push(prop.value);
      else if (t.isNumericLiteral(prop)) segs.push(String(prop.value));
      else return null;
      cur = cur.object;
    }
    if (!t.isIdentifier(cur) || cur.name !== subject) return null;
    return segs.reverse().join(".");
  };
  const walk = (node: t.Node): void => {
    if (t.isMemberExpression(node)) {
      const chain = chainOf(node);
      if (chain !== null) {
        if (paths.indexOf(chain) === -1) paths.push(chain);
        return; // the whole chain is consumed — don't descend
      }
    }
    for (const key of Object.keys(node)) {
      const value: any = (node as any)[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item.type === "string") walk(item);
        }
      } else if (value && typeof value.type === "string") {
        walk(value);
      }
    }
  };
  for (const v of values) walk(v);
  return paths;
}

/** Clone `expr` substituting the subject identifier with `replacement`.
 * Safe because eligibility rejected functions/shadowing constructs. */
export function substituteSubject(
  expr: t.Expression,
  subject: string,
  replacement: t.Identifier
): t.Expression {
  const clone = t.cloneNode(expr, true);
  const rewrite = (node: t.Node): t.Node => {
    if (t.isIdentifier(node) && node.name === subject) return t.cloneNode(replacement);
    for (const key of Object.keys(node)) {
      const value: any = (node as any)[key];
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (value[i] && typeof value[i].type === "string") value[i] = rewrite(value[i]);
        }
      } else if (value && typeof value.type === "string") {
        // Never rewrite non-computed member PROPERTY positions.
        if (t.isMemberExpression(node) && key === "property" && !node.computed) continue;
        (node as any)[key] = rewrite(value);
      }
    }
    return node;
  };
  return rewrite(clone) as t.Expression;
}
