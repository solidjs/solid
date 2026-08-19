import ts from "typescript";

/**
 * Prototype static rule: reactive reads in un-annotated helpers.
 *
 * The runtime hazard this checks for: calling a function inside a tracked
 * scope subscribes the CALLER to every signal/store read the function
 * performs, but the call site gives no hint — `getUserLabel()` and
 * `formatDate(d)` look identical, and only one wires you into the reactive
 * graph. This rule makes the declaration site carry that information: any
 * function that (transitively) reads reactive state must say so.
 *
 * A function counts as READING reactive state when it:
 *  - calls an accessor bound from `createSignal` / `createMemo` /
 *    `createAsync` (`count()`),
 *  - accesses a property on a proxy bound from `createStore` /
 *    `createProjection` (`state.notifications`),
 *  - calls a parameter typed `Accessor<...>` (the type-based heuristic), or
 *  - calls another module-local function already classified reactive
 *    (propagation up the call graph — the `getUserLabel` drift case).
 *
 * A reactive function is EXEMPT (already declared) when it:
 *  - has a `@reactive` JSDoc tag,
 *  - declares a `Reactive<...>` return type (type-level branding), or
 *  - is passed directly to a tracking primitive (`createMemo`,
 *    `createEffect`, ...) — being a tracked scope is its declaration.
 *
 * This is deliberately the "useful 80%": single-module, syntactic, no type
 * checker. Cross-module propagation would key off the `Reactive<...>` brand
 * in signatures — the brand is what makes the analysis composable.
 */

export interface LintFinding {
  functionName: string;
  line: number; // 1-based
  column: number; // 1-based
  /** Human-readable evidence: what it reads, directly or via which callee. */
  evidence: string[];
  message: string;
}

const SIGNAL_SOURCES = new Set(["createSignal"]);
const ACCESSOR_SOURCES = new Set(["createMemo", "createAsync"]);
const STORE_SOURCES = new Set(["createStore", "createProjection", "createOptimisticStore"]);
/** Functions whose function-arguments are tracked scopes (exempt as callees). */
const TRACKING_PRIMITIVES = new Set([
  "createMemo",
  "createAsync",
  "createEffect",
  "createRenderEffect",
  "createComputed",
  "createReaction",
  "mapArray",
  "repeat"
]);

interface FnInfo {
  name: string;
  node: ts.SignatureDeclaration & { body?: ts.Node };
  directReads: string[]; // evidence strings for direct reactive reads
  calls: Set<string>; // names of module-local functions it calls
  exempt: boolean;
  reactive: boolean;
  via: string | null; // callee that made it reactive transitively
}

function hasReactiveJsDoc(node: ts.Node): boolean {
  return ts.getJSDocTags(node).some(tag => tag.tagName.text === "reactive");
}

function hasReactiveReturnType(node: ts.SignatureDeclaration): boolean {
  const t = node.type;
  return (
    t !== undefined &&
    ts.isTypeReferenceNode(t) &&
    ts.isIdentifier(t.typeName) &&
    t.typeName.text === "Reactive"
  );
}

function isAccessorTypedParam(p: ts.ParameterDeclaration): boolean {
  const t = p.type;
  return (
    t !== undefined &&
    ts.isTypeReferenceNode(t) &&
    ts.isIdentifier(t.typeName) &&
    (t.typeName.text === "Accessor" || t.typeName.text === "SourceAccessor")
  );
}

export function analyzeReactiveHelpers(source: string, fileName = "module.tsx"): LintFinding[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  // Pass 1: module-level reactive bindings.
  const accessors = new Set<string>(); // count, label, ...
  const stores = new Set<string>(); // state, ...
  const trackedScopeFns = new Set<ts.Node>(); // function args to tracking primitives

  const calleeName = (call: ts.CallExpression): string | null =>
    ts.isIdentifier(call.expression) ? call.expression.text : null;

  const bindingVisitor = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      const callee = calleeName(node.initializer);
      if (callee !== null) {
        if (SIGNAL_SOURCES.has(callee) || STORE_SOURCES.has(callee)) {
          // const [get, set] = createSignal(...) / const [state, setState] = createStore(...)
          if (ts.isArrayBindingPattern(node.name) && node.name.elements.length > 0) {
            const first = node.name.elements[0];
            if (ts.isBindingElement(first) && ts.isIdentifier(first.name)) {
              (SIGNAL_SOURCES.has(callee) ? accessors : stores).add(first.name.text);
            }
          }
        } else if (ACCESSOR_SOURCES.has(callee) && ts.isIdentifier(node.name)) {
          accessors.add(node.name.text);
        }
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = calleeName(node);
      if (callee !== null && TRACKING_PRIMITIVES.has(callee)) {
        for (const arg of node.arguments) {
          if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) trackedScopeFns.add(arg);
          else if (ts.isIdentifier(arg)) trackedScopeFns.add(arg); // marker; resolved by name below
        }
      }
    }
    ts.forEachChild(node, bindingVisitor);
  };
  bindingVisitor(sf);

  const trackedScopeNames = new Set<string>();
  for (const n of trackedScopeFns) if (ts.isIdentifier(n)) trackedScopeNames.add(n.text);

  // Pass 2: collect module-local functions and their reads/calls.
  const fns = new Map<string, FnInfo>();

  const registerFn = (
    name: string,
    fnNode: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
    docHost: ts.Node
  ): void => {
    const info: FnInfo = {
      name,
      node: fnNode,
      directReads: [],
      calls: new Set(),
      exempt:
        hasReactiveJsDoc(docHost) ||
        hasReactiveJsDoc(fnNode) ||
        hasReactiveReturnType(fnNode) ||
        trackedScopeFns.has(fnNode) ||
        trackedScopeNames.has(name),
      reactive: false,
      via: null
    };
    const paramAccessors = new Set<string>();
    for (const p of fnNode.parameters) {
      if (isAccessorTypedParam(p) && ts.isIdentifier(p.name)) paramAccessors.add(p.name.text);
    }
    const bodyVisitor = (n: ts.Node): void => {
      // Nested callbacks (`.map(x => ...)`) run during the call, so their
      // reads belong to this function — but a tracked scope created inside
      // (`createEffect(() => ...)` in a component body) owns its own reads.
      if (trackedScopeFns.has(n)) return;
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const callee = n.expression.text;
        if (accessors.has(callee)) info.directReads.push(`signal read "${callee}()"`);
        else if (paramAccessors.has(callee))
          info.directReads.push(`accessor-typed parameter "${callee}()"`);
        else info.calls.add(callee);
      }
      if (
        (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) &&
        ts.isIdentifier(n.expression) &&
        stores.has(n.expression.text)
      ) {
        const prop =
          ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.name) ? `.${n.name.text}` : "[...]";
        info.directReads.push(`store read "${n.expression.text}${prop}"`);
      }
      ts.forEachChild(n, bodyVisitor);
    };
    if (fnNode.body) bodyVisitor(fnNode.body);
    fns.set(name, info);
  };

  const fnVisitor = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      registerFn(node.name.text, node, node);
    } else if (ts.isVariableStatement(node) && node.declarationList.declarations.length === 1) {
      const decl = node.declarationList.declarations[0];
      if (
        ts.isIdentifier(decl.name) &&
        decl.initializer !== undefined &&
        (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
      ) {
        registerFn(decl.name.text, decl.initializer, node);
      }
    }
    ts.forEachChild(node, fnVisitor);
  };
  fnVisitor(sf);

  // Pass 3: fixpoint propagation up the call graph.
  let changedInPass = true;
  while (changedInPass) {
    changedInPass = false;
    for (const info of fns.values()) {
      if (info.reactive) continue;
      if (info.directReads.length > 0) {
        info.reactive = true;
        changedInPass = true;
        continue;
      }
      for (const callee of info.calls) {
        const c = fns.get(callee);
        if (c !== undefined && c.reactive) {
          info.reactive = true;
          info.via = callee;
          changedInPass = true;
          break;
        }
      }
    }
  }

  // Pass 4: report reactive, un-annotated functions.
  const findings: LintFinding[] = [];
  for (const info of fns.values()) {
    if (!info.reactive || info.exempt) continue;
    // Components (PascalCase) are exempt: their bodies run untracked by
    // convention, and the runtime strict-read diagnostics own that case.
    if (/^[A-Z]/.test(info.name)) continue;
    const pos = sf.getLineAndCharacterOfPosition(info.node.getStart(sf));
    const evidence =
      info.directReads.length > 0
        ? [...new Set(info.directReads)]
        : [`calls reactive function "${info.via}()"`];
    findings.push({
      functionName: info.name,
      line: pos.line + 1,
      column: pos.character + 1,
      evidence,
      message:
        `Function "${info.name}" reads reactive state (${evidence.join("; ")}) but does not ` +
        `declare it — every tracked caller silently subscribes to those sources. ` +
        `Annotate it /** @reactive */, give it a Reactive<...> return type, or wrap it in createMemo.`
    });
  }
  return findings.sort((a, b) => a.line - b.line);
}
