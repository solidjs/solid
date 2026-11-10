import * as t from "@babel/types";
import type { NodePath, Scope, Binding } from "@babel/traverse";
import type { PluginConfig } from "../config";

/**
 * `<Show>` lowered to the ternary it renders (production builds).
 *
 * `{when ? children : fallback}` compiles to a memo of `!!when` and a memo
 * that renders the branch it selects: what `<Show>` does for JSX children
 * without `keyed`, minus the component call, the props object with its
 * getters, and two of its three memos.
 *
 * A callback child `{u => <b>{u().name}</b>}` becomes its body with each
 * `u()` read as `when` again. Only a `when` that reads names, members,
 * literals, operators and `const` signal/memo getters is copied, so a second
 * read gives the same value with nothing run in between. A binding that reads
 * the copy reads `when`'s own sources, so it is the same frame reader the
 * accessor's tracked guard made it (#4354, #3948, #4648); a read after the
 * branch closed reads the falsy value instead of throwing the stale-read
 * error, which dev builds keep (they keep the component).
 *
 * Anything else keeps the component: `keyed`, a spread, another prop, a
 * string `when`, a callback that is not one identifier param with a JSX
 * body, a child that could be a function, or a position where the ternary
 * would not be tracked (a component's non-sole child, an attribute, inside a
 * JSX expression).
 */

const SOLID_SOURCES = new Set(["solid-js", "@solidjs/web"]);

type ElementPath = NodePath<t.JSXElement>;

export function lowerShow(program: NodePath<t.Program>, config: PluginConfig): void {
  program.traverse({
    JSXElement: {
      // Exit: an inner `<Show>` lowers first, so an outer one copies its
      // already-lowered children.
      exit(path) {
        if (solidName(path, path.node.openingElement.name, config) !== "Show") return;
        const form = formAt(path);
        if (!form) return;
        const ternary = showTernary(path, config);
        if (!ternary) return;
        // The Show's location, so `sourceNames.locations` labels the hole
        // as the native compiler does.
        ternary.loc = path.node.loc;
        const container = t.jsxExpressionContainer(ternary);
        container.loc = path.node.loc;
        path.replaceWith(
          form === "container"
            ? container
            : t.jsxFragment(t.jsxOpeningFragment(), t.jsxClosingFragment(), [container])
        );
      }
    }
  });
}

/** The Solid export a JSX tag or callee resolves to, if any. */
function solidName(path: NodePath, name: t.Node, config: PluginConfig): string | undefined {
  if (!t.isJSXIdentifier(name) && !t.isIdentifier(name)) return undefined;
  const binding = path.scope.getBinding(name.name);
  if (!binding) {
    // An auto-imported builtin (`config.builtIns`) when unbound.
    return t.isJSXIdentifier(name) && config.builtIns.includes(name.name) ? name.name : undefined;
  }
  return importedName(binding, config);
}

function importedName(binding: Binding, config: PluginConfig): string | undefined {
  if (binding.kind !== "module") return undefined;
  const spec = binding.path.node;
  const decl = binding.path.parent;
  if (!t.isImportSpecifier(spec) || !t.isImportDeclaration(decl)) return undefined;
  if (decl.importKind === "type" || spec.importKind === "type") return undefined;
  const source = decl.source.value;
  if (!SOLID_SOURCES.has(source) && source !== config.moduleName) return undefined;
  return t.isIdentifier(spec.imported) ? spec.imported.name : spec.imported.value;
}

type Form = "container" | "fragment";

/**
 * How the lowered ternary is written where the `<Show>` stands: a child of an
 * element or fragment is a tracked expression container; a component's sole
 * child, or JSX outside JSX (a return value), is wrapped in a fragment, which
 * compiles to a memo — a bare ternary as `props.children` would re-evaluate on
 * every read.
 */
function formAt(path: ElementPath): Form | undefined {
  const parent = path.parentPath;
  if (parent.isJSXFragment()) return "container";
  if (parent.isJSXElement()) {
    const name = parent.node.openingElement.name;
    if (t.isJSXNamespacedName(name) || (t.isJSXIdentifier(name) && /^[a-z]/.test(name.name)))
      return "container";
    return parent.node.children.every(c => c === path.node || isInsignificant(c))
      ? "fragment"
      : undefined;
  }
  if (parent.isJSXExpressionContainer() || parent.isJSXAttribute()) return undefined;
  // Outside JSX: not when part of an expression inside a JSX container
  // (`{ok && <Show/>}`), where no function boundary separates them.
  let current: NodePath | null = parent;
  while (current && !current.isFunction()) {
    if (current.isJSXExpressionContainer()) return undefined;
    current = current.parentPath;
  }
  return "fragment";
}

function isInsignificant(child: t.Node): boolean {
  return (
    (t.isJSXText(child) && /^\s*$/.test(child.value) && child.value.includes("\n")) ||
    (t.isJSXExpressionContainer(child) && t.isJSXEmptyExpression(child.expression))
  );
}

function significantChildren(children: t.JSXElement["children"]): t.JSXElement["children"] {
  return children.filter(c => !isInsignificant(c));
}

function showTernary(path: ElementPath, config: PluginConfig): t.Expression | undefined {
  let when: t.Expression | undefined;
  let whenPath: NodePath<t.Expression> | undefined;
  let fallback: t.Expression | undefined;
  const seen = new Set<string>();
  const attributes = path.get("openingElement").get("attributes");
  for (const attribute of attributes) {
    if (!attribute.isJSXAttribute()) return undefined;
    const name = attribute.node.name;
    if (!t.isJSXIdentifier(name) || seen.has(name.name)) return undefined;
    seen.add(name.name);
    const value = attribute.node.value;
    let expr: t.Expression;
    if (t.isJSXExpressionContainer(value)) {
      if (t.isJSXEmptyExpression(value.expression)) return undefined;
      expr = value.expression;
    } else if (t.isJSXElement(value) || t.isJSXFragment(value)) expr = value;
    // A bare or string attribute: leave it to the component.
    else return undefined;
    if (name.name === "when") {
      when = expr;
      if (t.isJSXExpressionContainer(value))
        whenPath = (attribute.get("value") as NodePath<t.JSXExpressionContainer>).get(
          "expression"
        ) as NodePath<t.Expression>;
    } else if (name.name === "fallback") fallback = expr;
    else return undefined;
  }
  if (!when) return undefined;

  const significant = significantChildren(path.node.children);
  const sole = significant.length === 1 ? significant[0] : undefined;
  let children: t.Expression;
  const soleExpr =
    t.isJSXExpressionContainer(sole) && !t.isJSXEmptyExpression(sole.expression)
      ? unwrap(sole.expression)
      : undefined;
  if (t.isArrowFunctionExpression(soleExpr) || t.isFunctionExpression(soleExpr)) {
    if (!t.isArrowFunctionExpression(soleExpr) || !whenPath) return undefined;
    const index = path.node.children.indexOf(sole!);
    const callbackPath = (path.get(`children.${index}`) as NodePath<t.JSXExpressionContainer>).get(
      "expression"
    ) as NodePath;
    const body = callbackBody(unwrapPath(callbackPath), whenPath, config);
    if (!body) return undefined;
    children = body;
  } else {
    // A sole child that could hold a function (`{render}`) gets the narrowed
    // value from the component.
    if (soleExpr && !isNeverFunction(soleExpr)) return undefined;
    for (const child of significant)
      if (
        t.isJSXExpressionContainer(child) &&
        !t.isJSXEmptyExpression(child.expression) &&
        t.isFunction(unwrap(child.expression))
      )
        return undefined;
    children = significant.length
      ? t.jsxFragment(t.jsxOpeningFragment(), t.jsxClosingFragment(), path.node.children)
      : t.unaryExpression("void", t.numericLiteral(0));
  }
  return t.conditionalExpression(
    when,
    children,
    fallback ?? t.unaryExpression("void", t.numericLiteral(0))
  );
}

function unwrap(node: t.Node): t.Node {
  while (
    t.isParenthesizedExpression(node) ||
    t.isTSAsExpression(node) ||
    t.isTSSatisfiesExpression(node) ||
    t.isTSNonNullExpression(node)
  )
    node = node.expression;
  return node;
}

function unwrapPath(path: NodePath): NodePath {
  while (
    path.isParenthesizedExpression() ||
    path.isTSAsExpression() ||
    path.isTSSatisfiesExpression() ||
    path.isTSNonNullExpression()
  )
    path = path.get("expression") as NodePath;
  return path;
}

/**
 * The callback's body with each read of its parameter written as `when`, or
 * undefined when that could change what the body renders.
 */
function callbackBody(
  callback: NodePath,
  whenPath: NodePath<t.Expression>,
  config: PluginConfig
): t.Expression | undefined {
  if (!callback.isArrowFunctionExpression()) return undefined;
  const node = callback.node;
  if (node.async || node.params.length !== 1 || !t.isIdentifier(node.params[0])) return undefined;
  const body = unwrap(node.body);
  // A body that is only JSX reads nothing as it is made: the component calls
  // it untracked, the ternary's branch makes it in its memo.
  if (!t.isJSXElement(body) && !t.isJSXFragment(body)) return undefined;
  if (!isPlainRead(whenPath, config)) return undefined;

  const param = node.params[0];
  const binding = callback.scope.getOwnBinding(param.name);
  if (!binding || binding.identifier !== param || !binding.constant) return undefined;
  if (namesInTypes(node.body, param.name)) return undefined;

  // Each name `when` reads must mean the same where the body reads it.
  const names: string[] = [];
  whenPath.traverse({
    Identifier(id) {
      if (id.isReferencedIdentifier()) names.push(id.node.name);
    }
  });
  if (whenPath.isIdentifier()) names.push(whenPath.node.name);
  const outer = new Map<string, Binding | undefined>();
  for (const name of names) outer.set(name, whenPath.scope.getBinding(name));
  const sameNames = (scope: Scope) => {
    for (const [name, b] of outer) if (scope.getBinding(name) !== b) return false;
    return true;
  };

  const edits: Array<() => void> = [];
  for (const ref of binding.referencePaths) {
    if (!ref.isIdentifier()) return undefined; // a JSX tag, `<u.X/>`
    if (!sameNames(ref.scope)) return undefined;
    const parent = ref.parentPath!;
    const copy = () => t.parenthesizedExpression(t.cloneNode(whenPath.node, true));
    if (
      parent.isCallExpression() &&
      parent.node.callee === ref.node &&
      parent.node.arguments.length === 0
    ) {
      edits.push(() => parent.replaceWith(copy()));
    } else if (parent.isObjectProperty() && parent.node.shorthand) {
      return undefined;
    } else if (parent.isOptionalCallExpression()) {
      return undefined;
    } else {
      edits.push(() => ref.replaceWith(t.arrowFunctionExpression([], copy())));
    }
  }
  for (const edit of edits) edit();
  return unwrap(callback.node.body) as t.Expression;
}

/**
 * Whether reading an expression again gives the same value with nothing run
 * in between: names, members, literals, operators, and calls of a `const`
 * signal or memo getter from Solid.
 */
function isPlainRead(path: NodePath, config: PluginConfig): boolean {
  const node = path.node;
  if (t.isIdentifier(node) || t.isLiteral(node))
    return !t.isTemplateLiteral(node) || !node.expressions.length;
  if (
    path.isParenthesizedExpression() ||
    path.isTSAsExpression() ||
    path.isTSSatisfiesExpression() ||
    path.isTSNonNullExpression()
  )
    return isPlainRead(path.get("expression") as NodePath, config);
  if (path.isMemberExpression() || path.isOptionalMemberExpression())
    return (
      isPlainRead(path.get("object") as NodePath, config) &&
      (!path.node.computed || isPlainRead(path.get("property") as NodePath, config))
    );
  if (path.isCallExpression())
    return path.node.arguments.length === 0 && isAccessor(path.get("callee") as NodePath, config);
  if (path.isUnaryExpression())
    return path.node.operator !== "delete" && isPlainRead(path.get("argument"), config);
  if (path.isBinaryExpression() || path.isLogicalExpression())
    return (
      isPlainRead(path.get("left") as NodePath, config) &&
      isPlainRead(path.get("right") as NodePath, config)
    );
  if (path.isConditionalExpression())
    return (
      isPlainRead(path.get("test"), config) &&
      isPlainRead(path.get("consequent"), config) &&
      isPlainRead(path.get("alternate"), config)
    );
  return false;
}

/** A `const` getter of `createSignal`/`createMemo` from Solid, never reassigned. */
function isAccessor(callee: NodePath, config: PluginConfig): boolean {
  if (!callee.isIdentifier()) return false;
  const binding = callee.scope.getBinding(callee.node.name);
  if (!binding || binding.kind !== "const" || !binding.constant) return false;
  const declarator = binding.path;
  if (!declarator.isVariableDeclarator() || !declarator.node.init) return false;
  const init = unwrap(declarator.node.init);
  if (!t.isCallExpression(init) || !t.isIdentifier(init.callee)) return false;
  const factory = declarator.scope.getBinding(init.callee.name);
  const name = factory && importedName(factory, config);
  if (name === "createMemo") return declarator.node.id === binding.identifier;
  return (
    name === "createSignal" &&
    t.isArrayPattern(declarator.node.id) &&
    declarator.node.id.elements[0] === binding.identifier
  );
}

/** Whether a type in `node` (`typeof u`) names `name`. */
function namesInTypes(node: t.Node, name: string): boolean {
  let found = false;
  t.traverseFast(node, n => {
    if (t.isTSTypeQuery(n) && t.isIdentifier(n.exprName) && n.exprName.name === name) found = true;
  });
  return found;
}

/** An expression whose value can never be a function. */
function isNeverFunction(node: t.Node): boolean {
  if (
    t.isLiteral(node) ||
    t.isJSXElement(node) ||
    t.isJSXFragment(node) ||
    t.isBinaryExpression(node) ||
    t.isUnaryExpression(node) ||
    t.isUpdateExpression(node)
  )
    return true;
  if (t.isParenthesizedExpression(node)) return isNeverFunction(node.expression);
  if (t.isConditionalExpression(node))
    return isNeverFunction(node.consequent) && isNeverFunction(node.alternate);
  if (t.isLogicalExpression(node)) return isNeverFunction(node.left) && isNeverFunction(node.right);
  return false;
}
