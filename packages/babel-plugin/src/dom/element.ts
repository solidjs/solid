import * as babelTypes from "@babel/types";

const t = babelTypes;

import {
  ChildProperties,
  DelegatedEvents,
  SVGElements,
  MathMLElements,
  Namespaces,
  VoidElements
} from "../../../web/src/constants.js";
import {
  evaluateAndInline,
  getAttributeNamed,
  getTagName,
  isDynamic,
  isComponent,
  registerImportMethod,
  filterChildren,
  toEventName,
  checkLength,
  getStaticExpression,
  reservedNameSpaces,
  wrappedByText,
  getRendererConfig,
  getConfig,
  escapeHTML,
  convertJSXIdentifier,
  isLockedDOMProperty,
  trimWhitespace,
  inlineCallExpression,
  hasStaticMarker,
  canChildSlotAllocateIds
} from "../shared/utils";
import { transformNode } from "../shared/transform";
import { InlineElements, BlockElements } from "./constants";
import type {
  BabelPath,
  DOMTransformResult,
  JSXNode,
  TransformInfo,
  TransformResult
} from "../types";

type JSXAttributePath = BabelPath<babelTypes.JSXAttribute | babelTypes.JSXSpreadAttribute>;
type JSXAttributeOnlyPath = BabelPath<babelTypes.JSXAttribute>;
type JSXChildPath = BabelPath<JSXNode>;
type DOMTransformInfo = TransformInfo & ReturnType<typeof getConfig>;
type DOMSetAttrOptions = {
  dynamic?: boolean;
  prevId?: babelTypes.Expression;
  tagName?: string;
  styleProperty?: boolean;
  classProperty?: boolean;
};
type SpreadOptions = {
  elem: babelTypes.Expression;
  hasChildren: boolean;
};
type HubWithFileMetadata = {
  file?: {
    opts?: {
      filename?: string;
    };
  };
};
type ProgramDataWithEvents = {
  events?: Set<string>;
};

function isNamedAttribute(
  attribute: JSXAttributePath,
  name: string
): attribute is JSXAttributeOnlyPath {
  return (
    t.isJSXAttribute(attribute.node) &&
    t.isJSXIdentifier(attribute.node.name) &&
    attribute.node.name.name === name
  );
}

/**
 * Whether an element participates in the element-claim contract: `a[href]`
 * and `form[action]` (attribute present in any form, or a spread that may
 * carry it). Compiled output claims these at creation via `claimElement` so
 * consumers (e.g. a router's link-state layer) can track them without
 * per-element components or observers. Dormant at runtime until a consumer
 * registers.
 */
function isClaimTarget(node: babelTypes.JSXElement): boolean {
  const tagName = getTagName(node);
  const attrName = tagName === "a" ? "href" : tagName === "form" ? "action" : undefined;
  if (!attrName) return false;
  return node.openingElement.attributes.some(
    attr =>
      t.isJSXSpreadAttribute(attr) ||
      (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === attrName)
  );
}

const alwaysClose = [
  "title",
  "style",
  "a",
  "strong",
  "small",
  "b",
  "u",
  "i",
  "em",
  "s",
  "code",
  "object",
  "table",
  "button",
  "textarea",
  "select",
  "iframe",
  "script",
  "noscript",
  "template",
  "fieldset"
];

export function transformElement(
  path: BabelPath<babelTypes.JSXElement>,
  info: TransformInfo = {}
): DOMTransformResult {
  let tagName = getTagName(path.node);

  path
    .get("openingElement")
    .get("attributes")
    .forEach((attr: JSXAttributePath) => {
      if (t.isJSXAttribute(attr.node)) evaluateAndInline(attr.node.value, attr.get("value"));
    });

  let isWrapped = false;
  let wrapperTag = "";
  if (info.topLevel) {
    /**
     * XML handling.
     *
     * 1. XML partials are wrapped into their "owner" tag <svg>/<math>
     * 2. "xmlns" attribute is also used to know if a tag needs to be wrapped. For example `<a
     *    xmlns="http://www.w3.org/2000/svg"/>` becomes `<svg><a/></svg>`
     * 3. "xmlns" attribute is not needed by the browser and removed to make templates smaller
     */
    const xmlnsAttr = getAttributeNamed(path, "xmlns");

    // svg and math tags are already wrapped
    if (tagName !== "svg" && tagName !== "math") {
      const xmlnsValue = xmlnsAttr?.node.value;
      const xmlns = babelTypes.isJSXExpressionContainer(xmlnsValue)
        ? (xmlnsValue.expression as babelTypes.StringLiteral).value
        : babelTypes.isStringLiteral(xmlnsValue)
          ? xmlnsValue.value
          : undefined;

      if (SVGElements.has(tagName) || xmlns === Namespaces.svg) {
        isWrapped = true;
        wrapperTag = "svg";
        xmlnsAttr && xmlnsAttr.remove();
      } else if (MathMLElements.has(tagName) || xmlns === Namespaces.mathml) {
        isWrapped = true;
        wrapperTag = "math";
        xmlnsAttr && xmlnsAttr.remove();
      }
    } else {
      xmlnsAttr && xmlnsAttr.remove();
    }
  }

  let config = getConfig(path),
    voidTag = VoidElements.has(tagName),
    hasCustomElement =
      tagName.indexOf("-") > -1 ||
      path
        .get("openingElement")
        .get("attributes")
        .some(
          (a: JSXAttributePath) =>
            t.isJSXAttribute(a.node) &&
            !t.isJSXNamespacedName(a.node.name) &&
            a.node.name.name === "is"
        ),
    isImportNode =
      hasCustomElement ||
      ((tagName === "img" || tagName === "iframe") &&
        path
          .get("openingElement")
          .get("attributes")
          .some(
            (a: JSXAttributePath) =>
              t.isJSXAttribute(a.node) &&
              !t.isJSXNamespacedName(a.node.name) &&
              a.node.name.name === "loading"
          )),
    results: DOMTransformResult = {
      template: `<${tagName}`,
      templateWithClosingTags: `<${tagName}`,
      declarations: [],
      exprs: [],
      dynamics: [],
      postExprs: [],
      isImportNode,
      isWrapped,
      tagName,
      renderer: "dom",
      skipTemplate: false
    };

  if (!config.inlineStyles) {
    path
      .get("openingElement")
      .get("attributes")
      .forEach((a: JSXAttributePath) => {
        if (
          t.isJSXAttribute(a.node) &&
          !t.isJSXNamespacedName(a.node.name) &&
          a.node.name.name === "style"
        ) {
          let value: babelTypes.Expression | babelTypes.BlockStatement | null =
            t.isJSXExpressionContainer(a.node.value) &&
            !t.isJSXEmptyExpression(a.node.value.expression)
              ? a.node.value.expression
              : t.isStringLiteral(a.node.value)
                ? a.node.value
                : null;
          if (t.isStringLiteral(value)) {
            // jsx attribute value is a sting that may takes more than one line
            value = t.templateLiteral(
              [t.templateElement({ raw: value.value, cooked: value.value })],
              []
            );
          }
          if (value)
            a.get("value").replaceWith(
              t.jSXExpressionContainer(t.callExpression(t.arrowFunctionExpression([], value), []))
            );
        }
      });
  }

  path
    .get("openingElement")
    .get("attributes")
    .some((a: JSXAttributePath) => {
      if (
        t.isJSXAttribute(a.node) &&
        !t.isJSXNamespacedName(a.node.name) &&
        a.node.name.name === "_hk"
      ) {
        a.remove();
        let filename = "";
        try {
          filename =
            ((path.scope.getProgramParent().path.hub as HubWithFileMetadata).file?.opts
              ?.filename as string | undefined) || "";
        } catch (e) {}

        console.log(
          "\n" +
            path
              .buildCodeFrameError(
                `"_hk" attribute found in template, which could potentially cause hydration miss-matches. Usually happens when copying and pasting Solid SSRed code into JSX. Please remove the attribute from the JSX. \n\n${filename}\n`
              )
              .toString()
        );
      }
    });
  if (config.hydratable && (tagName === "html" || tagName === "head" || tagName === "body")) {
    results.skipTemplate = true;
  }
  if (wrapperTag !== "") {
    results.template = `<${wrapperTag}>` + results.template;
    results.templateWithClosingTags = `<${wrapperTag}>` + results.templateWithClosingTags;
  }
  if (!info.skipId) {
    results.id = path.scope.generateUidIdentifier("el$");
  }
  // Claim contract: a[href] / form[action] elements are claimed at creation
  // so registered consumers (e.g. a router's link-state layer) see them.
  // detectExpressions forces the id chain, so claim targets always have one.
  // Emitted ahead of the attribute expressions — writes to the claimed
  // attribute recheck through the runtime's setAttribute, so order stays
  // correct either way, but "claim at creation" reads first.
  if (results.id && isClaimTarget(path.node)) {
    results.exprs.push(
      t.expressionStatement(
        t.callExpression(
          registerImportMethod(path, "claimElement", getRendererConfig(path, "dom").moduleName),
          [results.id]
        )
      )
    );
  }
  transformAttributes(path, results);
  if (config.contextToCustomElements && (tagName === "slot" || hasCustomElement)) {
    contextToCustomElement(path, results);
  }
  results.template += ">";
  results.templateWithClosingTags += ">";
  if (!voidTag) {
    // always close tags can still be skipped if they have no closing parents and are the last element
    const toBeClosed =
      !info.lastElement ||
      !config.omitLastClosingTag ||
      (info.toBeClosed && (!config.omitNestedClosingTags || info.toBeClosed.has(tagName)));
    if (toBeClosed) {
      results.toBeClosed = new Set(info.toBeClosed || alwaysClose);
      results.toBeClosed.add(tagName);
      if (InlineElements.includes(tagName))
        BlockElements.forEach((i: string) => results.toBeClosed!.add(i));
    } else results.toBeClosed = info.toBeClosed;
    if (tagName !== "noscript") transformChildren(path, results, config);
    if (toBeClosed) results.template += `</${tagName}>`;
    results.templateWithClosingTags += `</${tagName}>`;
  }
  if (info.topLevel && config.hydratable && results.hasHydratableEvent) {
    let runHydrationEvents = registerImportMethod(
      path,
      "runHydrationEvents",
      getRendererConfig(path, "dom").moduleName
    );
    results.postExprs.push(t.expressionStatement(t.callExpression(runHydrationEvents, [])));
  }
  if (wrapperTag !== "") {
    results.template += `</${wrapperTag}>`;
    results.templateWithClosingTags += `</${wrapperTag}>`;
  }
  return results;
}

export function setAttr(
  path: BabelPath,
  elem: babelTypes.Expression,
  name: string,
  value: babelTypes.Expression,
  { dynamic, prevId, tagName, styleProperty, classProperty }: DOMSetAttrOptions = {}
): babelTypes.Expression {
  // pull out namespace
  const config = getConfig(path);
  let parts, namespace;
  if ((parts = name.split(":")) && parts[1] && reservedNameSpaces.has(parts[0])) {
    name = parts[1];
    namespace = parts[0];
  }

  // `styleProperty` and `classProperty` are set only for properties extracted
  // by the `style={{...}}` / `class={{...}}` splitters — never for user-written
  // `style:foo` / `class:foo`, which fall through to literal attributes.
  if (styleProperty) {
    if (parts && parts[1] && parts[0] === "style") name = parts[1];
    return t.callExpression(
      registerImportMethod(path, "setStyleProperty", getRendererConfig(path, "dom").moduleName),
      [
        elem,
        t.stringLiteral(name),
        t.isAssignmentExpression(value) && t.isIdentifier(value.left) ? value.right : value
      ]
    );
  }

  if (classProperty) {
    if (parts && parts[1] && parts[0] === "class") name = parts[1];
    return t.callExpression(
      t.memberExpression(
        t.memberExpression(elem, t.identifier("classList")),
        t.identifier("toggle")
      ),
      [
        t.stringLiteral(name),
        dynamic ? value : t.unaryExpression("!", t.unaryExpression("!", value))
      ]
    );
  }

  if (name === "style") {
    return t.callExpression(
      registerImportMethod(path, "style", getRendererConfig(path, "dom").moduleName),
      prevId ? [elem, value, prevId] : [elem, value]
    );
  }

  if (name === "class") {
    return t.callExpression(
      registerImportMethod(path, "className", getRendererConfig(path, "dom").moduleName),
      prevId ? [elem, value, prevId] : [elem, value]
    );
  }

  if (dynamic && name === "textContent") {
    if (config.hydratable) {
      return t.callExpression(registerImportMethod(path, "setProperty"), [
        elem,
        t.stringLiteral("data"),
        value
      ]);
    }
    return t.assignmentExpression("=", t.memberExpression(elem, t.identifier("data")), value);
  }

  const isChildProp = ChildProperties.has(name);
  const isLocked = isLockedDOMProperty(tagName, name);

  if (isChildProp || namespace === "prop" || isLocked) {
    if (config.hydratable && namespace !== "prop" && !isLocked) {
      return t.callExpression(registerImportMethod(path, "setProperty"), [
        elem,
        t.stringLiteral(name),
        value
      ]);
    }

    const assignment = t.assignmentExpression(
      "=",
      t.memberExpression(elem, t.identifier(name)),
      value
    );
    // handle select/options... TODO: consider other ways in the future
    // TODO: there may be a race condition here
    if (name === "value" && tagName === "select") {
      return t.logicalExpression(
        "||",
        t.callExpression(t.identifier("queueMicrotask"), [
          t.arrowFunctionExpression([], assignment)
        ]),
        assignment
      );
    }
    if (
      (name === "value" || name === "defaultValue") &&
      (tagName === "input" || tagName === "textarea") &&
      !t.isStringLiteral(value) &&
      !t.isNumericLiteral(value)
    ) {
      // prevents undefined on input/textarea.value/defaultValue, fallback to empty string
      return t.assignmentExpression(
        "=",
        t.memberExpression(elem, t.identifier(name)),
        t.logicalExpression("??", value, t.stringLiteral(""))
      );
    }
    return assignment;
  }

  const ns = name.indexOf(":") > -1 && Namespaces[name.split(":")[0]];
  if (ns) {
    return t.callExpression(
      registerImportMethod(path, "setAttributeNS", getRendererConfig(path, "dom").moduleName),
      [elem, t.stringLiteral(ns), t.stringLiteral(name), value]
    );
  } else {
    return t.callExpression(
      registerImportMethod(path, "setAttribute", getRendererConfig(path, "dom").moduleName),
      [elem, t.stringLiteral(name), value]
    );
  }
}

function detectResolvableEventHandler(
  attribute: BabelPath,
  handler: babelTypes.Expression
): boolean {
  while (t.isIdentifier(handler)) {
    const lookup = attribute.scope.getBinding(handler.name);
    if (lookup) {
      if (t.isVariableDeclarator(lookup.path.node)) {
        handler = lookup.path.node.init as babelTypes.Expression;
      } else if (t.isFunctionDeclaration(lookup.path.node)) {
        return true;
      } else return false;
    } else return false;
  }
  return t.isFunction(handler);
}

function transformAttributes(
  path: BabelPath<babelTypes.JSXElement>,
  results: DOMTransformResult
): void {
  let elem = results.id as babelTypes.Expression,
    hasHydratableEvent = false,
    children: babelTypes.JSXExpressionContainer | babelTypes.JSXText | undefined,
    spreadExpr: babelTypes.ExpressionStatement | undefined,
    attributes = path.get("openingElement").get("attributes") as JSXAttributePath[];
  const tagName = getTagName(path.node),
    hasChildren = path.node.children.length > 0,
    config = getConfig(path);

  // preprocess spreads
  if (attributes.some(attribute => t.isJSXSpreadAttribute(attribute.node))) {
    [attributes, spreadExpr] = processSpreads(path, attributes, {
      elem,
      hasChildren
    });
    path.get("openingElement").set(
      "attributes",
      attributes.map(a => a.node)
    );
    //NOTE: can't be checked at compile time so add to compiled output
    hasHydratableEvent = true;
  } else {
    const seenAttributes: Record<string, JSXAttributeOnlyPath> = {};
    const duplicates: JSXAttributeOnlyPath[] = [];
    path
      .get("openingElement")
      .get("attributes")
      .forEach((attr: JSXAttributePath) => {
        if (!t.isJSXAttribute(attr.node)) return;
        const key = t.isJSXNamespacedName(attr.node.name)
          ? `${attr.node.name.namespace.name}:${attr.node.name.name.name}`
          : attr.node.name.name;

        if (key !== "ref" && seenAttributes[key]) {
          duplicates.push(seenAttributes[key]);
        }
        seenAttributes[key] = attr as JSXAttributeOnlyPath;
      });
    for (const duplicate of duplicates) {
      duplicate.remove();
    }
  }

  /**
   * Inline styles
   *
   * 1. When string
   * 2. When is an object, the key is a string, and value is string/numeric
   * 3. Remove properties from object when value is undefined/null
   * 4. When `value.evaluate().confident`
   *
   * Also, when `key` is computed value is also `value.evaluate().confident`
   */

  attributes = path.get("openingElement").get("attributes") as JSXAttributePath[];

  const styleAttributes = attributes.filter((a): a is JSXAttributeOnlyPath =>
    isNamedAttribute(a, "style")
  );
  if (styleAttributes.length > 0) {
    let inlinedStyle = "";

    for (let i = 0; i < styleAttributes.length; i++) {
      const attr = styleAttributes[i];

      let value = attr.node.value as
        | babelTypes.Expression
        | babelTypes.JSXExpressionContainer
        | null;
      if (t.isJSXExpressionContainer(value)) {
        value = value.expression as babelTypes.Expression;
      }

      if (t.isStringLiteral(value)) {
        inlinedStyle += `${value.value.replace(/;$/, "")};`;
        attr.remove();
      } else if (t.isObjectExpression(value)) {
        const styleObject = value;
        const properties = styleObject.properties;
        const propertiesNode = (attr.get("value") as BabelPath)
          .get("expression")
          .get("properties") as BabelPath[];
        const toRemoveProperty: babelTypes.ObjectProperty[] = [];
        for (let i = 0; i < properties.length; i++) {
          const property = properties[i];

          if (!t.isObjectProperty(property)) continue;
          if (property.computed) {
            /* { [computed]: `${1+1}px` } => { [computed]: `2px` } */
            const r = (propertiesNode[i].get("value") as BabelPath).evaluate();
            if (r.confident && (typeof r.value === "string" || typeof r.value === "number")) {
              property.value = t.inherits(t.stringLiteral(`${r.value}`), property.value);
            }
            // computed cannot be inlined - maybe can be evaluated but this is pretty rare
            continue;
          }

          {
            const key = t.isIdentifier(property.key)
              ? property.key.name
              : (property.key as babelTypes.StringLiteral | babelTypes.NumericLiteral).value;
            if (t.isStringLiteral(property.value) || t.isNumericLiteral(property.value)) {
              inlinedStyle += `${key}:${property.value.value};`;
              toRemoveProperty.push(property);
            } else if (
              (t.isIdentifier(property.value) && property.value.name === "undefined") ||
              t.isNullLiteral(property.value)
            ) {
              toRemoveProperty.push(property);
            } else {
              const r = (propertiesNode[i].get("value") as BabelPath).evaluate();
              if (r.confident && (typeof r.value === "string" || typeof r.value === "number")) {
                inlinedStyle += `${key}:${r.value};`;
                toRemoveProperty.push(property);
              }
            }
          }
        }
        for (const remove of toRemoveProperty) {
          styleObject.properties.splice(styleObject.properties.indexOf(remove), 1);
        }
        if (styleObject.properties.length === 0) {
          attr.remove();
        }
      }
    }

    if (inlinedStyle !== "") {
      const styleAttribute = t.jsxAttribute(
        t.jsxIdentifier("style"),
        t.stringLiteral(inlinedStyle.replace(/;$/, ""))
      );
      path.get("openingElement").node.attributes.push(styleAttribute);
    }
  }

  // Split remaining `style={{...}}` object props out into individual attributes
  // marked `_styleProperty` so they compile to `setStyleProperty()` calls. The
  // marker keeps user-written `style:foo` literal (no marker, no special
  // handling).
  const styleObjectAttribute = path
    .get("openingElement")
    .get("attributes")
    .find((a): a is JSXAttributeOnlyPath => {
      if (!isNamedAttribute(a as JSXAttributePath, "style")) return false;
      const value = (a as JSXAttributeOnlyPath).node.value;
      return (
        t.isJSXExpressionContainer(value) &&
        t.isObjectExpression(value.expression) &&
        !value.expression.properties.some((p: babelTypes.ObjectMember | babelTypes.SpreadElement) =>
          t.isSpreadElement(p)
        )
      );
    });
  if (styleObjectAttribute) {
    const styleValue = styleObjectAttribute.node.value as babelTypes.JSXExpressionContainer & {
      expression: babelTypes.ObjectExpression;
    };
    let i = 0,
      leading = styleValue.expression.leadingComments;
    styleValue.expression.properties.slice().forEach((p, index) => {
      if (!t.isObjectProperty(p)) return;
      if (!p.computed) {
        if (leading) p.value.leadingComments = leading;
        const newAttr = t.jsxAttribute(
          t.jsxNamespacedName(
            t.jsxIdentifier("style"),
            t.jsxIdentifier(
              t.isIdentifier(p.key)
                ? p.key.name
                : String((p.key as babelTypes.StringLiteral | babelTypes.NumericLiteral).value)
            )
          ),
          t.jsxExpressionContainer(p.value as babelTypes.Expression)
        );
        (newAttr as babelTypes.JSXAttribute & { _styleProperty?: boolean })._styleProperty = true;
        path
          .get("openingElement")
          .node.attributes.splice(Number(styleObjectAttribute.key) + ++i, 0, newAttr);
        styleValue.expression.properties.splice(index - i - 1, 1);
      }
    });
    if (!styleValue.expression.properties.length)
      path.get("openingElement").node.attributes.splice(Number(styleObjectAttribute.key), 1);
  }

  // preprocess leading static classes in fixed-shape class arrays
  attributes = path.get("openingElement").get("attributes") as JSXAttributePath[];
  const classArrayAttribute = attributes.find(
    (a): a is JSXAttributeOnlyPath =>
      isNamedAttribute(a, "class") &&
      t.isJSXExpressionContainer(a.node.value) &&
      t.isArrayExpression(a.node.value.expression)
  );
  if (classArrayAttribute) {
    const classArrayValue = classArrayAttribute.node.value as babelTypes.JSXExpressionContainer & {
      expression: babelTypes.ArrayExpression;
    };
    const elements = classArrayValue.expression.elements;
    let i = 0,
      staticClasses: string[] = [];
    while (t.isStringLiteral(elements[i])) {
      staticClasses.push((elements[i] as babelTypes.StringLiteral).value);
      i++;
    }
    const dynamicClassElement = elements[i] as babelTypes.ObjectExpression | null;
    const staticClassSet = new Set(
      staticClasses.flatMap(className => trimWhitespace(className).split(/\s+/).filter(Boolean))
    );
    if (
      staticClasses.length &&
      i === elements.length - 1 &&
      t.isObjectExpression(dynamicClassElement) &&
      !dynamicClassElement.properties.some(
        (p: babelTypes.ObjectMember | babelTypes.SpreadElement) =>
          t.isSpreadElement(p) ||
          p.computed ||
          (t.isStringLiteral(p.key) && (p.key.value.includes(" ") || p.key.value.includes(":"))) ||
          staticClassSet.has(
            t.isIdentifier(p.key)
              ? p.key.name
              : String((p.key as babelTypes.StringLiteral | babelTypes.NumericLiteral).value)
          )
      )
    ) {
      classArrayAttribute.node.value = t.stringLiteral(staticClasses.join(" "));
      path
        .get("openingElement")
        .node.attributes.splice(
          Number(classArrayAttribute.key) + 1,
          0,
          t.jsxAttribute(t.jsxIdentifier("class"), t.jsxExpressionContainer(dynamicClassElement))
        );
    }
  }

  // preprocess optimal class objects
  attributes = path.get("openingElement").get("attributes") as JSXAttributePath[];
  const classListAttribute = attributes.find(
    (a): a is JSXAttributeOnlyPath =>
      isNamedAttribute(a, "class") &&
      t.isJSXExpressionContainer(a.node.value) &&
      t.isObjectExpression(a.node.value.expression) &&
      !a.node.value.expression.properties.some(
        (p: babelTypes.ObjectMember | babelTypes.SpreadElement) =>
          t.isSpreadElement(p) ||
          p.computed ||
          (t.isStringLiteral(p.key) && (p.key.value.includes(" ") || p.key.value.includes(":")))
      )
  );
  if (classListAttribute) {
    const classListValue = classListAttribute.node.value as babelTypes.JSXExpressionContainer & {
      expression: babelTypes.ObjectExpression;
    };
    let i = 0,
      leading = classListValue.expression.leadingComments,
      classListProperties = classListAttribute
        .get("value")
        .get("expression")
        .get("properties") as BabelPath[];
    classListProperties.slice().forEach((propPath, index) => {
      const p = propPath.node;
      if (!t.isObjectProperty(p)) return;
      const { confident, value: computed } = propPath.get("value").evaluate();
      if (leading) p.value.leadingComments = leading;
      if (!confident) {
        const newAttr = t.jsxAttribute(
          t.jsxNamespacedName(
            t.jsxIdentifier("class"),
            t.jsxIdentifier(
              t.isIdentifier(p.key)
                ? p.key.name
                : String((p.key as babelTypes.StringLiteral | babelTypes.NumericLiteral).value)
            )
          ),
          t.jsxExpressionContainer(p.value as babelTypes.Expression)
        );
        (newAttr as babelTypes.JSXAttribute & { _classProperty?: boolean })._classProperty = true;
        path
          .get("openingElement")
          .node.attributes.splice(Number(classListAttribute.key) + ++i, 0, newAttr);
      } else if (computed) {
        path
          .get("openingElement")
          .node.attributes.splice(
            Number(classListAttribute.key) + ++i,
            0,
            t.jsxAttribute(
              t.jsxIdentifier("class"),
              t.stringLiteral(
                t.isIdentifier(p.key)
                  ? p.key.name
                  : String((p.key as babelTypes.StringLiteral | babelTypes.NumericLiteral).value)
              )
            )
          );
      }
      classListProperties.splice(index - i - 1, 1);
    });
    if (!classListProperties.length)
      path.get("openingElement").node.attributes.splice(Number(classListAttribute.key), 1);
  }

  // combine class properties
  attributes = path.get("openingElement").get("attributes") as JSXAttributePath[];
  const classAttributes = attributes.filter((a): a is JSXAttributeOnlyPath =>
    isNamedAttribute(a, "class")
  );
  if (classAttributes.length > 1) {
    const first = classAttributes[0].node,
      values: babelTypes.Expression[] = [],
      quasis = [t.templateElement({ raw: "" })];
    for (let i = 0; i < classAttributes.length; i++) {
      const attr = classAttributes[i].node,
        isLast = i === classAttributes.length - 1;
      if (!t.isJSXExpressionContainer(attr.value)) {
        const prev = quasis.pop();
        quasis.push(
          t.templateElement({
            raw:
              (prev ? prev.value.raw : "") +
              `${(attr.value as babelTypes.StringLiteral).value}` +
              (isLast ? "" : " ")
          })
        );
      } else {
        values.push(
          t.logicalExpression(
            "||",
            attr.value.expression as babelTypes.Expression,
            t.stringLiteral("")
          )
        );
        quasis.push(t.templateElement({ raw: isLast ? "" : " " }));
      }
      i && attributes.splice(attributes.indexOf(classAttributes[i]), 1);
    }
    if (values.length) first.value = t.jsxExpressionContainer(t.templateLiteral(quasis, values));
    else first.value = t.stringLiteral(quasis[0].value.raw);
  }
  path.get("openingElement").set(
    "attributes",
    attributes.map(a => a.node)
  );

  let needsSpacing = true;

  // scoped because of `needsSpacing`
  function inlineAttributeOnTemplate(
    key: string,
    results: DOMTransformResult,
    value: babelTypes.StringLiteral | babelTypes.NumericLiteral | babelTypes.BooleanLiteral | null
  ): void {
    results.template += `${needsSpacing ? " " : ""}${key}`;

    if (!value) {
      needsSpacing = true;
      return;
    }

    let text = String(value.value);
    let needsQuoting = !config.omitQuotes;

    if (key === "style" || key === "class") {
      text = trimWhitespace(text);
      if (key === "style") {
        text = text.replace(/; /g, ";").replace(/: /g, ":");
      }
    }

    if (!text.length) {
      needsSpacing = true;
      results.template += ``;
      return;
    }

    for (let i = 0, len = text.length; i < len; i++) {
      let char = text[i];

      if (
        char === "'" ||
        char === '"' ||
        char === " " ||
        char === "\t" ||
        char === "\n" ||
        char === "\r" ||
        char === "`" ||
        char === "=" ||
        char === "<" ||
        char === ">"
      ) {
        needsQuoting = true;
      }
    }

    if (needsQuoting) {
      needsSpacing = !config.omitAttributeSpacing;
      results.template += `="${escapeHTML(text, true)}"`;
    } else {
      needsSpacing = true;
      results.template += `=${escapeHTML(text, true)}`;
    }
  }

  path
    .get("openingElement")
    .get("attributes")
    .forEach((attribute: JSXAttributePath) => {
      if (!t.isJSXAttribute(attribute.node)) return;
      const node = attribute.node;
      const isStyleProperty =
        (node as babelTypes.JSXAttribute & { _styleProperty?: boolean })._styleProperty === true;
      const isClassProperty =
        (node as babelTypes.JSXAttribute & { _classProperty?: boolean })._classProperty === true;
      let value = node.value,
        key = t.isJSXNamespacedName(node.name)
          ? `${node.name.namespace.name}:${node.name.name.name}`
          : node.name.name,
        reservedNameSpace =
          isStyleProperty ||
          isClassProperty ||
          (t.isJSXNamespacedName(node.name) && reservedNameSpaces.has(node.name.namespace.name));
      if (t.isJSXExpressionContainer(value)) {
        const evaluated = attribute.get("value").get("expression").evaluate().value;
        let type;
        if (
          evaluated !== undefined &&
          ((type = typeof evaluated) === "string" || type === "number")
        ) {
          if (type === "number" && key.startsWith("prop:")) {
            value = t.jsxExpressionContainer(t.numericLiteral(evaluated));
          } else value = t.stringLiteral(String(evaluated));
        }
      }
      if (
        t.isJSXNamespacedName(node.name) &&
        reservedNameSpace &&
        !t.isJSXExpressionContainer(value)
      ) {
        node.value = value = t.jsxExpressionContainer(value || t.jsxEmptyExpression());
      }
      if (
        t.isJSXExpressionContainer(value) &&
        (reservedNameSpace ||
          !(
            t.isStringLiteral(value.expression) ||
            t.isNumericLiteral(value.expression) ||
            t.isBooleanLiteral(value.expression)
          ))
      ) {
        if (t.isJSXEmptyExpression(value.expression)) return;
        if (key === "ref") {
          // Normalize expressions for non-null and type-as
          while (
            t.isTSNonNullExpression(value.expression) ||
            t.isTSAsExpression(value.expression)
          ) {
            value.expression = value.expression.expression;
          }
          let binding,
            isConstant =
              t.isIdentifier(value.expression) &&
              (binding = path.scope.getBinding(value.expression.name)) &&
              (binding.kind === "const" || binding.kind === "module");
          if (!isConstant && t.isLVal(value.expression)) {
            const refIdentifier = path.scope.generateUidIdentifier("_ref$");
            results.exprs.unshift(
              t.variableDeclaration("var", [t.variableDeclarator(refIdentifier, value.expression)]),
              t.expressionStatement(
                t.conditionalExpression(
                  t.logicalExpression(
                    "||",
                    t.binaryExpression(
                      "===",
                      t.unaryExpression("typeof", refIdentifier),
                      t.stringLiteral("function")
                    ),
                    t.callExpression(
                      t.memberExpression(t.identifier("Array"), t.identifier("isArray")),
                      [refIdentifier]
                    )
                  ),
                  t.callExpression(
                    registerImportMethod(path, "ref", getRendererConfig(path, "dom").moduleName),
                    [t.arrowFunctionExpression([], refIdentifier), elem]
                  ),
                  t.assignmentExpression("=", value.expression, elem)
                )
              )
            );
          } else if (
            isConstant ||
            t.isFunction(value.expression) ||
            t.isArrayExpression(value.expression)
          ) {
            results.exprs.unshift(
              t.expressionStatement(
                t.callExpression(
                  registerImportMethod(path, "ref", getRendererConfig(path, "dom").moduleName),
                  [t.arrowFunctionExpression([], value.expression), elem]
                )
              )
            );
          } else {
            const refIdentifier = path.scope.generateUidIdentifier("_ref$");
            results.exprs.unshift(
              t.variableDeclaration("var", [t.variableDeclarator(refIdentifier, value.expression)]),
              t.expressionStatement(
                t.logicalExpression(
                  "&&",
                  t.logicalExpression(
                    "||",
                    t.binaryExpression(
                      "===",
                      t.unaryExpression("typeof", refIdentifier),
                      t.stringLiteral("function")
                    ),
                    t.callExpression(
                      t.memberExpression(t.identifier("Array"), t.identifier("isArray")),
                      [refIdentifier]
                    )
                  ),
                  t.callExpression(
                    registerImportMethod(path, "ref", getRendererConfig(path, "dom").moduleName),
                    [t.arrowFunctionExpression([], refIdentifier), elem]
                  )
                )
              )
            );
          }
        } else if (key === "children") {
          children = value;
        } else if (key.startsWith("on")) {
          const ev = toEventName(key);
          if (
            config.delegateEvents &&
            (DelegatedEvents.has(ev) || config.delegatedEvents.indexOf(ev) !== -1)
          ) {
            // can only hydrate delegated events
            hasHydratableEvent = true;
            const programData = attribute.scope.getProgramParent().data as ProgramDataWithEvents;
            const events = programData.events || (programData.events = new Set());
            events.add(ev);
            let handler = value.expression;
            const resolveable = detectResolvableEventHandler(attribute, handler);
            if (t.isArrayExpression(handler)) {
              if (handler.elements.length > 1) {
                results.exprs.unshift(
                  t.expressionStatement(
                    t.assignmentExpression(
                      "=",
                      t.memberExpression(elem, t.identifier(`$$${ev}Data`)),
                      handler.elements[1] as babelTypes.Expression
                    )
                  )
                );
              }
              handler = handler.elements[0] as babelTypes.Expression;
              results.exprs.unshift(
                t.expressionStatement(
                  t.assignmentExpression(
                    "=",
                    t.memberExpression(elem, t.identifier(`$$${ev}`)),
                    handler
                  )
                )
              );
            } else if (t.isFunction(handler) || resolveable) {
              results.exprs.unshift(
                t.expressionStatement(
                  t.assignmentExpression(
                    "=",
                    t.memberExpression(elem, t.identifier(`$$${ev}`)),
                    handler
                  )
                )
              );
            } else {
              results.exprs.unshift(
                t.expressionStatement(
                  t.callExpression(
                    registerImportMethod(
                      path,
                      "addEvent",
                      getRendererConfig(path, "dom").moduleName
                    ),
                    [elem, t.stringLiteral(ev), handler, t.booleanLiteral(true)]
                  )
                )
              );
            }
          } else {
            let handler = value.expression;
            const resolveable = detectResolvableEventHandler(attribute, handler);
            if (t.isArrayExpression(handler)) {
              if (handler.elements.length > 1) {
                handler = t.arrowFunctionExpression(
                  [t.identifier("e")],
                  t.callExpression(handler.elements[0] as babelTypes.Expression, [
                    handler.elements[1] as babelTypes.Expression,
                    t.identifier("e")
                  ])
                );
              } else handler = handler.elements[0] as babelTypes.Expression;
              results.exprs.unshift(
                t.expressionStatement(
                  t.callExpression(t.memberExpression(elem, t.identifier("addEventListener")), [
                    t.stringLiteral(ev),
                    handler
                  ])
                )
              );
            } else if (t.isFunction(handler) || resolveable) {
              results.exprs.unshift(
                t.expressionStatement(
                  t.callExpression(t.memberExpression(elem, t.identifier("addEventListener")), [
                    t.stringLiteral(ev),
                    handler
                  ])
                )
              );
            } else {
              results.exprs.unshift(
                t.expressionStatement(
                  t.callExpression(
                    registerImportMethod(
                      path,
                      "addEvent",
                      getRendererConfig(path, "dom").moduleName
                    ),
                    [elem, t.stringLiteral(ev), handler]
                  )
                )
              );
            }
          }
        } else if (
          config.effectWrapper &&
          (isDynamic(attribute.get("value").get("expression"), {
            checkMember: true
          }) ||
            ((key === "class" || key === "style") &&
              !attribute.get("value").get("expression").evaluate().confident &&
              !hasStaticMarker(value, path)))
        ) {
          // own effect
          let nextElem = elem as babelTypes.Expression;
          if (key === "textContent") {
            nextElem = attribute.scope.generateUidIdentifier("el$");
            children = t.jsxText(" ");
            children.extra = { raw: " ", rawValue: " " };
            results.declarations.push(
              t.variableDeclarator(
                nextElem as babelTypes.LVal,
                t.memberExpression(elem, t.identifier("firstChild"))
              )
            );
          }
          results.dynamics.push({
            elem: nextElem,
            key,
            value: value.expression,
            tagName,
            styleProperty: isStyleProperty,
            classProperty: isClassProperty
          });
        } else {
          results.exprs.push(
            t.expressionStatement(
              setAttr(attribute, elem, key, value.expression, {
                tagName,
                styleProperty: isStyleProperty,
                classProperty: isClassProperty
              })
            )
          );
        }
      } else {
        if (config.hydratable && key === "$ServerOnly") {
          results.skipTemplate = true;
          return;
        }
        let staticValue: babelTypes.Expression | babelTypes.JSXAttribute["value"] = value;
        if (t.isJSXExpressionContainer(value)) {
          if (t.isJSXEmptyExpression(value.expression)) return;
          staticValue = value.expression as babelTypes.Expression;
        }

        // Native `children` is child content, not a DOM property and not an
        // HTML attribute. Promote it so the child pass can template-inline
        // statics or `insert()` dynamics — same as writing `{value}` as a child.
        if (key === "children") {
          if (!hasChildren && !VoidElements.has(tagName) && staticValue) {
            children = t.isJSXExpressionContainer(value)
              ? value
              : t.jsxExpressionContainer(staticValue as babelTypes.Expression);
          }
          return;
        }

        // boolean as `<el attr={true | false}/>`, not as `<el attr={"true" | "false"}/>`
        // `<el attr={true}/>` becomes `<el attr/>`
        // `<el attr={false}/>` becomes `<el/>`
        const booleanLiteral = t.isBooleanLiteral(staticValue) ? staticValue : undefined;
        if (booleanLiteral) {
          if (booleanLiteral.value === true) {
            results.template += `${needsSpacing ? " " : ""}${key}`;
            needsSpacing = true;
          }
          return;
        }

        // properties
        if (staticValue && ChildProperties.has(key)) {
          results.exprs.push(
            t.expressionStatement(
              setAttr(attribute, elem, key, staticValue as babelTypes.Expression, { tagName })
            )
          );
        } else {
          inlineAttributeOnTemplate(
            key,
            results,
            staticValue as babelTypes.StringLiteral | babelTypes.NumericLiteral | null
          );
        }
      }
    });
  if (!hasChildren && children) {
    path.node.children.push(children);
  }
  if (spreadExpr) results.exprs.push(...(Array.isArray(spreadExpr) ? spreadExpr : [spreadExpr]));

  results.hasHydratableEvent = results.hasHydratableEvent || hasHydratableEvent;
}

// Children that compile to `insert()` calls and contribute no markup of their
// own: dynamic expression containers, components, and spread children. Mirrors
// the `!child.id && child.exprs.length` count in transformChildren.
function countDynamicSlots(children: JSXChildPath[]): number {
  let count = 0;
  for (const child of children) {
    const node = child.node;
    if (
      t.isJSXText(node) ||
      (t.isJSXExpressionContainer(node) &&
        getStaticExpression(child as BabelPath<babelTypes.JSXExpressionContainer>) !== false) ||
      (t.isJSXElement(node) && !isComponent(getTagName(node)))
    )
      continue;
    count++;
  }
  return count;
}

function findLastElement(children: JSXChildPath[], hydratable?: boolean): number {
  let lastElement = -1,
    tagName;
  // Counterpart of transformChildren's per-slot markers: with two or more
  // dynamic slots under this parent (CSR only), a trailing dynamic child
  // appends a dedicated `<!>` placeholder to the template, so an earlier
  // element may not omit its closing tag — the still-open element would
  // swallow the placeholder as a child while the generated
  // firstChild/nextSibling walk expects it as a sibling.
  const perSlotMarkers = !hydratable && countDynamicSlots(children) > 1;
  for (let i = children.length - 1; i >= 0; i--) {
    const node = children[i].node;
    if (
      hydratable ||
      t.isJSXText(node) ||
      (t.isJSXExpressionContainer(node) &&
        getStaticExpression(children[i] as BabelPath<babelTypes.JSXExpressionContainer>) !==
          false) ||
      (t.isJSXElement(node) && (tagName = getTagName(node)) && !isComponent(tagName))
    ) {
      lastElement = i;
      break;
    }
    // This trailing dynamic slot will emit a per-slot placeholder after any
    // preceding element's markup: nothing here may omit its closing tag.
    if (perSlotMarkers) break;
  }
  return lastElement;
}

function transformChildren(
  path: BabelPath<babelTypes.JSXElement>,
  results: DOMTransformResult,
  config: DOMTransformInfo
): void {
  let tempPath = (results.id && results.id.name) || "",
    tagName = getTagName(path.node),
    childPostExprs: babelTypes.Statement[] = [],
    i = 0;
  const filteredChildren = filterChildren(path.get("children")),
    lastElement = findLastElement(filteredChildren, config.hydratable),
    childNodes = filteredChildren.reduce(
      (memo: TransformResult[], child: JSXChildPath, index: number) => {
        if (child.isJSXFragment()) {
          throw new Error(
            `Fragments can only be used top level in JSX. Not used under a <${tagName}>.`
          );
        }
        const transformed = transformNode(child, {
          toBeClosed: results.toBeClosed,
          lastElement: index === lastElement,
          skipId: !results.id || !detectExpressions(filteredChildren, index, config)
        });
        if (!transformed) return memo;
        (transformed as TransformResult & { allocatesIds?: boolean }).allocatesIds =
          config.hydratable && canChildSlotAllocateIds(child);
        const i = memo.length;
        if (transformed.text && i && memo[i - 1].text) {
          memo[i - 1].template =
            `${memo[i - 1].template as string}${transformed.template as string}`;
          memo[i - 1].templateWithClosingTags +=
            transformed.templateWithClosingTags || (transformed.template as string);
        } else memo.push(transformed);
        return memo;
      },
      []
    );

  // Dynamic slots under this parent (children compiled to `insert()` calls).
  // With two or more, slots may not share an insertion marker: the marker is
  // also the runtime's ownership tag ($$SLOT), and adoption only re-tags when
  // the marker is truthy — shared or null markers let one slot's cleanup
  // destroy a node that migrated to its neighbor (solidjs/solid#2830).
  const dynamicSlots = childNodes.reduce((n, c) => (c && !c.id && c.exprs.length ? n + 1 : n), 0);

  childNodes.forEach((child, index) => {
    if (!child) return;
    if (child.tagName && child.renderer !== "dom") {
      throw new Error(`<${child.tagName}> is not supported in <${tagName}>.
      Wrap the usage with a component that would render this element, eg. Canvas`);
    }

    results.template += child.template as string;
    results.templateWithClosingTags += child.templateWithClosingTags || (child.template as string);
    results.isImportNode = results.isImportNode || child.isImportNode;
    results.isWrapped = results.isWrapped || child.isWrapped;

    if (child.id) {
      let walkExpr;
      if (config.hydratable && tagName === "html") {
        const getNextMatch = registerImportMethod(
          path,
          "getNextMatch",
          getRendererConfig(path, "dom").moduleName
        );
        const walk = t.memberExpression(
          t.identifier(tempPath),
          t.identifier(i === 0 ? "firstChild" : "nextSibling")
        );
        walkExpr = t.callExpression(getNextMatch, [walk, t.stringLiteral(child.tagName as string)]);
      } else if (config.dev && config.hydratable && child.tagName) {
        const helperName = i === 0 ? "getFirstChild" : "getNextSibling";
        const helper = registerImportMethod(
          path,
          helperName,
          getRendererConfig(path, "dom").moduleName
        );
        walkExpr = t.callExpression(helper, [
          t.identifier(tempPath),
          t.stringLiteral(child.tagName)
        ]);
      } else {
        walkExpr = t.memberExpression(
          t.identifier(tempPath),
          t.identifier(i === 0 ? "firstChild" : "nextSibling")
        );
      }
      results.declarations.push(t.variableDeclarator(child.id, walkExpr));
      results.declarations.push(...(child.declarations as babelTypes.VariableDeclarator[]));
      results.exprs.push(...(child.exprs as babelTypes.Statement[]));
      results.dynamics.push(...child.dynamics);
      childPostExprs.push(...(child.postExprs || []));
      results.hasHydratableEvent =
        results.hasHydratableEvent || (child as DOMTransformResult).hasHydratableEvent;
      results.isImportNode = results.isImportNode || child.isImportNode;
      results.isWrapped = results.isWrapped || child.isWrapped;
      tempPath = child.id.name;
      i++;
    } else if (child.exprs.length) {
      let insert = registerImportMethod(path, "insert", getRendererConfig(path, "dom").moduleName);
      const multi = checkLength(filteredChildren),
        markers = config.hydratable && multi,
        // CSR counterpart of the hydratable per-slot markers: when this parent
        // hosts multiple dynamic slots, each gets its own truthy marker — the
        // immediately following sibling when it has a reference, otherwise a
        // dedicated `<!>` placeholder.
        perSlot = !markers && dynamicSlots > 1;
      // Mirror of the ssr generate's `scope()` wrap: deferred holes that can
      // allocate hydration ids get their own owner scope (insert makes the
      // outer render effect non-transparent for tagged accessors). Keyed off
      // `dynamic` so both generates decide identically for the same source.
      if ((child as TransformResult & { allocatesIds?: boolean }).allocatesIds && child.dynamic) {
        let expr = child.exprs[0] as babelTypes.Expression;
        // The shared transform simplifies `{sig()}` to the bare getter `sig`;
        // rewrap so tagging the scope doesn't mutate the user's function.
        if (!t.isFunction(expr) && !(t.isCallExpression(expr) && t.isFunction(expr.callee))) {
          expr = t.arrowFunctionExpression([], t.callExpression(expr, []));
        }
        child.exprs[0] = t.callExpression(
          registerImportMethod(path, "scope", getRendererConfig(path, "dom").moduleName),
          [expr]
        );
      }
      // boxed by textNodes
      if (markers || perSlot || wrappedByText(childNodes, index)) {
        let exprId: babelTypes.Identifier | undefined;
        let contentId: babelTypes.Identifier | undefined;
        if (markers) tempPath = createPlaceholder(path, results, tempPath, i++, "$")[0].name;
        // Ride the immediately following sibling's reference when it exists —
        // unless the slot is boxed by text, where a placeholder is structurally
        // required to keep the surrounding template text nodes from merging.
        if (perSlot && !wrappedByText(childNodes, index)) {
          exprId = (childNodes[index + 1] && childNodes[index + 1].id) || undefined;
        }
        if (!exprId) {
          [exprId, contentId] = createPlaceholder(path, results, tempPath, i++, markers ? "/" : "");
          tempPath = exprId.name;
        }
        const args = contentId
          ? ([
              results.id!,
              child.exprs[0] as babelTypes.Expression,
              exprId,
              contentId
            ] as babelTypes.Expression[])
          : ([
              results.id!,
              child.exprs[0] as babelTypes.Expression,
              exprId
            ] as babelTypes.Expression[]);
        results.exprs.push(t.expressionStatement(t.callExpression(insert, args)));
      } else if (multi) {
        results.exprs.push(
          t.expressionStatement(
            t.callExpression(insert, [
              results.id!,
              child.exprs[0] as babelTypes.Expression,
              nextChild(childNodes, index) || t.nullLiteral()
            ])
          )
        );
      } else {
        results.exprs.push(
          t.expressionStatement(
            t.callExpression(insert, [results.id!, child.exprs[0] as babelTypes.Expression])
          )
        );
      }
    }
  });
  results.postExprs.unshift(...childPostExprs);
}

function createPlaceholder(
  path: BabelPath<babelTypes.JSXElement>,
  results: DOMTransformResult,
  tempPath: string,
  i: number,
  char: string
): [babelTypes.Identifier, babelTypes.Identifier | undefined] {
  const exprId = path.scope.generateUidIdentifier("el$"),
    config = getConfig(path);
  let contentId;
  results.template += `<!${char}>`;
  results.templateWithClosingTags += `<!${char}>`;
  if (config.hydratable && char === "/") {
    contentId = path.scope.generateUidIdentifier("co$");
    results.declarations.push(
      t.variableDeclarator(
        t.arrayPattern([exprId, contentId]),
        t.callExpression(
          registerImportMethod(path, "getNextMarker", getRendererConfig(path, "dom").moduleName),
          [t.memberExpression(t.identifier(tempPath), t.identifier("nextSibling"))]
        )
      )
    );
  } else
    results.declarations.push(
      t.variableDeclarator(
        exprId,
        t.memberExpression(
          t.identifier(tempPath),
          t.identifier(i === 0 ? "firstChild" : "nextSibling")
        )
      )
    );
  return [exprId, contentId];
}

function nextChild(children: TransformResult[], index: number): babelTypes.Identifier | undefined {
  return children[index + 1] && (children[index + 1].id || nextChild(children, index + 1));
}

// reduce unnecessary refs
function detectExpressions(
  children: JSXChildPath[],
  index: number,
  config: DOMTransformInfo
): boolean | undefined {
  if (children[index - 1]) {
    const node = children[index - 1].node;
    if (
      t.isJSXExpressionContainer(node) &&
      !t.isJSXEmptyExpression(node.expression) &&
      getStaticExpression(children[index - 1] as BabelPath<babelTypes.JSXExpressionContainer>) ===
        false
    )
      return true;
    let tagName;
    if (t.isJSXElement(node) && (tagName = getTagName(node)) && isComponent(tagName)) return true;
  }
  for (let i = index; i < children.length; i++) {
    const child = children[i].node;
    if (t.isJSXExpressionContainer(child)) {
      if (
        !t.isJSXEmptyExpression(child.expression) &&
        getStaticExpression(children[i] as BabelPath<babelTypes.JSXExpressionContainer>) === false
      )
        return true;
    } else if (t.isJSXElement(child)) {
      const tagName = getTagName(child);
      if (isComponent(tagName)) return true;
      if (
        config.contextToCustomElements &&
        (tagName === "slot" ||
          tagName.indexOf("-") > -1 ||
          child.openingElement.attributes.some(
            a => t.isJSXAttribute(a) && !t.isJSXNamespacedName(a.name) && a.name.name === "is"
          ))
      )
        return true;
      // claim targets (a[href] / form[action]) need an element reference
      // even when fully static — the emitted claimElement call walks to them
      if (isClaimTarget(child)) return true;
      if (
        child.openingElement.attributes.some(
          attr =>
            t.isJSXSpreadAttribute(attr) ||
            (t.isJSXIdentifier(attr.name) &&
              ["textContent", "innerHTML", "innerText"].includes(attr.name.name)) ||
            // inlineStyles: false rewrites every style value into an IIFE
            // expression, so even literal styles compile to dynamic
            // bindings that need an element reference.
            (!config.inlineStyles &&
              t.isJSXIdentifier(attr.name) &&
              attr.name.name === "style" &&
              (t.isStringLiteral(attr.value) ||
                (t.isJSXExpressionContainer(attr.value) &&
                  !t.isJSXEmptyExpression(attr.value.expression)))) ||
            (t.isJSXNamespacedName(attr.name) && attr.name.namespace.name === "prop") ||
            (t.isJSXExpressionContainer(attr.value) &&
              !(
                t.isStringLiteral(attr.value.expression) ||
                t.isNumericLiteral(attr.value.expression)
              ))
        )
      )
        return true;
      const nextChildren = filterChildren(children[i].get("children"));
      if (nextChildren.length)
        if (detectExpressions(nextChildren as JSXChildPath[], 0, config)) return true;
    }
  }
}

function contextToCustomElement(
  path: BabelPath<babelTypes.JSXElement>,
  results: DOMTransformResult
): void {
  if (!results.id) return;
  results.exprs.push(
    t.expressionStatement(
      t.assignmentExpression(
        "=",
        t.memberExpression(results.id, t.identifier("_$owner")),
        t.callExpression(
          registerImportMethod(path, "getOwner", getRendererConfig(path, "dom").moduleName),
          []
        )
      )
    )
  );
}

function processSpreads(
  path: BabelPath<babelTypes.JSXElement>,
  attributes: JSXAttributePath[],
  { elem, hasChildren }: SpreadOptions
): [JSXAttributePath[], babelTypes.ExpressionStatement] {
  const config = getConfig(path);
  const tagName = getTagName(path.node);

  // TODO: skip but collect the names of any properties after the last spread to not overwrite them
  const filteredAttributes: JSXAttributePath[] = [];
  const spreadArgs: babelTypes.Expression[] = [];
  let runningObject: Array<babelTypes.ObjectProperty | babelTypes.ObjectMethod> = [];
  let dynamicSpread = false;
  attributes.forEach(attribute => {
    const node = attribute.node;
    const key =
      !t.isJSXSpreadAttribute(node) &&
      (t.isJSXNamespacedName(node.name)
        ? `${node.name.namespace.name}:${node.name.name.name}`
        : node.name.name);
    if (t.isJSXSpreadAttribute(node)) {
      const isStatic =
        node.innerComments &&
        node.innerComments[0] &&
        node.innerComments[0].value.trim() === config.staticMarker;

      if (runningObject.length) {
        spreadArgs.push(t.objectExpression(runningObject));
        runningObject = [];
      }

      const s =
        isDynamic(attribute.get("argument"), {
          checkMember: true
        }) && (dynamicSpread = true)
          ? inlineCallExpression(node.argument)
          : node.argument;

      spreadArgs.push(isStatic ? t.objectExpression([t.spreadElement(s)]) : s);
    } else if (key && key !== "ref") {
      const value = node.value;
      const isContainer = t.isJSXExpressionContainer(value);
      const expression =
        isContainer && !t.isJSXEmptyExpression(value.expression) ? value.expression : undefined;
      const dynamic =
        isContainer && isDynamic(attribute.get("value").get("expression"), { checkMember: true });
      const normalized = isLockedDOMProperty(tagName, key) ? key.replace(/^prop:/, "") : key;
      if (dynamic) {
        const id = isLockedDOMProperty(tagName, key)
          ? t.identifier(normalized)
          : convertJSXIdentifier(node.name);

        // No condition memo here (unlike children/component props): attribute
        // values are primitives, assignProp dedupes writes against prevProps,
        // and the ssr generate emits the bare expression — a client-only memo
        // allocates a hydration id the server never did, drifting every id
        // after it (#2959).
        runningObject.push(
          t.objectMethod(
            "get",
            id,
            [],
            t.blockStatement([t.returnStatement(expression as babelTypes.Expression)]),
            !t.isValidIdentifier(normalized)
          )
        );
      } else {
        runningObject.push(
          t.objectProperty(
            t.stringLiteral(normalized),
            (isContainer
              ? expression
              : node.value || t.booleanLiteral(true)) as babelTypes.Expression
          )
        );
      }
    } else filteredAttributes.push(attribute);
  });

  if (runningObject.length) {
    spreadArgs.push(t.objectExpression(runningObject));
  }

  const props =
    spreadArgs.length === 1 && !dynamicSpread
      ? spreadArgs[0]
      : t.callExpression(registerImportMethod(path, "mergeProps"), spreadArgs);

  return [
    filteredAttributes,
    t.expressionStatement(
      t.callExpression(
        registerImportMethod(path, "spread", getRendererConfig(path, "dom").moduleName),
        [elem, props, t.booleanLiteral(hasChildren)]
      )
    )
  ];
}
