import * as t from "@babel/types";
import type { NodePath, Binding, Scope } from "@babel/traverse";
import type { PluginConfig } from "../config";
import type { ProgramScopeData } from "../types";

/**
 * Hoisted props shapes (SSR, #3511).
 *
 * A component's compiled props literal with getters —
 *
 *   Comp({ as: "a", get label() { return props.label; } })
 *
 * — is a dictionary-mode object in V8: an object literal with an accessor
 * skips the boilerplate fast path and takes per-property definition, and it
 * allocates a closure per getter per instance. Component-heavy server
 * renders spend 15–48% of their CPU there.
 *
 * On the server every such site becomes a module-level constructor whose
 * getters are SHARED across instances and read their state off the
 * instance, so V8 sees one hidden class per site and no closures:
 *
 *   var _m$ = Symbol();
 *   var _d$ = { get() { const props = this[_m$]; return props.label; },
 *               enumerable: true, configurable: true };
 *   function _P$(_p, _p2) { this[_m$] = _p; this.as = _p2;
 *                           Object.defineProperty(this, "label", _d$); }
 *   _P$.prototype = Object.prototype;
 *   Comp(new _P$(props, "a"))
 *
 * The instance is a plain object to every observer — same own keys, in the
 * same order, with the same descriptors (data for a literal attribute,
 * accessor for an expression, so `isStatic` reads the same kind), prototype
 * `Object.prototype`. The one contract: a getter is defined only for a read
 * THROUGH its object; a descriptor forwarded onto another object throws
 * there (dev output names the rule). Locals a getter body closes over are
 * captured by value at construction, which is only equivalent when the
 * binding can never change — anything else keeps today's literal at that
 * one site (`fallback` below). DOM output is untouched: measured, the client
 * gains nothing in time and pays in bytes.
 *
 * Runs at Program exit over literals `transformComponent` marked, after all
 * JSX (including JSX in attribute values) is compiled, so every getter body
 * is final. Post-order, so a site nested in another's getter is hoisted
 * first and the outer body then merely references its constructor.
 */

/** Props literals `transformComponent` emitted → source offset of their JSX
 * element (the literal itself is synthesized and has none), used to order a
 * captured binding's declaration against the site. */
const marked = new WeakMap<t.ObjectExpression, number | null | undefined>();

/** `transformComponent` marks each props literal it emits for a component call. */
export function markPropsLiteral(
  node: t.ObjectExpression,
  path: NodePath,
  config: PluginConfig
): void {
  if (config.generate !== "ssr" || !config.hoistProps) return;
  marked.set(node, path.node.start);
  const data = path.scope.getProgramParent().data as ProgramScopeData;
  data.propsSites = (data.propsSites ?? 0) + 1;
}

interface HoistState {
  program: NodePath<t.Program>;
  scope: Scope;
  config: PluginConfig;
  symbols: t.Identifier[];
  hoisted: t.Statement[];
}

const RECEIVER_MESSAGE =
  "A props getter was read on an object that is not its props (a copied property descriptor?). " +
  "Read through the props object, or use omit()/merge().";

export function hoistProps(program: NodePath<t.Program>, config: PluginConfig): void {
  const data = program.scope.data as ProgramScopeData;
  if (!data.propsSites) return;
  data.propsSites = 0;

  // The transforms above declared their temps and `_self$` captures by node
  // insertion; one crawl makes every binding, reference and reassignment in
  // the file known before the bodies are analysed. The crawl also resets the
  // program scope's `uids` (the names generateUid handed out — `hasUid` is
  // how a compiler temp is told from user code below) and `data` (imports,
  // templates, events — what postprocess is about to place); both survive.
  const uids = program.scope.uids;
  program.scope.crawl();
  Object.assign(program.scope.uids, uids);
  program.scope.data = data as Record<string | symbol, unknown>;

  const state: HoistState = {
    program,
    scope: program.scope,
    config,
    symbols: [],
    hoisted: []
  };
  // On exit: a site nested in another's getter is hoisted before the outer
  // one analyses that body; siblings keep source order.
  program.traverse({
    ObjectExpression: {
      exit(p) {
        if (marked.has(p.node)) hoistSite(p, state);
      }
    }
  });
  if (!state.hoisted.length) return;

  const decls: t.Statement[] = [];
  if (state.symbols.length) {
    decls.push(
      t.variableDeclaration(
        "var",
        state.symbols.map(id =>
          t.variableDeclarator(id, t.callExpression(t.identifier("Symbol"), []))
        )
      )
    );
  }
  data.hoistedProps = [...decls, ...state.hoisted];
}

/** The `var _m$ = Symbol()` declarations and per-site shapes, for postprocess. */
export function takeHoistedProps(program: NodePath<t.Program>): t.Statement[] | undefined {
  const data = program.scope.data as ProgramScopeData;
  const out = data.hoistedProps;
  data.hoistedProps = undefined;
  return out;
}

type Method = NodePath<t.ObjectMethod>;

interface Capture {
  binding: Binding;
  name: string;
  index: number;
}

function keyName(node: t.ObjectProperty | t.ObjectMethod): string | undefined {
  if (node.computed) return undefined;
  if (t.isIdentifier(node.key)) return node.key.name;
  if (t.isStringLiteral(node.key)) return node.key.value;
  return undefined;
}

/** Is `path` inside a non-arrow function that is itself inside `stop`? Such
 * a function has its own `this`/`arguments`; what it closes over is fine. */
function insideRealFunction(path: NodePath, stop: NodePath): boolean {
  let fn = path.getFunctionParent();
  while (fn && fn !== stop) {
    if (!fn.isArrowFunctionExpression()) return true;
    fn = fn.parentPath!.getFunctionParent();
  }
  return false;
}

/** Is `binding` initialized by the time the site constructs its props? The
 * getter read it lazily; the constructor reads it now. A parameter or a
 * hoisted function always is. Otherwise the declaration must precede the
 * site in source, and the site must not sit inside the declaration's own
 * initializer (`const x = <Comp a={x} />` reads `x` lazily today). */
function declaredBefore(
  binding: Binding,
  site: NodePath,
  siteStart: number | null | undefined,
  scope: Scope
): boolean {
  if (binding.kind === "param" || binding.kind === "hoisted") return true;
  if (site.isDescendant(binding.path)) return false;
  const decl = binding.identifier.start;
  if (decl == null || siteStart == null) {
    // A compiler-made binding (`_self$`) has no source position; it is
    // declared right before the statement that uses it.
    return decl == null && scope.hasUid(binding.identifier.name);
  }
  return decl < siteStart;
}

/** The SSR template emits `(_v$ = init, ssr(_tmpl$, _v$))` with `var _v$;`
 * hoisted to the enclosing function. A temp that lives only inside `m` is
 * declared inside it instead. */
function isLocalTemp(binding: Binding, m: Method, scope: Scope): boolean {
  return (
    binding.kind === "var" &&
    scope.hasUid(binding.identifier.name) &&
    binding.path.isVariableDeclarator() &&
    !binding.path.node.init &&
    binding.referencePaths.every(r => r.isDescendant(m)) &&
    binding.constantViolations.every(r => r.isDescendant(m))
  );
}

function hoistSite(p: NodePath<t.ObjectExpression>, state: HoistState): void {
  const fnParent = p.getFunctionParent();
  if (!fnParent) return; // module-level: built once, nothing to win
  const siteStart = marked.get(p.node);
  const props = p.get("properties");
  const methods = props.filter((q): q is Method => q.isObjectMethod());
  if (!methods.some(q => q.node.kind === "get")) return;

  // ---- shape: what a constructor can express -------------------------------
  const seen = new Set<string>();
  for (const q of props) {
    if (q.isSpreadElement()) return;
    const key = keyName(q.node as t.ObjectProperty | t.ObjectMethod);
    if (key === undefined || key === "__proto__" || seen.has(key)) return;
    seen.add(key);
    if (q.isObjectMethod() && q.node.kind === "method" && key !== "ref") return;
    if (q.isObjectMethod() && q.node.kind === "set") return;
  }

  // ---- captures: what the bodies close over ---------------------------------
  const captures = new Map<Binding, Capture>();
  const temps = new Map<Method, Binding[]>();
  const usesByMethod = new Map<Method, Set<Binding>>();
  const scope = state.scope;
  let fallback = false;

  for (const m of methods) {
    const uses = new Set<Binding>();
    const localTemps: Binding[] = [];
    usesByMethod.set(m, uses);
    temps.set(m, localTemps);
    m.traverse({
      enter(q) {
        if (fallback) {
          q.stop();
          return;
        }
        if (q.isThisExpression() || q.isSuper()) {
          if (!insideRealFunction(q, m)) fallback = true;
          return;
        }
        if (q.isPrivateName()) {
          fallback = true; // `#x in o` only parses inside its class body
          return;
        }
        if (q.isMetaProperty()) {
          if (q.node.meta.name === "new" && !insideRealFunction(q, m)) fallback = true;
          return;
        }
        if (!q.isIdentifier()) return;
        const name = q.node.name;
        let write = false;
        if (
          (q.parentPath.isAssignmentExpression() && q.parentPath.node.left === q.node) ||
          q.parentPath.isUpdateExpression()
        ) {
          write = true;
        } else if (!q.isReferencedIdentifier()) return;

        const binding = q.scope.getBinding(name);
        if (!binding) {
          // A global, or a template id (`_tmpl$`) postprocess declares at
          // module level after this: visible from module level as from here.
          if (name === "arguments" && !insideRealFunction(q, m)) fallback = true;
          return;
        }
        if (binding.scope.path.isProgram()) return; // module-level: read live
        if (binding.path.isDescendant(m) || binding.scope.path.isDescendant(m)) return;
        if (binding.path.node === m.node) return;

        if (localTemps.includes(binding)) return;
        if (isLocalTemp(binding, m, scope)) {
          localTemps.push(binding);
          return;
        }
        if (write || !binding.constant || !declaredBefore(binding, p, siteStart, scope)) {
          fallback = true;
          return;
        }
        let capture = captures.get(binding);
        if (!capture) {
          capture = { binding, name, index: captures.size };
          captures.set(binding, capture);
        }
        uses.add(binding);
      }
    });
    if (fallback) return;
  }

  // ---- emission ---------------------------------------------------------------
  while (state.symbols.length < captures.size) {
    state.symbols.push(scope.generateUidIdentifier("m$"));
  }
  const ctorId = scope.generateUidIdentifier("P$");
  const params: t.Identifier[] = [];
  const args: t.Expression[] = [];
  const body: t.Statement[] = [];
  const descriptors: t.VariableDeclarator[] = [];

  for (const capture of captures.values()) {
    const param = scope.generateUidIdentifier("p");
    params.push(param);
    args.push(t.identifier(capture.name));
    body.push(
      t.expressionStatement(
        t.assignmentExpression(
          "=",
          t.memberExpression(t.thisExpression(), state.symbols[capture.index], true),
          param
        )
      )
    );
  }

  const aliases = (m: Method): t.Statement[] => {
    const out: t.Statement[] = [];
    const used = usesByMethod.get(m)!;
    if (state.config.dev && used.size && m.node.kind === "get") {
      // Dev names the rule when a forwarded descriptor is read elsewhere.
      const first = captures.get([...used][0])!;
      out.push(
        t.ifStatement(
          t.unaryExpression(
            "!",
            t.binaryExpression("in", state.symbols[first.index], t.thisExpression())
          ),
          t.throwStatement(
            t.newExpression(t.identifier("Error"), [t.stringLiteral(RECEIVER_MESSAGE)])
          )
        )
      );
    }
    for (const b of used) {
      const capture = captures.get(b)!;
      out.push(
        t.variableDeclaration("const", [
          t.variableDeclarator(
            t.identifier(capture.name),
            t.memberExpression(t.thisExpression(), state.symbols[capture.index], true)
          )
        ])
      );
    }
    const localTemps = temps.get(m)!;
    if (localTemps.length) {
      out.push(
        t.variableDeclaration(
          "var",
          localTemps.map(b => t.variableDeclarator(t.identifier(b.identifier.name)))
        )
      );
      for (const b of localTemps) b.path.remove();
    }
    return out;
  };

  for (const q of props) {
    const node = q.node as t.ObjectProperty | t.ObjectMethod;
    const key = keyName(node)!;
    const plainKey = t.isValidIdentifier(key, false); // `this.class` is fine
    const own = t.memberExpression(
      t.thisExpression(),
      plainKey ? t.identifier(key) : t.stringLiteral(key),
      !plainKey
    );
    if (q.isObjectProperty()) {
      const param = scope.generateUidIdentifier("p");
      params.push(param);
      args.push(q.node.value as t.Expression);
      body.push(t.expressionStatement(t.assignmentExpression("=", own, param)));
      continue;
    }
    const m = q as Method;
    const fnBody = t.blockStatement([...aliases(m), ...m.node.body.body]);
    if (m.node.kind === "get") {
      const descriptor = scope.generateUidIdentifier("d$");
      descriptors.push(
        t.variableDeclarator(
          descriptor,
          t.objectExpression([
            t.objectMethod("method", t.identifier("get"), [], fnBody),
            t.objectProperty(t.identifier("enumerable"), t.booleanLiteral(true)),
            t.objectProperty(t.identifier("configurable"), t.booleanLiteral(true))
          ])
        )
      );
      body.push(
        t.expressionStatement(
          t.callExpression(
            t.memberExpression(t.identifier("Object"), t.identifier("defineProperty")),
            [t.thisExpression(), t.stringLiteral(key), descriptor]
          )
        )
      );
    } else {
      // `ref(r$) {…}`: an own data property holding a per-instance arrow — a
      // consumer calls it detached (`applyRef(r, el)`), so it cannot use `this`.
      body.push(
        t.expressionStatement(
          t.assignmentExpression("=", own, t.arrowFunctionExpression(m.node.params, fnBody))
        )
      );
    }
  }

  if (descriptors.length) state.hoisted.push(t.variableDeclaration("var", descriptors));
  state.hoisted.push(t.functionDeclaration(ctorId, params, t.blockStatement(body)));
  state.hoisted.push(
    t.expressionStatement(
      t.assignmentExpression(
        "=",
        t.memberExpression(ctorId, t.identifier("prototype")),
        t.memberExpression(t.identifier("Object"), t.identifier("prototype"))
      )
    )
  );
  p.replaceWith(t.newExpression(ctorId, args));
}
