/**
 * Solid's TSRX lazy-destructuring transform.
 *
 * This is intentionally local to the Babel frontend. `@tsrx/core` still owns
 * parsing and semantic analysis, but its framework-agnostic lazy transform
 * cannot express Solid's reactive object-rest view or JavaScript-correct lazy
 * defaults and updates.
 *
 * The scope and pattern traversal is adapted from @tsrx/core 0.1.61's
 * MIT-licensed `src/transform/lazy.js`.
 */

import type { EsNode } from "./desugar";

type Bindings = Map<string, LazyBinding>;
type Metadata = {
  lazy_id?: string;
  has_lazy_descendants?: boolean;
  source_name?: string;
  source_length?: number;
  disable_verification?: boolean;
  lazy_param_binding_mappings?: { source: EsNode; generated: EsNode }[];
  lazy_source_accessor?: boolean;
};

interface LazyBinding {
  sourceName: string;
  read(reference: EsNode, bindings: Bindings): EsNode;
  target(reference: EsNode, bindings: Bindings): EsNode | null;
  jsxName(reference: EsNode, bindings: Bindings): EsNode | null;
  directDefault?: EsNode;
  complexDefault: boolean;
}

interface Access {
  raw(reference: EsNode, bindings: Bindings, selfName: string): EsNode;
  value(reference: EsNode, bindings: Bindings, selfName: string): EsNode;
  plain: boolean;
  jsxCompatible: boolean;
  directDefault?: EsNode;
  complexDefault: boolean;
}

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression"
]);

const TYPE_KEYS = new Set([
  "typeAnnotation",
  "typeParameters",
  "typeArguments",
  "superTypeArguments",
  "returnType",
  "implements"
]);

const SKIP_KEYS = new Set([
  "type",
  "loc",
  "start",
  "end",
  "range",
  "metadata",
  "leadingComments",
  "trailingComments",
  "innerComments"
]);

function isNode(value: unknown): value is EsNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function metadata(node: EsNode): Metadata {
  return (node.metadata ??= {}) as Metadata;
}

function withLoc<T extends EsNode>(node: T, source?: EsNode | null): T {
  if (source) {
    if (source.start !== undefined) node.start = source.start;
    if (source.end !== undefined) node.end = source.end;
    if (source.loc !== undefined) node.loc = source.loc;
  }
  return node;
}

function cloneNode<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneNode) as T;
  if (typeof value === "object" && value !== null) {
    const clone: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      clone[key] = cloneNode((value as Record<string, unknown>)[key]);
    }
    return clone as T;
  }
  return value;
}

function ident(name: string, source?: EsNode | null): EsNode {
  return withLoc({ type: "Identifier", name }, source);
}

function literal(value: string | number, source?: EsNode | null): EsNode {
  return withLoc({ type: "Literal", value, raw: JSON.stringify(value) }, source);
}

function undefinedExpression(source?: EsNode | null): EsNode {
  return withLoc(
    { type: "UnaryExpression", operator: "void", prefix: true, argument: literal(0, source) },
    source
  );
}

function member(object: EsNode, property: EsNode, computed: boolean, source?: EsNode): EsNode {
  return withLoc({ type: "MemberExpression", object, property, computed, optional: false }, source);
}

function call(callee: EsNode, args: EsNode[], source?: EsNode): EsNode {
  return withLoc({ type: "CallExpression", callee, arguments: args, optional: false }, source);
}

function assignment(operator: string, left: EsNode, right: EsNode, source?: EsNode): EsNode {
  return withLoc({ type: "AssignmentExpression", operator, left, right }, source);
}

function sequence(expressions: EsNode[], source?: EsNode): EsNode {
  return withLoc({ type: "SequenceExpression", expressions }, source);
}

function conditional(test: EsNode, consequent: EsNode, alternate: EsNode, source?: EsNode): EsNode {
  return withLoc({ type: "ConditionalExpression", test, consequent, alternate }, source);
}

function binary(operator: string, left: EsNode, right: EsNode, source?: EsNode): EsNode {
  return withLoc({ type: "BinaryExpression", operator, left, right }, source);
}

function logical(operator: string, left: EsNode, right: EsNode, source?: EsNode): EsNode {
  return withLoc({ type: "LogicalExpression", operator, left, right }, source);
}

function variableDeclaration(kind: "const" | "let", names: string[], init?: EsNode): EsNode {
  return {
    type: "VariableDeclaration",
    kind,
    declarations: names.map((name, index) => ({
      type: "VariableDeclarator",
      id: ident(name),
      init: index === 0 && init ? init : null
    }))
  };
}

function fail(message: string, node?: EsNode | null): never {
  const start = (node?.loc as { start?: { line: number; column: number } } | undefined)?.start;
  throw new SyntaxError(start ? `${message} (${start.line}:${start.column})` : message);
}

class LazyState {
  private readonly names = new Set<string>();
  private readonly next = new Map<string, number>();
  private readonly programTemps: string[] = [];
  private readonly tempScopes: string[][] = [this.programTemps];
  omitName?: string;
  arrayName?: string;
  usesArrayRest = false;
  topLevelGlobalThisBinding = false;

  constructor(root: EsNode) {
    this.collectNames(root);
    this.topLevelGlobalThisBinding = programBindsName(root, "globalThis");
  }

  private collectNames(value: unknown): void {
    if (Array.isArray(value)) {
      for (const child of value) this.collectNames(child);
      return;
    }
    if (!isNode(value)) return;
    if (value.type === "Identifier" || value.type === "JSXIdentifier") {
      this.names.add(value.name as string);
    }
    for (const key of Object.keys(value)) {
      if (!SKIP_KEYS.has(key)) this.collectNames(value[key]);
    }
  }

  name(prefix: string): string {
    let index = this.next.get(prefix) ?? 0;
    let name: string;
    do name = `${prefix}${index++}`;
    while (this.names.has(name));
    this.next.set(prefix, index);
    this.names.add(name);
    return name;
  }

  temp(): string {
    const name = this.name("__lazyValue");
    this.tempScopes[this.tempScopes.length - 1].push(name);
    return name;
  }

  pushFunctionTemps(): void {
    this.tempScopes.push([]);
  }

  popFunctionTemps(): string[] {
    if (this.tempScopes.length === 1) {
      return fail("Internal TSRX lazy-transform temporary-scope imbalance");
    }
    return this.tempScopes.pop()!;
  }

  defaultRead(
    raw: EsNode,
    fallback: EsNode,
    bindings: Bindings,
    selfName: string,
    source: EsNode
  ): EsNode {
    const tempName = this.temp();
    const temp = () => ident(tempName, source);
    const fallbackBindings = new Map(bindings);
    fallbackBindings.delete(selfName);
    return sequence(
      [
        assignment("=", temp(), raw, source),
        conditional(
          binary("===", temp(), undefinedExpression(source), source),
          transform(cloneNode(fallback), fallbackBindings, this),
          temp(),
          source
        )
      ],
      source
    );
  }

  omitIdentifier(): EsNode {
    this.omitName ??= this.name("__lazyOmit");
    return ident(this.omitName);
  }

  arrayIdentifier(node: EsNode): EsNode {
    if (this.topLevelGlobalThisBinding) {
      fail(
        "TSRX lazy array rest cannot safely access the intrinsic Array because this module binds `globalThis`; rename that top-level binding",
        node
      );
    }
    this.usesArrayRest = true;
    this.arrayName ??= this.name("__lazyArray");
    return ident(this.arrayName, node);
  }

  finalize(program: EsNode): EsNode {
    if (program.type !== "Program") {
      if (this.omitName || this.usesArrayRest || this.programTemps.length) {
        return fail("The TSRX lazy transform requires a Program root", program);
      }
      return program;
    }

    const generated: EsNode[] = [];
    if (this.arrayName) {
      generated.push(
        variableDeclaration(
          "const",
          [this.arrayName],
          member(ident("globalThis"), ident("Array"), false)
        )
      );
    }
    if (this.programTemps.length) generated.push(variableDeclaration("let", this.programTemps));

    const body = program.body as EsNode[];
    let directiveEnd = 0;
    while (
      directiveEnd < body.length &&
      body[directiveEnd].type === "ExpressionStatement" &&
      typeof body[directiveEnd].directive === "string"
    ) {
      directiveEnd++;
    }
    let importEnd = directiveEnd;
    while (importEnd < body.length && body[importEnd].type === "ImportDeclaration") importEnd++;

    const additions: EsNode[] = [];
    if (this.omitName) {
      additions.push({
        type: "ImportDeclaration",
        specifiers: [
          {
            type: "ImportSpecifier",
            imported: ident("omit"),
            local: ident(this.omitName)
          }
        ],
        source: literal("solid-js")
      });
    }
    additions.push(...generated);
    if (additions.length) {
      program.body = [...body.slice(0, importEnd), ...additions, ...body.slice(importEnd)];
    }
    return program;
  }
}

function programBindsName(root: EsNode, name: string): boolean {
  if (root.type !== "Program") return false;
  for (const statement of root.body as EsNode[]) {
    const declaration =
      (statement.type === "ExportNamedDeclaration" ||
        statement.type === "ExportDefaultDeclaration") &&
      isNode(statement.declaration)
        ? statement.declaration
        : statement;
    if (declaration.type === "VariableDeclaration") {
      for (const item of declaration.declarations as EsNode[]) {
        const names = new Set<string>();
        patternNames(item.id as EsNode, names);
        if (names.has(name)) return true;
      }
    } else if (
      (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") &&
      isNode(declaration.id) &&
      declaration.id.name === name
    ) {
      return true;
    } else if (statement.type === "ImportDeclaration") {
      for (const specifier of statement.specifiers as EsNode[]) {
        if (isNode(specifier.local) && specifier.local.name === name) return true;
      }
    }
  }
  return false;
}

function assertWritable(binding: LazyBinding, node: EsNode): void {
  if (binding.complexDefault) {
    fail(
      "A TSRX lazy binding nested beneath an ancestor default is read-only; assign to the source object explicitly",
      node
    );
  }
}

function staticPropertyName(node: EsNode): string | null {
  if (node.type === "Identifier") return node.name as string;
  if (node.type === "Literal") return String(node.value);
  return null;
}

function typePropertyKeys(typeAnnotation: EsNode | undefined): Map<string, EsNode> {
  const keys = new Map<string, EsNode>();
  const type = typeAnnotation?.typeAnnotation as EsNode | undefined;
  if (type?.type !== "TSTypeLiteral") return keys;
  for (const item of (type.members as EsNode[]) ?? []) {
    if (item.type !== "TSPropertySignature" || !isNode(item.key)) continue;
    const name = staticPropertyName(item.key);
    if (name !== null && !keys.has(name)) keys.set(name, item.key);
  }
  return keys;
}

function patternRange(pattern: EsNode): EsNode | null {
  if (pattern.start === undefined || pattern.end === undefined || pattern.loc === undefined) {
    return null;
  }
  const annotation = pattern.typeAnnotation as EsNode | undefined;
  return {
    type: "Identifier",
    start: pattern.start,
    end: annotation?.start ?? pattern.end,
    loc: {
      start: (pattern.loc as { start: unknown }).start,
      end:
        (annotation?.loc as { start?: unknown } | undefined)?.start ??
        (pattern.loc as { end: unknown }).end
    }
  };
}

function generatedPatternIdentifier(pattern: EsNode, name: string, isTop: boolean): EsNode {
  const range = patternRange(pattern);
  const id = ident(name, range);
  if (range && range.start !== undefined && range.end !== undefined) {
    metadata(id).source_length = range.end - range.start;
  }
  if (isTop && isNode(pattern.typeAnnotation)) id.typeAnnotation = pattern.typeAnnotation;
  if (isTop) setParamTypeMappings(id, pattern);
  return id;
}

function setParamTypeMappings(id: EsNode, pattern: EsNode): void {
  if (pattern.type !== "ObjectPattern") return;
  const keys = typePropertyKeys(id.typeAnnotation as EsNode | undefined);
  if (!keys.size) return;
  const mappings: { source: EsNode; generated: EsNode }[] = [];
  for (const property of pattern.properties as EsNode[]) {
    if (property.type === "RestElement" || property.computed) continue;
    const value = property.value as EsNode;
    const actual = value.type === "AssignmentPattern" ? (value.left as EsNode) : value;
    if (actual.type !== "Identifier" || actual.start === undefined) continue;
    const name = staticPropertyName(property.key as EsNode);
    const generated = name === null ? undefined : keys.get(name);
    if (generated?.start !== undefined) {
      metadata(generated).disable_verification = true;
      mappings.push({ source: actual, generated });
    }
  }
  if (mappings.length) metadata(id).lazy_param_binding_mappings = mappings;
}

function visitTopmostLazyPatterns(
  pattern: EsNode | null | undefined,
  visit: (pattern: EsNode) => void
): void {
  if (!pattern) return;
  if (pattern.type === "AssignmentPattern") {
    visitTopmostLazyPatterns(pattern.left as EsNode, visit);
    return;
  }
  if (pattern.type === "RestElement") {
    visitTopmostLazyPatterns(pattern.argument as EsNode, visit);
    return;
  }
  if (pattern.type !== "ObjectPattern" && pattern.type !== "ArrayPattern") return;
  if (pattern.lazy) {
    visit(pattern);
    return;
  }
  if (pattern.type === "ObjectPattern") {
    for (const property of pattern.properties as EsNode[]) {
      visitTopmostLazyPatterns(
        (property.type === "RestElement" ? property.argument : property.value) as EsNode,
        visit
      );
    }
  } else {
    for (const element of pattern.elements as (EsNode | null)[]) {
      if (element) visitTopmostLazyPatterns(element, visit);
    }
  }
}

function preallocate(root: EsNode, state: LazyState): void {
  const assign = (pattern: EsNode | null | undefined) => {
    visitTopmostLazyPatterns(pattern, lazy => {
      if (!metadata(lazy).lazy_id) metadata(lazy).lazy_id = state.name("__lazy");
    });
  };

  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) {
      let found = false;
      for (const child of value) if (visit(child)) found = true;
      return found;
    }
    if (!isNode(value)) return false;

    const functionLike = FUNCTION_TYPES.has(value.type);
    if (functionLike) {
      for (const param of value.params as EsNode[]) {
        assign(param.type === "AssignmentPattern" ? (param.left as EsNode) : param);
      }
    }
    if (value.type === "VariableDeclarator") assign(value.id as EsNode);
    if (value.type === "CatchClause" && isNode(value.param)) assign(value.param);
    if (
      value.type === "ExpressionStatement" &&
      isNode(value.expression) &&
      value.expression.type === "AssignmentExpression" &&
      value.expression.operator === "="
    ) {
      assign(value.expression.left as EsNode);
    }

    let found =
      (value.type === "ObjectPattern" || value.type === "ArrayPattern") && value.lazy === true;
    for (const key of Object.keys(value)) {
      if (SKIP_KEYS.has(key)) continue;
      if (visit(value[key])) found = true;
    }
    if (functionLike && found) metadata(value).has_lazy_descendants = true;
    return found;
  };
  visit(root);
}

function transformedEmbedded(
  node: EsNode,
  bindings: Bindings,
  state: LazyState,
  selfName: string
): EsNode {
  const effective = new Map(bindings);
  effective.delete(selfName);
  return transform(cloneNode(node), effective, state);
}

function rootAccess(sourceName: string, accessor: boolean): Access {
  const source = (reference: EsNode) => {
    const identifier = ident(sourceName, reference);
    return accessor ? call(identifier, [], reference) : identifier;
  };
  return {
    raw: reference => source(reference),
    value: reference => source(reference),
    plain: true,
    jsxCompatible: !accessor,
    complexDefault: false
  };
}

function propertyAccess(parent: Access, key: EsNode, computed: boolean, state: LazyState): Access {
  const property = (bindings: Bindings, selfName: string, reference: EsNode) =>
    computed
      ? transformedEmbedded(key, bindings, state, selfName)
      : ident(key.name as string, reference);
  return {
    raw: (reference, bindings, selfName) =>
      member(
        parent.raw(reference, bindings, selfName),
        property(bindings, selfName, reference),
        computed,
        reference
      ),
    value: (reference, bindings, selfName) =>
      member(
        parent.value(reference, bindings, selfName),
        property(bindings, selfName, reference),
        computed,
        reference
      ),
    plain: parent.plain,
    jsxCompatible: parent.jsxCompatible && !computed,
    complexDefault: parent.complexDefault || parent.directDefault !== undefined
  };
}

function defaultAccess(parent: Access, fallback: EsNode, state: LazyState): Access {
  return {
    raw: parent.raw,
    value: (reference, bindings, selfName) =>
      state.defaultRead(
        parent.value(reference, bindings, selfName),
        fallback,
        bindings,
        selfName,
        reference
      ),
    plain: false,
    jsxCompatible: false,
    directDefault: fallback,
    complexDefault: parent.complexDefault || parent.directDefault !== undefined
  };
}

function jsxNameFromMember(expression: EsNode, source: EsNode): EsNode | null {
  if (expression.type === "Identifier") {
    return withLoc({ type: "JSXIdentifier", name: expression.name }, source);
  }
  if (
    expression.type === "MemberExpression" &&
    !expression.computed &&
    isNode(expression.property) &&
    expression.property.type === "Identifier"
  ) {
    const object = jsxNameFromMember(expression.object as EsNode, source);
    if (object) {
      return withLoc(
        {
          type: "JSXMemberExpression",
          object,
          property: withLoc(
            { type: "JSXIdentifier", name: expression.property.name },
            expression.property
          )
        },
        source
      );
    }
  }
  return null;
}

function registerBinding(
  name: string,
  sourceName: string,
  access: Access,
  bindings: Bindings
): void {
  bindings.set(name, {
    sourceName,
    read(reference, current) {
      return access.value(reference, current, name);
    },
    target(reference, current) {
      return access.raw(reference, current, name);
    },
    jsxName(reference, current) {
      return access.jsxCompatible
        ? jsxNameFromMember(access.raw(reference, current, name), reference)
        : null;
    },
    directDefault: access.directDefault,
    complexDefault: access.complexDefault
  });
}

function collectBindingsAt(
  pattern: EsNode,
  sourceName: string,
  access: Access,
  bindings: Bindings,
  state: LazyState
): void {
  if (pattern.type === "AssignmentPattern") {
    collectBindingsAt(
      pattern.left as EsNode,
      sourceName,
      defaultAccess(access, pattern.right as EsNode, state),
      bindings,
      state
    );
    return;
  }
  if (pattern.type === "Identifier") {
    registerBinding(pattern.name as string, sourceName, access, bindings);
    return;
  }
  if (pattern.type === "ObjectPattern") {
    const properties = pattern.properties as EsNode[];
    const sourceKeys = properties
      .filter(property => property.type !== "RestElement")
      .map(property => {
        const key = property.key as EsNode;
        return property.computed ? key : literal(staticPropertyName(key) ?? "", key);
      });
    for (const property of properties) {
      if (property.type === "RestElement") {
        const argument = property.argument as EsNode;
        if (argument.type !== "Identifier") {
          fail("TSRX lazy object rest currently requires an identifier binding", argument);
        }
        const name = argument.name as string;
        bindings.set(name, {
          sourceName,
          read(reference, current) {
            const effective = new Map(current);
            effective.delete(name);
            return call(
              state.omitIdentifier(),
              [
                access.value(reference, current, name),
                ...sourceKeys.map(key => transform(cloneNode(key), effective, state))
              ],
              reference
            );
          },
          target() {
            return null;
          },
          jsxName() {
            return null;
          },
          complexDefault: access.complexDefault
        });
        continue;
      }
      const key = property.key as EsNode;
      const computed = !!property.computed || key.type !== "Identifier";
      collectBindingsAt(
        property.value as EsNode,
        sourceName,
        propertyAccess(access, key, computed, state),
        bindings,
        state
      );
    }
    return;
  }
  if (pattern.type === "ArrayPattern") {
    const elements = pattern.elements as (EsNode | null)[];
    for (let index = 0; index < elements.length; index++) {
      const element = elements[index];
      if (!element) continue;
      if (element.type === "RestElement") {
        const argument = element.argument as EsNode;
        if (argument.type !== "Identifier") {
          fail("TSRX lazy array rest currently requires an identifier binding", argument);
        }
        const name = argument.name as string;
        // Reserve and validate the intrinsic alias when the pattern is
        // registered, even if the rest binding is never read. The native
        // frontend plans helpers at binding time and must emit the same
        // `globalThis` shadowing diagnostic.
        state.arrayIdentifier(argument);
        bindings.set(name, {
          sourceName,
          read(reference, current) {
            const from = member(
              state.arrayIdentifier(reference),
              ident("from", reference),
              false,
              reference
            );
            const array = call(from, [access.value(reference, current, name)], reference);
            return call(
              member(array, ident("slice", reference), false, reference),
              [literal(index, reference)],
              reference
            );
          },
          target() {
            return null;
          },
          jsxName() {
            return null;
          },
          complexDefault: access.complexDefault
        });
        continue;
      }
      collectBindingsAt(
        element,
        sourceName,
        propertyAccess(access, literal(index, element), true, state),
        bindings,
        state
      );
    }
  }
}

function collectBindings(
  pattern: EsNode,
  sourceName: string,
  bindings: Bindings,
  state: LazyState
): void {
  collectBindingsAt(
    pattern,
    sourceName,
    rootAccess(sourceName, metadata(pattern).lazy_source_accessor === true),
    bindings,
    state
  );
}

function collectBindingsFromStatements(
  statements: EsNode[],
  bindings: Bindings,
  state: LazyState
): void {
  for (const statement of statements) {
    const declaration =
      (statement.type === "ExportNamedDeclaration" ||
        statement.type === "ExportDefaultDeclaration") &&
      isNode(statement.declaration)
        ? statement.declaration
        : statement;
    if (declaration.type === "VariableDeclaration" && declaration.kind !== "var") {
      for (const item of declaration.declarations as EsNode[]) {
        visitTopmostLazyPatterns(item.id as EsNode, lazy => {
          const sourceName = metadata(lazy).lazy_id;
          if (sourceName) collectBindings(lazy, sourceName, bindings, state);
        });
      }
    } else if (
      statement.type === "ExpressionStatement" &&
      isNode(statement.expression) &&
      statement.expression.type === "AssignmentExpression" &&
      statement.expression.operator === "="
    ) {
      visitTopmostLazyPatterns(statement.expression.left as EsNode, lazy => {
        const sourceName = metadata(lazy).lazy_id;
        if (sourceName) collectBindings(lazy, sourceName, bindings, state);
      });
    }
  }
}

interface VarScopeBindings {
  declared: Set<string>;
  lazy: Bindings;
}

/**
 * Collect function/program-scoped `var` declarations before rewriting any
 * references in that scope. `var` crosses blocks, loops, switches, and catch
 * bodies, but never crosses a nested function, class, or class static block.
 */
function collectVarScopeBindings(statements: EsNode[], state: LazyState): VarScopeBindings {
  const declared = new Set<string>();
  const lazy = new Map<string, LazyBinding>();

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (!isNode(value)) return;
    if (
      FUNCTION_TYPES.has(value.type) ||
      value.type === "ClassDeclaration" ||
      value.type === "ClassExpression" ||
      value.type === "StaticBlock" ||
      value.type === "ClassStaticBlock"
    ) {
      return;
    }
    if (value.type === "VariableDeclaration" && value.kind === "var") {
      for (const declaration of value.declarations as EsNode[]) {
        patternNames(declaration.id as EsNode, declared);
        visitTopmostLazyPatterns(declaration.id as EsNode, pattern => {
          const sourceName = metadata(pattern).lazy_id;
          if (sourceName) collectBindings(pattern, sourceName, lazy, state);
        });
      }
    }
    for (const key of Object.keys(value)) {
      if (!SKIP_KEYS.has(key)) visit(value[key]);
    }
  };

  visit(statements);
  return { declared, lazy };
}

function replaceLazyInPattern(pattern: EsNode, isTop = true): EsNode {
  if (pattern.type === "AssignmentPattern") {
    const left = replaceLazyInPattern(pattern.left as EsNode, isTop);
    return left === pattern.left ? pattern : { ...pattern, left };
  }
  if (pattern.type === "RestElement") {
    const argument = replaceLazyInPattern(pattern.argument as EsNode, false);
    return argument === pattern.argument ? pattern : { ...pattern, argument };
  }
  if (pattern.type !== "ObjectPattern" && pattern.type !== "ArrayPattern") return pattern;
  const sourceName = metadata(pattern).lazy_id;
  if (pattern.lazy && sourceName) return generatedPatternIdentifier(pattern, sourceName, isTop);
  if (pattern.type === "ObjectPattern") {
    let changed = false;
    const properties = (pattern.properties as EsNode[]).map(property => {
      const key = property.type === "RestElement" ? "argument" : "value";
      const value = property[key] as EsNode;
      const replacement = replaceLazyInPattern(value, false);
      if (replacement === value) return property;
      changed = true;
      return { ...property, [key]: replacement };
    });
    return changed ? { ...pattern, properties } : pattern;
  }
  let changed = false;
  const elements = (pattern.elements as (EsNode | null)[]).map(element => {
    if (!element) return element;
    const replacement = replaceLazyInPattern(element, false);
    if (replacement !== element) changed = true;
    return replacement;
  });
  return changed ? { ...pattern, elements } : pattern;
}

function replaceLazyParams(params: EsNode[]): EsNode[] {
  return params.map(param => replaceLazyInPattern(param));
}

function patternNames(pattern: EsNode, names: Set<string>): void {
  switch (pattern.type) {
    case "Identifier":
      names.add(pattern.name as string);
      return;
    case "AssignmentPattern":
      patternNames(pattern.left as EsNode, names);
      return;
    case "RestElement":
      patternNames(pattern.argument as EsNode, names);
      return;
    case "ObjectPattern":
      for (const property of pattern.properties as EsNode[]) {
        patternNames(
          (property.type === "RestElement" ? property.argument : property.value) as EsNode,
          names
        );
      }
      return;
    case "ArrayPattern":
      for (const element of pattern.elements as (EsNode | null)[]) {
        if (element) patternNames(element, names);
      }
  }
}

function collectShadowed(pattern: EsNode, bindings: Bindings, names: Set<string>): void {
  const all = new Set<string>();
  patternNames(pattern, all);
  for (const name of all) if (bindings.has(name)) names.add(name);
}

function collectBlockShadowed(statements: EsNode[], bindings: Bindings): Set<string> {
  const names = new Set<string>();
  for (const statement of statements) {
    const declaration =
      (statement.type === "ExportNamedDeclaration" ||
        statement.type === "ExportDefaultDeclaration") &&
      isNode(statement.declaration)
        ? statement.declaration
        : statement;
    if (declaration.type === "VariableDeclaration" && declaration.kind !== "var") {
      for (const item of declaration.declarations as EsNode[]) {
        collectShadowed(item.id as EsNode, bindings, names);
      }
    } else if (
      (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") &&
      isNode(declaration.id) &&
      bindings.has(declaration.id.name as string)
    ) {
      names.add(declaration.id.name as string);
    } else if (statement.type === "ImportDeclaration") {
      for (const specifier of statement.specifiers as EsNode[]) {
        if (isNode(specifier.local) && bindings.has(specifier.local.name as string)) {
          names.add(specifier.local.name as string);
        }
      }
    }
  }
  return names;
}

function without(bindings: Bindings, names: Set<string>): Bindings {
  const result = new Map(bindings);
  for (const name of names) result.delete(name);
  return result;
}

function transformValue(value: unknown, bindings: Bindings, state: LazyState): unknown {
  if (Array.isArray(value)) return value.map(item => transformValue(item, bindings, state));
  return isNode(value) ? transform(value, bindings, state) : value;
}

function targetParts(target: EsNode, source: EsNode): { object: EsNode; key: EsNode } {
  if (target.type !== "MemberExpression") {
    return fail("A writable TSRX lazy binding did not resolve to a member expression", source);
  }
  const property = target.property as EsNode;
  return {
    object: target.object as EsNode,
    key: target.computed ? property : literal(property.name as string, property)
  };
}

function lowerDefaultedAssignment(
  node: EsNode,
  binding: LazyBinding,
  bindings: Bindings,
  state: LazyState
): EsNode {
  if (!binding.directDefault) return fail("Missing default for TSRX lazy assignment", node);
  const left = node.left as EsNode;
  const target = binding.target(left, bindings);
  if (!target) return fail("A TSRX lazy rest binding is read-only", left);
  const { object, key } = targetParts(target, left);
  const objectName = state.temp();
  const keyName = state.temp();
  const valueName = state.temp();
  const objectId = () => ident(objectName, left);
  const keyId = () => ident(keyName, left);
  const valueId = () => ident(valueName, left);
  const destination = () => member(objectId(), keyId(), true, left);
  const effective = new Map(bindings);
  effective.delete(left.name as string);
  const fallback = transform(cloneNode(binding.directDefault), effective, state);
  const right = transform(node.right as EsNode, bindings, state);
  const operator = node.operator as string;
  const expressions = [
    assignment("=", objectId(), object, left),
    assignment("=", keyId(), key, left),
    assignment("=", valueId(), destination(), left),
    assignment(
      "=",
      valueId(),
      conditional(
        binary("===", valueId(), undefinedExpression(left), left),
        fallback,
        valueId(),
        left
      ),
      left
    )
  ];

  if (operator === "&&=" || operator === "||=" || operator === "??=") {
    expressions.push(
      logical(operator.slice(0, -1), valueId(), assignment("=", destination(), right, node), node)
    );
  } else {
    expressions.push(
      assignment("=", destination(), binary(operator.slice(0, -1), valueId(), right, node), node)
    );
  }
  return sequence(expressions, node);
}

function lowerDefaultedUpdate(
  node: EsNode,
  binding: LazyBinding,
  bindings: Bindings,
  state: LazyState
): EsNode {
  if (!binding.directDefault) return fail("Missing default for TSRX lazy update", node);
  const argument = node.argument as EsNode;
  const target = binding.target(argument, bindings);
  if (!target) return fail("A TSRX lazy rest binding is read-only", argument);
  const { object, key } = targetParts(target, argument);
  const objectName = state.temp();
  const keyName = state.temp();
  const valueName = state.temp();
  const objectId = () => ident(objectName, argument);
  const keyId = () => ident(keyName, argument);
  const valueId = () => ident(valueName, argument);
  const destination = () => member(objectId(), keyId(), true, argument);
  const effective = new Map(bindings);
  effective.delete(argument.name as string);
  const fallback = transform(cloneNode(binding.directDefault), effective, state);
  const expressions: EsNode[] = [
    assignment("=", objectId(), object, argument),
    assignment("=", keyId(), key, argument),
    assignment("=", valueId(), destination(), argument),
    assignment(
      "=",
      valueId(),
      conditional(
        binary("===", valueId(), undefinedExpression(argument), argument),
        fallback,
        valueId(),
        argument
      ),
      argument
    )
  ];

  if (node.prefix) {
    expressions.push(
      assignment(
        "=",
        destination(),
        withLoc(
          {
            type: "UpdateExpression",
            operator: node.operator,
            prefix: true,
            argument: valueId()
          },
          node
        ),
        node
      )
    );
  } else {
    const oldName = state.temp();
    const oldId = () => ident(oldName, argument);
    expressions.push(
      assignment(
        "=",
        oldId(),
        withLoc(
          {
            type: "UpdateExpression",
            operator: node.operator,
            prefix: false,
            argument: valueId()
          },
          node
        ),
        node
      ),
      assignment("=", destination(), valueId(), node),
      oldId()
    );
  }
  return sequence(expressions, node);
}

function dynamicJsxElement(node: EsNode, bindings: Bindings, state: LazyState): EsNode | null {
  const opening = node.openingElement as EsNode;
  const name = opening.name as EsNode;
  let base: EsNode = name;
  const properties: EsNode[] = [];
  while (base.type === "JSXMemberExpression") {
    properties.unshift(base.property as EsNode);
    base = base.object as EsNode;
  }
  if (base.type !== "JSXIdentifier" || !/^[A-Z]/.test(base.name as string)) return null;
  const binding = bindings.get(base.name as string);
  if (!binding || binding.jsxName(base, bindings)) return null;

  let expression = binding.read(base, bindings);
  for (const property of properties) {
    expression = member(expression, ident(property.name as string, property), false, property);
  }
  const dynamicName = withLoc({ type: "JSXIdentifier", name: "Dynamic" }, name);
  const componentAttribute: EsNode = {
    type: "JSXAttribute",
    name: withLoc({ type: "JSXIdentifier", name: "component" }, name),
    value: withLoc({ type: "JSXExpressionContainer", expression }, name)
  };
  const nextOpening = {
    ...opening,
    name: dynamicName,
    attributes: [
      componentAttribute,
      ...((opening.attributes as EsNode[]) ?? []).map(attribute =>
        transform(attribute, bindings, state)
      )
    ]
  };
  const closing = node.closingElement as EsNode | null;
  return {
    ...node,
    openingElement: nextOpening,
    closingElement: closing ? { ...closing, name: cloneNode(dynamicName) } : null,
    children: ((node.children as EsNode[]) ?? []).map(child => transform(child, bindings, state))
  };
}

function addFunctionTemps(body: EsNode, names: string[]): EsNode {
  if (!names.length) return body;
  const declaration = variableDeclaration("let", names);
  if (body.type !== "BlockStatement") {
    return {
      type: "BlockStatement",
      body: [declaration, withLoc({ type: "ReturnStatement", argument: body }, body)]
    };
  }
  const statements = body.body as EsNode[];
  let directiveEnd = 0;
  while (
    directiveEnd < statements.length &&
    statements[directiveEnd].type === "ExpressionStatement" &&
    typeof statements[directiveEnd].directive === "string"
  ) {
    directiveEnd++;
  }
  return {
    ...body,
    body: [...statements.slice(0, directiveEnd), declaration, ...statements.slice(directiveEnd)]
  };
}

function transform(node: EsNode, bindings: Bindings, state: LazyState): EsNode {
  if (FUNCTION_TYPES.has(node.type)) {
    const shadowed = new Set<string>();
    if (isNode(node.id)) collectShadowed(node.id, bindings, shadowed);
    for (const param of node.params as EsNode[]) collectShadowed(param, bindings, shadowed);
    const outer = shadowed.size ? without(bindings, shadowed) : bindings;
    const own = new Map<string, LazyBinding>();
    let lazyParam = false;
    for (const param of node.params as EsNode[]) {
      visitTopmostLazyPatterns(param, lazy => {
        const sourceName = metadata(lazy).lazy_id;
        if (!sourceName) return;
        lazyParam = true;
        collectBindings(lazy, sourceName, own, state);
      });
    }
    const inner = own.size ? new Map([...outer, ...own]) : outer;
    let paramsChanged = false;
    const params = (node.params as EsNode[]).map(param => {
      if (param.type !== "AssignmentPattern") return param;
      const right = transform(param.right as EsNode, inner, state);
      if (right === param.right) return param;
      paramsChanged = true;
      return { ...param, right };
    });
    if (!inner.size && !paramsChanged && !lazyParam && !metadata(node).has_lazy_descendants) {
      return node;
    }
    state.pushFunctionTemps();
    const functionBody = node.body as EsNode;
    let bodyBindings = inner;
    if (functionBody.type === "BlockStatement") {
      const varScope = collectVarScopeBindings(functionBody.body as EsNode[], state);
      const unshadowed = varScope.declared.size
        ? without(bodyBindings, varScope.declared)
        : bodyBindings;
      bodyBindings = new Map([...unshadowed, ...own, ...varScope.lazy]);
    }
    const transformedBody = transform(functionBody, bodyBindings, state);
    const bodyTemps = state.popFunctionTemps();
    const body = addFunctionTemps(transformedBody, bodyTemps);
    const finalParams = lazyParam ? replaceLazyParams(params) : params;
    return body !== node.body || finalParams !== node.params
      ? {
          ...node,
          params: finalParams,
          body,
          ...(node.type === "ArrowFunctionExpression" && body.type === "BlockStatement"
            ? { expression: false }
            : {})
        }
      : node;
  }

  if (node.type === "Program") {
    const body = node.body as EsNode[];
    const varScope = collectVarScopeBindings(body, state);
    const varOuter = varScope.declared.size ? without(bindings, varScope.declared) : bindings;
    const withVar = varScope.lazy.size ? new Map([...varOuter, ...varScope.lazy]) : varOuter;
    const shadowed = collectBlockShadowed(body, withVar);
    const outer = shadowed.size ? without(withVar, shadowed) : withVar;
    const own = new Map<string, LazyBinding>();
    collectBindingsFromStatements(body, own, state);
    const inner = own.size ? new Map([...outer, ...own]) : outer;
    let changed = false;
    const next = body.map(statement => {
      const result = transform(statement, inner, state);
      if (result !== statement) changed = true;
      return result;
    });
    return changed ? { ...node, body: next } : node;
  }

  if (node.type === "BlockStatement") {
    const body = node.body as EsNode[];
    const shadowed = collectBlockShadowed(body, bindings);
    const outer = shadowed.size ? without(bindings, shadowed) : bindings;
    const own = new Map<string, LazyBinding>();
    collectBindingsFromStatements(body, own, state);
    const inner = own.size ? new Map([...outer, ...own]) : outer;
    let changed = false;
    const next = body.map(statement => {
      const result = transform(statement, inner, state);
      if (result !== statement) changed = true;
      return result;
    });
    return changed ? { ...node, body: next } : node;
  }

  if (node.type === "StaticBlock" || node.type === "ClassStaticBlock") {
    const body = node.body as EsNode[];
    const varScope = collectVarScopeBindings(body, state);
    const varOuter = varScope.declared.size ? without(bindings, varScope.declared) : bindings;
    const withVar = varScope.lazy.size ? new Map([...varOuter, ...varScope.lazy]) : varOuter;
    const shadowed = collectBlockShadowed(body, withVar);
    const outer = shadowed.size ? without(withVar, shadowed) : withVar;
    const own = new Map<string, LazyBinding>();
    collectBindingsFromStatements(body, own, state);
    const inner = own.size ? new Map([...outer, ...own]) : outer;
    let changed = false;
    const next = body.map(statement => {
      const result = transform(statement, inner, state);
      if (result !== statement) changed = true;
      return result;
    });
    return changed ? { ...node, body: next } : node;
  }

  if (node.type === "CatchClause") {
    const own = new Map<string, LazyBinding>();
    if (isNode(node.param)) {
      visitTopmostLazyPatterns(node.param, lazy => {
        const sourceName = metadata(lazy).lazy_id;
        if (sourceName) collectBindings(lazy, sourceName, own, state);
      });
    }
    const shadowed = new Set<string>();
    if (isNode(node.param)) collectShadowed(node.param, bindings, shadowed);
    const outer = shadowed.size ? without(bindings, shadowed) : bindings;
    const inner = own.size ? new Map([...outer, ...own]) : outer;
    const param = isNode(node.param) ? replaceLazyInPattern(node.param, true) : node.param;
    const body = transform(node.body as EsNode, inner, state);
    return param === node.param && body === node.body ? node : { ...node, param, body };
  }

  if (node.type === "ForStatement") {
    const shadowed = new Set<string>();
    const own = new Map<string, LazyBinding>();
    const init = node.init as EsNode | null;
    if (init?.type === "VariableDeclaration") {
      for (const declaration of init.declarations as EsNode[]) {
        if (init.kind !== "var") {
          visitTopmostLazyPatterns(declaration.id as EsNode, lazy => {
            const sourceName = metadata(lazy).lazy_id;
            if (sourceName) collectBindings(lazy, sourceName, own, state);
          });
          collectShadowed(declaration.id as EsNode, bindings, shadowed);
        }
      }
    }
    const outer = shadowed.size ? without(bindings, shadowed) : bindings;
    const inner = own.size ? new Map([...outer, ...own]) : outer;
    return {
      ...node,
      init: init ? transform(init, inner, state) : init,
      test: isNode(node.test) ? transform(node.test, inner, state) : node.test,
      update: isNode(node.update) ? transform(node.update, inner, state) : node.update,
      body: transform(node.body as EsNode, inner, state)
    };
  }

  if (node.type === "ForOfStatement" || node.type === "ForInStatement") {
    const shadowed = new Set<string>();
    const own = new Map<string, LazyBinding>();
    const left = node.left as EsNode;
    if (left.type === "VariableDeclaration") {
      for (const declaration of left.declarations as EsNode[]) {
        if (left.kind !== "var") {
          visitTopmostLazyPatterns(declaration.id as EsNode, lazy => {
            const sourceName = metadata(lazy).lazy_id;
            if (sourceName) collectBindings(lazy, sourceName, own, state);
          });
          collectShadowed(declaration.id as EsNode, bindings, shadowed);
        }
      }
    }
    const outer = shadowed.size ? without(bindings, shadowed) : bindings;
    const inner = own.size ? new Map([...outer, ...own]) : outer;
    return {
      ...node,
      left: transform(left, inner, state),
      right: transform(node.right as EsNode, inner, state),
      body: transform(node.body as EsNode, inner, state)
    };
  }

  if (node.type === "SwitchStatement") {
    const cases = node.cases as EsNode[];
    const statements = cases.flatMap(item => item.consequent as EsNode[]);
    const shadowed = collectBlockShadowed(statements, bindings);
    const outer = shadowed.size ? without(bindings, shadowed) : bindings;
    const own = new Map<string, LazyBinding>();
    collectBindingsFromStatements(statements, own, state);
    const inner = own.size ? new Map([...outer, ...own]) : outer;
    return {
      ...node,
      discriminant: transform(node.discriminant as EsNode, outer, state),
      cases: cases.map(item => ({
        ...item,
        test: isNode(item.test) ? transform(item.test, inner, state) : item.test,
        consequent: (item.consequent as EsNode[]).map(statement =>
          transform(statement, inner, state)
        )
      }))
    };
  }

  if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
    const shadowed = new Set<string>();
    if (isNode(node.id)) collectShadowed(node.id, bindings, shadowed);
    const inner = shadowed.size ? without(bindings, shadowed) : bindings;
    return {
      ...node,
      superClass: isNode(node.superClass)
        ? transform(node.superClass, bindings, state)
        : node.superClass,
      body: transform(node.body as EsNode, inner, state)
    };
  }

  if (
    node.type === "ExportNamedDeclaration" &&
    isNode(node.declaration) &&
    node.declaration.type === "VariableDeclaration"
  ) {
    for (const declaration of node.declaration.declarations as EsNode[]) {
      visitTopmostLazyPatterns(declaration.id as EsNode, pattern => {
        fail(
          "TSRX lazy bindings cannot be exported; export the source object or an explicit accessor instead",
          pattern
        );
      });
    }
  }

  if (
    node.type === "ExportSpecifier" &&
    isNode(node.local) &&
    node.local.type === "Identifier" &&
    bindings.has(node.local.name as string)
  ) {
    return fail(
      "TSRX lazy bindings cannot be exported; export the source object or an explicit accessor instead",
      node.local
    );
  }

  if (node.type === "JSXElement") {
    const dynamic = dynamicJsxElement(node, bindings, state);
    if (dynamic) return dynamic;
  }

  if (
    node.type === "ExpressionStatement" &&
    isNode(node.expression) &&
    node.expression.type === "AssignmentExpression" &&
    node.expression.operator === "=" &&
    isNode(node.expression.left) &&
    (node.expression.left.type === "ObjectPattern" ||
      node.expression.left.type === "ArrayPattern") &&
    node.expression.left.lazy
  ) {
    const pattern = node.expression.left;
    const sourceName = metadata(pattern).lazy_id;
    if (sourceName) {
      const id = generatedPatternIdentifier(pattern, sourceName, true);
      return {
        type: "VariableDeclaration",
        kind: "const",
        declarations: [
          {
            type: "VariableDeclarator",
            id,
            init: transform(node.expression.right as EsNode, bindings, state)
          }
        ]
      };
    }
  }

  if (
    node.type === "ExpressionStatement" &&
    isNode(node.expression) &&
    node.expression.type === "AssignmentExpression" &&
    node.expression.operator === "=" &&
    isNode(node.expression.left) &&
    (node.expression.left.type === "ObjectPattern" ||
      node.expression.left.type === "ArrayPattern") &&
    !node.expression.left.lazy
  ) {
    const left = replaceLazyInPattern(node.expression.left);
    if (left !== node.expression.left) {
      return fail(
        "A lazy pattern nested inside a standalone destructuring assignment is not supported because its generated source binding cannot be scoped correctly; use a lazy variable declaration",
        node.expression.left
      );
    }
  }

  if (
    node.type === "AssignmentExpression" &&
    isNode(node.left) &&
    node.left.type === "Identifier"
  ) {
    const binding = bindings.get(node.left.name as string);
    if (binding) {
      assertWritable(binding, node.left);
      if (node.operator !== "=" && binding.directDefault) {
        return lowerDefaultedAssignment(node, binding, bindings, state);
      }
      const target = binding.target(node.left, bindings);
      if (!target) return fail("A TSRX lazy rest binding is read-only", node.left);
      return {
        ...node,
        left: target,
        right: transform(node.right as EsNode, bindings, state)
      };
    }
  }

  if (
    node.type === "UpdateExpression" &&
    isNode(node.argument) &&
    node.argument.type === "Identifier"
  ) {
    const binding = bindings.get(node.argument.name as string);
    if (binding) {
      assertWritable(binding, node.argument);
      if (binding.directDefault) {
        return lowerDefaultedUpdate(node, binding, bindings, state);
      }
      const target = binding.target(node.argument, bindings);
      if (!target) return fail("A TSRX lazy rest binding is read-only", node.argument);
      return { ...node, argument: target };
    }
  }

  if (node.type === "VariableDeclarator" && isNode(node.id) && metadata(node.id).lazy_id) {
    const sourceName = metadata(node.id).lazy_id!;
    return {
      ...node,
      id: generatedPatternIdentifier(node.id, sourceName, true),
      init: isNode(node.init) ? transform(node.init, bindings, state) : node.init
    };
  }

  if (
    node.type === "VariableDeclarator" &&
    isNode(node.id) &&
    (node.id.type === "ObjectPattern" || node.id.type === "ArrayPattern") &&
    !node.id.lazy
  ) {
    const id = replaceLazyInPattern(node.id);
    if (id !== node.id) {
      return {
        ...node,
        id,
        init: isNode(node.init) ? transform(node.init, bindings, state) : node.init
      };
    }
  }

  if (
    node.type === "Property" &&
    node.shorthand &&
    isNode(node.value) &&
    node.value.type === "Identifier"
  ) {
    const binding = bindings.get(node.value.name as string);
    if (binding) return { ...node, shorthand: false, value: binding.read(node.value, bindings) };
  }

  if (node.type === "Identifier") {
    const binding = bindings.get(node.name as string);
    return binding ? binding.read(node, bindings) : node;
  }

  if (node.type === "JSXIdentifier") return node;
  if (node.type === "MetaProperty") return node;

  let changed = false;
  const clone: Record<string, unknown> = { ...node };
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key) || TYPE_KEYS.has(key)) continue;
    if (
      key === "key" &&
      !node.computed &&
      (node.type === "Property" ||
        node.type === "MethodDefinition" ||
        node.type === "PropertyDefinition")
    ) {
      continue;
    }
    if (key === "property" && node.type === "MemberExpression" && !node.computed) continue;
    if (key === "property" && node.type === "JSXMemberExpression") continue;
    if (key === "name" && node.type === "JSXAttribute") continue;
    if (key === "id" && node.type === "VariableDeclarator") continue;
    if (
      (key === "local" || key === "imported" || key === "exported") &&
      /Specifier$/.test(node.type)
    ) {
      continue;
    }
    if (key === "label") continue;

    if (
      key === "name" &&
      (node.type === "JSXOpeningElement" || node.type === "JSXClosingElement") &&
      isNode(node.name)
    ) {
      const jsxName = rewriteJsxName(node.name, bindings);
      if (jsxName) {
        clone[key] = jsxName;
        changed = true;
        continue;
      }
    }
    const value = transformValue(node[key], bindings, state);
    if (value !== node[key]) {
      clone[key] = value;
      changed = true;
    }
  }
  return changed ? (clone as EsNode) : node;
}

function rewriteJsxName(name: EsNode, bindings: Bindings): EsNode | null {
  if (name.type === "JSXIdentifier") {
    if (!/^[A-Z]/.test(name.name as string)) return null;
    return bindings.get(name.name as string)?.jsxName(name, bindings) ?? null;
  }
  if (name.type === "JSXMemberExpression") {
    const object = rewriteJsxName(name.object as EsNode, bindings);
    return object ? { ...name, object } : null;
  }
  return null;
}

/** Apply Solid's local lazy transform to a fully desugared TSRX program. */
export function applyLazyTransforms(root: EsNode): EsNode {
  const state = new LazyState(root);
  preallocate(root, state);
  return state.finalize(transform(root, new Map(), state));
}
