<!-- Snapshot of https://tsrx.dev/specification (Draft / June 7, 2026 — first edition), retrieved 2026-08-25 for the Solid TSRX frontend effort. Normative source is the website; this copy pins the revision both compiler frontends implement. -->

TSRX TSRX | Specification

Draft / June 7, 2026

# TSRX

This page is the working language specification for TSRX. It is written for implementors of parsers, language tooling, compilers, and hosts that need a precise account of the syntax and static constraints of the language.

First-edition scope

The current draft fixes the syntax and early-error surface for JSX-shaped TSRX values, JSX statement containers, template control flow, lazy destructuring, raw style elements, and proposal-aligned submodule declarations.

## Introduction

TSRX is a TypeScript-compatible syntax extension to ECMAScript for authoring component-oriented user interface programs. It extends the TypeScript source language with JSX-shaped template values, JSX statement containers, template control-flow directives, lazy destructuring patterns, raw style elements, and style identifiers.

This specification defines the syntax of TSRX and the static constraints that a conforming implementation is expected to enforce. It does not propose incorporation of TSRX into the ECMAScript standard, and it does not require JavaScript engines or browsers to parse TSRX directly. Instead, it defines a source language intended for compilers, preprocessors, editors, formatters, and other tooling.

Unless this document explicitly states otherwise, a construct that is valid in the TypeScript baseline grammar remains valid in TSRX source text. The grammar additions in this document are therefore additive and TypeScript-compatible.

## Rationale

TSRX exists to define a predictable syntax for component-oriented source code while preserving the familiar JSX AST shape. Elements, fragments, text, expression containers, attributes, and spread attributes use the standard JSX node family; TSRX adds only the nodes needed for statement containers, style blocks, and template control flow.

- Returned TSRX templates are represented with JSXElement and JSXFragment nodes.
- Native TSRX values can be assigned, returned, or passed as props using ordinary JSX-shaped nodes.
- Lazy destructuring is represented as source syntax rather than a host-specific library convention.
- Host features such as server execution and stylesheet composition can be specified cleanly on top of a shared grammar.

## 1 Conformance

An implementation of core TSRX conforms to this specification if it accepts TypeScript source text together with the additional TSRX constructs defined here, rejects source texts that violate the listed early-error rules, and documents any host-defined or profile-defined semantics that are not fixed by the core language.

This specification distinguishes between core TSRX and host profiles. Core TSRX defines the syntax and static rules common to all conforming implementations. A host profile may add profile-specific constructs or strengthen restrictions on core constructs.

## 2 Notational Conventions

The syntactic and lexical grammar of ECMAScript are incorporated by reference as already extended by a TypeScript-compatible baseline grammar. When this document presents a modified production, it should be read as a delta against that baseline rather than as a complete restatement of the surrounding grammar.

## 3 Modified Lexical Conventions

TSRX introduces the whitespace-sensitive lazy-pattern introducers &{ and &[, and module declarations that can be imported by identifier source.

The ampersand introducer is part of the syntax of the lazy pattern itself. Implementations must not treat & { or & [ as lazy pattern forms.

## 4.1 Modified Productions

The following productions define the normative core additions for the first edition. They are additive over the TypeScript-compatible baseline grammar used by TSRX implementations.

```
PrimaryExpression :
  JSXElement
  JSXFragment
  JSXStyleElement
  JSXCodeBlock
  JSXIfExpression
  JSXForExpression
  JSXSwitchExpression
  JSXTryExpression

TemplateChild :
  JSXText
  JSXElement
  JSXFragment
  JSXStyleElement
  JSXExpressionContainer
  JSXCodeBlock
  JSXIfExpression
  JSXForExpression
  JSXSwitchExpression
  JSXTryExpression

TemplateChildren :
  TemplateChildList

TemplateChildList :
  TemplateChild
  TemplateChildList TemplateChild

TemplateOutput :
  JSXElement
  JSXFragment
  JSXIfExpression
  JSXForExpression
  JSXSwitchExpression
  JSXTryExpression

BindingAtom :
  LazyObjectBindingPattern
  LazyArrayBindingPattern

LazyObjectBindingPattern :
  &{ BindingPropertyListopt }

LazyArrayBindingPattern :
  &[ BindingElementListopt ]

JSXFragment :
  <> TemplateChildrenopt </>
```

## 4.2 Function Bodies and Returns

TSRX does not define a component declaration form. Components are ordinary functions. A function can return a TSRX expression from a normal return statement, or use the statement-container body shorthand when the whole body is TypeScript setup followed by one rendered output.

```
FunctionDeclaration :
  function BindingIdentifier ( FormalParametersopt ) { FunctionBody }
  function BindingIdentifier ( FormalParametersopt ) JSXCodeBlock

FunctionExpression :
  function BindingIdentifieropt ( FormalParametersopt ) { FunctionBody }
  function BindingIdentifieropt ( FormalParametersopt ) JSXCodeBlock

ReturnStatement :
  return JSXElement ;
  return JSXFragment ;
  return JSXCodeBlock ;
  return Expression ;
```

Class methods, object methods, arrow functions, and function expressions all remain ordinary TypeScript constructs. Hosts may choose which TSRX-producing functions are considered components.

## 4.3 Template Elements

Within a returned TSRX template, direct element, fragment, style, text, and expression-container children use the standard JSX node family. JavaScript line and block comments are permitted between template children and do not render. Template control flow uses directive-prefixed`@if`,`@for`,`@switch`, and`@try` blocks whose bodies render template children.

Every JSX control-flow body is an implicit statement container and must use a`{}` template block after the directive header.

Each`@switch``@case` and`@default` must use a`{}` template block. Cases are isolated: they do not fall through to later cases, and`break` and`return` are syntax errors inside a JSX switch case.

Plain JSX children are the default. When an expression position, function body, element child, or fragment child needs local TypeScript statements before rendering, those statements must be contained in a JSX statement container written as`@{...}`. A statement container places setup statements first and then exactly one output node: a JSX element, JSX fragment, or JSX control-flow expression. If the output needs text, expression containers, or multiple siblings after setup, wrap them in a JSX fragment.

Control-flow block bodies follow the same structural rule as statement containers: TypeScript first (although optional), then an optional rendered template output. The ordinary JSX form`{ AssignmentExpression }` contributes a JSXExpressionContainer node and is not itself a statement container. A function exit remains an ordinary`return` statement.

```
JSXTextChild :
  JSXTextCharacters

JSXExpressionContainer :
  { AssignmentExpression }

JSXCodeBlock :
  @{ StatementListItemListopt TemplateOutput }

TemplateBlock :
  { TemplateChildrenopt }
  { StatementListItemList TemplateOutput }

JSXIfExpression :
  @if ( Expression ) TemplateBlock
  @if ( Expression ) TemplateBlock @else TemplateBlock
  @if ( Expression ) TemplateBlock @else JSXIfExpression

JSXForExpression :
  @for ( ForHeader TemplateForOptionsopt ) TemplateBlock
  @for ( ForHeader TemplateForOptionsopt ) TemplateBlock @empty TemplateBlock

JSXSwitchExpression :
  @switch ( Expression ) { JSXSwitchCaseListopt }

JSXSwitchCase :
  @case Expression : TemplateBlock
  @default : TemplateBlock

JSXTryExpression :
  @try TemplateBlock @pending TemplateBlock
  @try TemplateBlock @catch ( CatchParameteropt ) TemplateBlock
```

Runtime dynamic element and component selection uses the dynamic tag syntax: a JSX expression container in element-name position, written`<{expression}>`. The expression can evaluate to a string tag name or a component constructor, and a non-self-closing element repeats the same expression in its closing tag:`</{expression}>`. No runtime import is required; each target compiler lowers the form to its own runtime helper.

```
JSXElementName :
  JSXIdentifier
  JSXMemberExpression
  JSXNamespacedName
  JSXExpressionContainer

JSXExpressionContainer :
  { AssignmentExpression }
```

```
type Tag = 'section' | 'article';

export function Panel({ as = 'section', title }: { as?: Tag; title: string }) @{
  <{as} className="panel">
    <h2>{title}</h2>
  </{as}>
}
```

The tag expression must be able to resolve to an element name: an identifier, member access, static string, or a runtime expression composed of those. Calls, spreads, string concatenation, string interpolation, and static non-string literals are not valid dynamic tag expressions. Forms such as`<@tag />` and`<@Component />` are not dynamic tag syntax in current TSRX.

- A JSX text child is represented by`JSXText` and contributes escaped static text. Character references such as`"` are decoded before the text value is stored.
- `{ AssignmentExpression }` is the generic template-expression form and is represented by`JSXExpressionContainer`.
- `@{...}` is the template statement form and is represented by`JSXCodeBlock`.
- Identifiers named`text` are ordinary identifiers in braced template expressions.

### 4.3.1 Whitespace

Whitespace in template syntax follows ordinary ECMAScript token-separation rules except at a small number of JSX-like boundaries where the delimiter itself is whitespace-sensitive.

- Within`{ AssignmentExpression }`, whitespace and line terminators are admitted wherever the embedded ECMAScript grammar permits them. Thus forms such as`{ expr }` are well-formed.
- The statement-container introducer must be written as the contiguous sequence`@{`. Whitespace between`@` and`{` does not form a JSXCodeBlock.
- A tag or fragment introducer must be written as a contiguous delimiter sequence. Implementations must not treat`< div>`,`< /div>`,`</ div>`,`< >`, or`< / >` as TSRX template delimiters.
- Whitespace and comments are not admitted within a single tag name. Source texts such as` ` do not form a single TSRX tag name.
- Indentation and line breaks between adjacent template children are permitted as layout. They do not require explicit expression containers merely to separate one element child from the next.

The raw style element is also part of this syntax. A style body is captured as raw text for host-defined stylesheet processing rather than being parsed as nested template children.

## 4.4 Expression Values

TSRX elements, fragments, style elements, and JSX control-flow expressions are expression values by default. A single element can be returned or assigned directly, and JSX control flow can be assigned directly when the branch or loop itself is the value.

```
PrimaryExpression :
  JSXElement
  JSXFragment
  JSXStyleElement
  JSXCodeBlock
  JSXIfExpression
  JSXForExpression
  JSXSwitchExpression
  JSXTryExpression
```

Use a fragment when an expression value needs text, dynamic expression children, or multiple emitted elements. Use a JSX statement container when local declarations must precede that output, including in arrow expression bodies and statement-container function bodies. Use a single element when the value is already compact.

## 4.5 Lazy Destructuring

TSRX extends the baseline binding grammar with lazy array and object forms. The syntax is fixed by the language. The runtime observation model is not. Hosts may implement lazy bindings as deferred property reads, reactive accessors, or another equivalent mechanism, provided the syntactic and static constraints remain satisfied.

```
LazyAssignmentStatement :
  LazyObjectBindingPattern = AssignmentExpression ;
  LazyArrayBindingPattern = AssignmentExpression ;
```

## 4.6 Style Elements and Style Identifiers

The syntax of raw style elements is part of core TSRX. The host is responsible for the meaning of selector scoping, generated class names, selector eligibility, style expression class maps, and stylesheet registration.

```
JSXStyleElement :
  <style JSXAttributesopt> CSSSource </style>
```

## 4.7 Host-defined Server Extensions

Submodule declarations are documented in the first edition as a generic extension surface aligned with the TC39 module declarations proposal. Ripple currently defines one host profile for this surface: module server declarations and imports from server.

```
SubmoduleDeclaration :
  module Identifier { ModuleItemListopt }

SubmoduleImportDeclaration :
  import ImportClause from Identifier ;

```

## 5 Static Semantics: Early Errors

- A tag or fragment delimiter must not be split by intervening whitespace at the points described in 4.3.1.
- Opening and closing tags for TSRX elements and fragments must match.
- A JSXCodeBlock or template control-flow block that contains TypeScript setup statements and rendered output must place those statements before the output node and must have exactly one output node.
- A statement-container function body follows the same structural rule as any other JSXCodeBlock.
- A standalone`JSXExpressionContainer` is not a template output node. Use a JSX fragment when a statement container or control-flow block needs to render text, expression containers, or multiple siblings.
- In hosts that enable server-oriented submodules, server exports must be imported before use, for example import { load } from server.
- Host profiles may restrict which submodule names are supported and may impose additional restrictions on referenced bindings.
- TSRX template children must not appear outside a JSXElement or JSXFragment body.

## 6 Host-defined Semantics

The purpose of the core specification is to make parsers, tooling, and language consumers agree on what TSRX source text means as syntax. The purpose of host documentation is to explain how that syntax is executed, lowered, or bound to runtime facilities.

- How functions returning TSRX lower into executable host code.
- How lazy destructuring is realized at runtime.
- How style expressions expose generated or scoped class names.
- How the dynamic tag syntax`<{expression}>` is lowered, and how the resolved value selects between string tags and component constructors at runtime.
- How submodule declarations and imports from identifier sources are compiled or executed by a host profile that enables them.

## Appendices

The TSRX AST contract exposes ESTree-compatible function nodes and standard JSX-shaped nodes such as JSXElement, JSXFragment, JSXExpressionContainer, JSXText, JSXAttribute, and JSXSpreadAttribute. TSRX-specific additions are limited to JSXCodeBlock, JSXStyleElement, JSXIfExpression, JSXForExpression, JSXSwitchExpression, JSXTryExpression, TSModuleDeclaration, and TSModuleBlock. The grammar in sections 4.1 through 4.7 is normative; the node shapes in this appendix are informative and describe the parser contract exposed to tooling.

### A.1 Grammar-to-node correspondence

The reference parser follows the same broad editorial pattern used by the JSX specification: grammar productions define the accepted source forms, and a separate AST layer records those forms in a stable shape for downstream tools. The following correspondence summarizes the first-edition mappings.

```
Informative grammar-to-node correspondence

FunctionDeclaration, FunctionExpression, ArrowFunctionExpression -> ESTree function nodes
function ... @{ ... } -> ESTree function node with body: JSXCodeBlock
return JSXElement -> ReturnStatement(argument: JSXElement)
return JSXFragment -> ReturnStatement(argument: JSXFragment)
return JSXCodeBlock -> ReturnStatement(argument: JSXCodeBlock)
JSXElement -> ESTree JSXElement
JSXFragment -> ESTree JSXFragment
JSXText -> ESTree JSXText
{ AssignmentExpression } in template position -> JSXExpressionContainer
@{ StatementListItemListopt TemplateOutput } -> JSXCodeBlock
JSXAttributeName JSXAttributeInitializeropt -> JSXAttribute
{ ... AssignmentExpression } in attribute position -> JSXSpreadAttribute
<style> CSSSource </style> -> JSXStyleElement
@if -> JSXIfExpression
@for -> JSXForExpression
@switch -> JSXSwitchExpression
@try -> JSXTryExpression
module Identifier { ModuleItemListopt } -> TSModuleDeclaration
import ImportClause from Identifier -> ImportDeclaration with Identifier source
```

### A.2 Function body and return nodes

Functions remain ordinary ESTree function nodes. TSRX structure begins where a JSXElement, JSXFragment, JSXStyleElement, JSXCodeBlock, or JSX control-flow expression appears as an expression value, most commonly as a ReturnStatement argument. The statement-container function body shorthand stores a JSXCodeBlock directly in the function node's body field without introducing a separate component node kind.

```
interface FunctionDeclaration {
  type: 'FunctionDeclaration';
  id: Identifier | null;
  params: Pattern[];
  body: BlockStatement | JSXCodeBlock;
  typeParameters?: TSTypeParameterDeclaration;
}

interface ReturnStatement {
  type: 'ReturnStatement';
  argument: Expression | null;
}
```

- The function id and params fields preserve the ordinary TypeScript function surface, including type annotations and lazy patterns after parsing.
- Ordinary function bodies remain BlockStatement nodes. A statement-container function body is represented as a JSXCodeBlock in the function body's place.
- A returned or expression-position statement container is represented as a JSXCodeBlock expression.
- A returned native fragment is represented by a JSXFragment node whose children store template children in source order.
- Local template setup is represented by JSXCodeBlock nodes rather than by placing ordinary statement nodes directly in JSXElement or JSXFragment children.
- Raw style elements inside a returned TSRX template carry parsed stylesheet metadata for downstream analysis and target-specific style emission.
- Default exports are represented through the ordinary ESTree ExportDefaultDeclaration wrapping the function declaration or expression.
- Implementation metadata may additionally record topScopedClasses for downstream style-ref analysis.

### A.3 Template and attribute nodes

Template children reuse the JSX AST shape. This appendix distinguishes the element node itself from the JSX opening-tag and attribute nodes that refine it.

```
interface JSXElement {
  type: 'JSXElement';
  openingElement: JSXOpeningElement;
  closingElement: JSXClosingElement | null;
  children: TemplateChild[];
  metadata?: { native_tsrx?: true };
}

interface JSXOpeningElement {
  type: 'JSXOpeningElement';
  name: JSXIdentifier | JSXMemberExpression | JSXNamespacedName | JSXExpressionContainer;
  attributes: Array<JSXAttribute | JSXSpreadAttribute>;
  selfClosing: boolean;
}

interface JSXExpressionContainer {
  type: 'JSXExpressionContainer';
  expression: Expression | JSXEmptyExpression;
}

interface JSXText {
  type: 'JSXText';
  value: string;
}
```

- JSXOpeningElement.name is a JSXIdentifier for ordinary tag names, a JSXMemberExpression for dotted names, a JSXNamespacedName for namespaced names, and a JSXExpressionContainer for dynamic tags written as`<{expression}>`. Dynamic tags additionally mark the element, its opening element, and the name container with an`isDynamic` flag for downstream tooling.
- openingElement and closingElement preserve the original tag delimiters so formatters and source-mapping tools can recover the authored shape.
- JSXOpeningElement.selfClosing records self-closing syntax, while unclosed recovery metadata may be attached by the parser in loose scenarios.
- JSXExpressionContainer wraps the embedded ECMAScript expression from the ordinary {expr} template form.
- JSXText records a raw text child. Static text children decode JSX character references before the text value is stored.
- JSXAttribute.value is null for boolean-style attributes with no initializer. Shorthand attributes are represented as JSXAttribute nodes with parser metadata.
- JSXSpreadAttribute.argument preserves the original ECMAScript expression payload carried by the attribute form.
- Current implementations may additionally attach style-element-specific details such as captured stylesheet source text or styleScopeHash when the element is a raw` ` tag, but those details are not part of the general JSXElement shape described here.

### A.4 Expression value nodes

Expression-position TSRX values use JSXElement, JSXFragment, JSXStyleElement, JSXCodeBlock, JSXIfExpression, JSXForExpression, JSXSwitchExpression, and JSXTryExpression nodes. Native fragments use the standard JSXFragment shape.

```
interface JSXFragment {
  type: 'JSXFragment';
  openingFragment: JSXOpeningFragment;
  closingFragment: JSXClosingFragment;
  children: TemplateChild[];
  metadata?: { native_tsrx?: true };
}

type TSRXExpressionValue =
  | JSXElement
  | JSXFragment
  | JSXStyleElement
  | JSXCodeBlock
  | JSXIfExpression
  | JSXForExpression
  | JSXSwitchExpression
  | JSXTryExpression;

type TemplateOutput =
  | JSXElement
  | JSXFragment
  | JSXIfExpression
  | JSXForExpression
  | JSXSwitchExpression
  | JSXTryExpression;

type TemplateChild =
  | JSXText
  | JSXExpressionContainer
  | JSXCodeBlock
  | TemplateOutput
  | JSXStyleElement;
```

- JSXFragment corresponds to <> ... </> when that form appears in expression position. Its children array follows the TSRX template-child model.
- openingFragment and closingFragment preserve fragment delimiters for formatter and source-mapping tools.

### A.5 TSRX extension nodes

The following nodes are the TSRX-specific additions. Statement containers are represented by JSXCodeBlock nodes in expression, child, and function-body positions. Style blocks are represented as JSXStyleElement nodes. Control-flow directives are represented directly by JSXIfExpression, JSXForExpression, JSXSwitchExpression, and JSXTryExpression nodes.

```
interface JSXCodeBlock {
  type: 'JSXCodeBlock';
  body: StatementListItem[];
  render: TemplateOutput;
}

interface JSXStyleElement {
  type: 'JSXStyleElement';
  openingElement: JSXOpeningElement;
  closingElement: JSXClosingElement | null;
  children: StyleSheet[];
  css?: string;
}

interface JSXIfExpression {
  type: 'JSXIfExpression';
  statementType: 'IfStatement';
  test: Expression;
  consequent: Statement;
  alternate: Statement | null;
}

interface JSXForExpression {
  type: 'JSXForExpression';
  statementType: 'ForStatement' | 'ForInStatement' | 'ForOfStatement';
  body: Statement;
  init?: VariableDeclaration | Expression | null;
  test?: Expression | null;
  update?: Expression | null;
  left?: VariableDeclaration | Pattern;
  right?: Expression;
  await?: boolean;
  index?: Identifier | null;
  key?: Expression | null;
  empty?: BlockStatement | null;
}

interface JSXSwitchExpression {
  type: 'JSXSwitchExpression';
  statementType: 'SwitchStatement';
  discriminant: Expression;
  cases: SwitchCase[];
}

interface JSXTryExpression {
  type: 'JSXTryExpression';
  statementType: 'TryStatement';
  block: BlockStatement;
  handler: CatchClause | null;
  finalizer: BlockStatement | null;
  pending?: BlockStatement | null;
}
```

- The AST contract emits`JSXIfExpression`,`JSXForExpression`,`JSXSwitchExpression`, and`JSXTryExpression` for template control flow.
- `JSXCodeBlock` is a template child and expression value, not a general ECMAScript statement node. Its render field is the one node produced by the container after setup.

### A.6 Submodules, special identifiers, and stylesheets

TSRX reuses TypeScript-compatible module declaration node shapes for submodules and extends ImportDeclaration sources so a source may be an Identifier. These nodes are intentionally narrow: most of their semantics come from surrounding grammar or from host-defined analysis, not from a wide intrinsic property surface.

```
interface TSModuleDeclaration {
  type: 'TSModuleDeclaration';
  id: Identifier;
  body: TSModuleBlock;
}

interface TSModuleBlock {
  type: 'TSModuleBlock';
  body: Array<Statement | ImportDeclaration | ExportNamedDeclaration>;
}

interface CSSStyleSheet {
  type: 'StyleSheet';
  children: Array<Atrule | Rule>;
  source: string;
  hash: string;
}
```

- TSModuleDeclaration represents module Identifier { ... } submodules.
- ImportDeclaration.source may be an Identifier for imports from a declared submodule.
- Ripple records exported names from module server declarations for downstream RPC analysis.
- CSSStyleSheet metadata is attached to raw style elements in returned TSRX templates and stores both the original stylesheet source text and the stable hash used by current host implementations for scoping.

The reference parser is built on Acorn with @sveltejs/acorn-typescript and extended by a custom TSRXPlugin. This is why the grammar in this draft is framed as additive over a TypeScript-compatible baseline rather than as a language unrelated to TypeScript source syntax.