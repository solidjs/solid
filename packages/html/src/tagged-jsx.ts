import {
  BOOLEAN_PROP,
  COMPONENT_NODE,
  ChildNode,
  ComponentNode,
  ELEMENT_NODE,
  EXPRESSION_NODE,
  EXPRESSION_PROP,
  ElementNode,
  ROOT_NODE,
  RootNode,
  SPREAD_PROP,
  STATIC_PROP,
  TEXT_NODE,
  parse
} from "./parse.js";
import { tokenize } from "./tokenize.js";
import {
  insert,
  spread,
  createComponent,
  mergeProps,
  claimElement,
  SVGElements,
  MathMLElements,
  VoidElements,
  RawTextElements,
  type JSX
} from "@solidjs/web";
import { ComponentRegistry, TaggedJSXInstance } from "./types.js";

const flat = (arr: any[]) => {
  return arr.length === 1 ? arr[0] : arr;
};

function createHtml() {
  const cache = new WeakMap<TemplateStringsArray, RootNode>();
  const rawTextElements = new Set(RawTextElements);
  rawTextElements.delete("template");

  // Walk over text, comment, and element nodes.
  const walker = document.createTreeWalker(document, 129);

  const createElement = (name: string) => {
    return SVGElements.has(name)
      ? document.createElementNS("http://www.w3.org/2000/svg", name)
      : MathMLElements.has(name)
        ? document.createElementNS("http://www.w3.org/1998/Math/MathML", name)
        : document.createElement(name);
  };

  // Internal: build a tagged JSX tag bound to a component registry.
  const createTaggedJSX = <T extends ComponentRegistry>(components: T): TaggedJSXInstance<T> => {
    const tag = (strings: TemplateStringsArray, ...values: any[]) => {
      const root = getCachedRoot(strings);

      return renderChildren(root, values, components);
    };
    tag.components = components;
    tag.jsx = tag;
    tag.define = <TNew extends ComponentRegistry>(newComponents: TNew) => {
      return createTaggedJSX({ ...components, ...newComponents });
    };

    return tag as TaggedJSXInstance<T>;
  };

  const getCachedRoot = (strings: TemplateStringsArray): RootNode => {
    let root = cache.get(strings);
    if (!root) {
      root = parse(tokenize(strings, rawTextElements), VoidElements);
      buildTemplate(root, false);
      cache.set(strings, root);
    }
    return root;
  };

  // Build template elements with the same shape as the parsed tree so both can be walked in sync.
  const buildTemplate = (node: RootNode | ChildNode, insideTemplate: boolean): void => {
    if (node.type === ELEMENT_NODE) {
      if (!insideTemplate) {
        const template = document.createElement("template");
        template.content.appendChild(buildNodes(node));
        node.template = template;
        insideTemplate = true;
      }
      node.children.forEach(child => buildTemplate(child, insideTemplate));
    } else if (node.type === COMPONENT_NODE || node.type === ROOT_NODE) {
      node.children.forEach(child => buildTemplate(child, false));
    } else if (node.type === TEXT_NODE && !insideTemplate) {
      textTemplate.innerHTML = node.value;
      node.value = textTemplate.content.textContent ?? "";
    }
  };

  const textTemplate = document.createElement("template");

  const buildNodes = (node: ChildNode): Node => {
    switch (node.type) {
      case TEXT_NODE:
        textTemplate.innerHTML = node.value;
        return document.createTextNode(textTemplate.content.textContent ?? "");
      case EXPRESSION_NODE:
        return document.createComment("+");
      case COMPONENT_NODE:
        return document.createComment(node.name as string);
      case ELEMENT_NODE:
        let hasSpread = false;

        const elem = createElement(node.name);
        // Element-claim contract (`a[href]`, `form[action]`): stamped here,
        // while static props are still visible — the filter below bakes them
        // into the template, after which the runtime can't tell a claim
        // target from any other element. Only the baked case needs a
        // clone-time claim; props that survive into runtime assignment are
        // claimed by `setAttribute`'s own recheck.
        const claimAttr = node.name === "a" ? "href" : node.name === "form" ? "action" : undefined;
        // Props located after spread need to be applied after spread for possible overrides.
        node.props = node.props.filter(prop => {
          if (prop.type === STATIC_PROP) {
            if (prop.name.startsWith("prop:")) return true;
            elem.setAttribute(prop.name, prop.value);
            if (!hasSpread && prop.name === claimAttr) node.claim = true;
            return hasSpread;
          } else if (prop.type === BOOLEAN_PROP) {
            elem.setAttribute(prop.name, "");
            if (!hasSpread && prop.name === claimAttr) node.claim = true;
            return hasSpread;
          } else if (prop.type === SPREAD_PROP) {
            hasSpread = true;
            return hasSpread;
          }
          return true;
        });
        const childRoot = node.name === "template" ? (elem as HTMLTemplateElement).content : elem;
        childRoot.append(...node.children.map(buildNodes));

        return elem;
    }
  };

  const renderNode = (node: ChildNode, values: any[], components: ComponentRegistry): any => {
    switch (node.type) {
      case TEXT_NODE:
        return node.value;
      case EXPRESSION_NODE:
        return values[node.value];
      case COMPONENT_NODE:
        const component = typeof node.name === "string" ? components[node.name] : values[node.name];
        if (component && typeof component === "function") {
          return createComponent(component, gatherProps(node, values, components));
        } else {
          throw new Error(`Component "${node.name}" not found in registry`);
        }
      case ELEMENT_NODE:
        const element = renderChildren(node, values, components) as Element;
        const props = gatherProps(node, values, components);

        spread(element, props, true);
        // Static href/action was baked into the template at build, so the
        // spread above never touched it — claim the clone directly.
        if (node.claim) claimElement(element);

        return element;
    }
  };

  const renderChildren = (
    node: RootNode | ComponentNode | ElementNode,
    values: any[],
    components: ComponentRegistry
  ): JSX.Element => {
    if (node.type !== ELEMENT_NODE || !node.template) {
      return flat(node.children.map(n => renderNode(n, values, components)));
    }

    const element = node.template.content.firstChild!.cloneNode(true) as Element;
    walker.currentNode = element;

    const walkNodes = (nodes: ChildNode[], walker: TreeWalker) => {
      for (const node of nodes) {
        if (
          node.type === ELEMENT_NODE ||
          node.type === EXPRESSION_NODE ||
          node.type === COMPONENT_NODE
        ) {
          const domNode = walker.nextNode()!;
          if (node.type === EXPRESSION_NODE || node.type === COMPONENT_NODE) {
            insert(domNode.parentNode!, renderNode(node, values, components), domNode);
            walker.currentNode = domNode;
          } else {
            if (node.props.length) {
              const props = gatherProps(node, values, components);
              spread(domNode as Element, props, true);
            }
            if (node.claim) claimElement(domNode as Element);
            walkNodes(
              node.children,
              node.name === "template"
                ? document.createTreeWalker((domNode as HTMLTemplateElement).content, 129)
                : walker
            );
          }
        }
      }
    };
    walkNodes(
      node.children,
      node.name === "template"
        ? document.createTreeWalker((element as HTMLTemplateElement).content, 129)
        : walker
    );
    return element;
  };

  const gatherProps = (
    node: ElementNode | ComponentNode,
    values: any[],
    components: ComponentRegistry,
    props: Record<string, any> = {}
  ) => {
    for (const prop of node.props) {
      switch (prop.type) {
        case BOOLEAN_PROP:
          props[prop.name] = true;
          break;
        case STATIC_PROP:
          props[prop.name] = prop.value;
          break;
        case EXPRESSION_PROP:
          applyGetter(props, prop.name, values[prop.value]);
          break;
        case SPREAD_PROP:
          const spreadValue = values[prop.value];
          if (!spreadValue || typeof spreadValue !== "object")
            throw new Error("Can only spread objects");
          props = mergeProps(props, spreadValue);
          break;
      }
    }

    // children - childNodes overwrites any props.children
    if (node.type === COMPONENT_NODE && node.children.length) {
      Object.defineProperty(props, "children", {
        get() {
          return renderChildren(node, values, components);
        }
      });
    }
    return props;
  };

  const applyGetter = (props: Record<string, any>, name: string, value: any) => {
    if (
      typeof value === "function" &&
      value.length === 0 &&
      name !== "ref" &&
      !name.startsWith("on")
    ) {
      Object.defineProperty(props, name, {
        get() {
          return value();
        },
        enumerable: true
      });
    } else {
      props[name] = value;
    }
  };

  return createTaggedJSX({});
}

const html = createHtml();
export default html;
export type { TaggedJSXInstance, ComponentRegistry, FunctionComponent } from "./types.js";
