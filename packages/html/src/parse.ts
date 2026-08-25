import {
  STRING_TOKEN,
  CLOSE_TAG_TOKEN,
  EQUALS_TOKEN,
  EXPRESSION_TOKEN,
  IDENTIFIER_TOKEN,
  OPEN_TAG_TOKEN,
  SLASH_TOKEN,
  SPREAD_TOKEN,
  TEXT_TOKEN,
  Token
} from "./tokenize.js";

const isComponentNode = (name: string): boolean => {
  const char = name.charCodeAt(0);
  return (
    char >= 65 && char <= 90 // Uppercase A-Z
  );
};

// Node type constants
export const ROOT_NODE = 0;
export const ELEMENT_NODE = 1;
export const COMPONENT_NODE = 2;
export const TEXT_NODE = 3;
export const EXPRESSION_NODE = 4;

// Prop type constants
export const BOOLEAN_PROP = 0;
export const STATIC_PROP = 1;
export const EXPRESSION_PROP = 2;
export const SPREAD_PROP = 3;

export type NodeType =
  | typeof ROOT_NODE
  | typeof ELEMENT_NODE
  | typeof COMPONENT_NODE
  | typeof TEXT_NODE
  | typeof EXPRESSION_NODE;
export type PropType =
  | typeof BOOLEAN_PROP
  | typeof STATIC_PROP
  | typeof EXPRESSION_PROP
  | typeof SPREAD_PROP;

export type ChildNode = ElementNode | TextNode | ExpressionNode | ComponentNode;

export interface RootNode {
  type: typeof ROOT_NODE;
  children: ChildNode[];
}

export interface ElementNode {
  type: typeof ELEMENT_NODE;
  name: string;
  props: PropNode[];
  children: ChildNode[];
  template?: HTMLTemplateElement;
  /**
   * Element-claim contract target (`a[href]`, `form[action]`, or a spread
   * that may carry those). Stamped at template build — before static props
   * are filtered out — so clones can be claimed even when the attribute was
   * baked into the template.
   */
  claim?: boolean;
}

export interface ComponentNode {
  type: typeof COMPONENT_NODE;
  name: string | number;
  props: PropNode[];
  children: ChildNode[];
}

export interface TextNode {
  type: typeof TEXT_NODE;
  value: string;
}

export interface ExpressionNode {
  type: typeof EXPRESSION_NODE;
  value: number;
}

export interface BooleanProp {
  name: string;
  type: typeof BOOLEAN_PROP;
  value: boolean;
}

export interface StringProp {
  name: string;
  type: typeof STATIC_PROP;
  value: string;
  quote?: "'" | '"';
}

export interface ExpressionProp {
  name: string;
  type: typeof EXPRESSION_PROP;
  value: number;
}

export interface SpreadProp {
  type: typeof SPREAD_PROP;
  value: number;
}

export type PropNode = BooleanProp | StringProp | ExpressionProp | SpreadProp;

export const parse = (tokens: Token[], voidElements: Set<string>): RootNode => {
  const root: RootNode = { type: ROOT_NODE, children: [] };
  const stack: (RootNode | ElementNode | ComponentNode)[] = [root];
  let pos = 0;
  const len = tokens.length;

  while (pos < len) {
    const token = tokens[pos];
    const parent = stack[stack.length - 1];

    switch (token.type) {
      case TEXT_TOKEN: {
        // --- TEXT ---
        const value = token.value;
        if (value.trim() === "") {
          const prevType = tokens[pos - 1]?.type;
          const nextType = tokens[pos + 1]?.type;
          // Filter out empty text nodes between tags
          if (prevType === CLOSE_TAG_TOKEN || nextType === OPEN_TAG_TOKEN) {
            pos++;
            continue;
          }
        }
        parent.children.push({ type: TEXT_NODE, value });
        pos++;
        continue;
      }

      case EXPRESSION_TOKEN: {
        // --- EXPRESSION ---
        parent.children.push({ type: EXPRESSION_NODE, value: token.value });
        pos++;
        continue;
      }

      case OPEN_TAG_TOKEN: {
        // --- TAG ---
        const nextToken = tokens[++pos];

        // Handle Closing Tag: </name>
        if (nextToken.type === SLASH_TOKEN) {
          const nameToken = tokens[++pos];
          const closeToken = tokens[++pos];
          const currentParent = stack[stack.length - 1] as ElementNode | ComponentNode;
          if (
            stack.length > 1 &&
            closeToken.type === CLOSE_TAG_TOKEN &&
            ((nameToken?.type === IDENTIFIER_TOKEN && currentParent.name === nameToken.value) ||
              ((nameToken?.type === EXPRESSION_TOKEN || nameToken.type === SLASH_TOKEN) &&
                typeof currentParent.name === "number"))
          ) {
            const node = stack.pop();
            if (node?.type === ELEMENT_NODE && voidElements.has(node.name)) {
              node.children = [];
            }
            pos++;
            continue;
          }
          throw new Error(`Mismatched closing tag for <${currentParent.name}>`);
        }

        // Handle Opening Tag: <name ...>
        if (nextToken.type === IDENTIFIER_TOKEN || nextToken.type === EXPRESSION_TOKEN) {
          const tagName = nextToken.value;
          const node: ElementNode | ComponentNode = {
            type:
              typeof tagName === "number" || isComponentNode(tagName)
                ? COMPONENT_NODE
                : ELEMENT_NODE,
            name: tagName,
            props: [],
            children: []
          } as ElementNode | ComponentNode;
          parent.children.push(node);
          pos++; // Consume tag name

          // --- Attribute Parsing Loop ---
          while (pos < len) {
            const attrToken = tokens[pos];
            if (attrToken.type === CLOSE_TAG_TOKEN || attrToken.type === SLASH_TOKEN) {
              break; // End of attributes
            }

            if (attrToken.type === SPREAD_TOKEN) {
              const expr = tokens[pos + 1];
              if (expr?.type === EXPRESSION_TOKEN) {
                node.props.push({ type: SPREAD_PROP, value: expr.value });
                pos += 2; // Consume '...' and expression
              } else {
                throw new Error(
                  `Spread operator in <${node.name}> must be followed by an expression`
                );
              }
            } else if (attrToken.type === IDENTIFIER_TOKEN) {
              const name = attrToken.value;
              const next = tokens[pos + 1];

              if (next?.type === EQUALS_TOKEN) {
                pos += 2; // Consume name and '='
                const valToken = tokens[pos];
                if (valToken.type === EXPRESSION_TOKEN) {
                  node.props.push({ name, type: EXPRESSION_PROP, value: valToken.value });
                  pos++;
                } else if (valToken.type === STRING_TOKEN) {
                  const quote = valToken.quote;
                  node.props.push({
                    name,
                    value: valToken.value,
                    quote,
                    type: STATIC_PROP
                  } as StringProp);
                  pos++;
                } else {
                  throw new Error(
                    `Attribute value for "${name}" in <${node.name}> must be an expression or a string`
                  );
                }
              } else {
                // Boolean prop
                node.props.push({ type: BOOLEAN_PROP, name, value: true });
                pos++;
              }
            } else {
              throw new Error(`Invalid attribute in <${node.name}>`);
            }
          }

          // --- Tag Closing Logic ---
          const endToken = tokens[pos];
          if (endToken.type === SLASH_TOKEN) {
            // Self-closing: <div/>
            pos += 2; // Consume '/' and '>'
          } else if (endToken.type === CLOSE_TAG_TOKEN) {
            // Opening: <div>
            pos++; // Consume '>'
            stack.push(node);
          }
          continue;
        }
      }

      default:
        throw new Error(
          `Unexpected token: ${JSON.stringify(token)}  after <${(stack[stack.length - 1] as ElementNode | ComponentNode).name}>`
        );
    }
  }

  if (stack.length > 1) {
    throw new Error(`Unclosed tag for <${(stack[stack.length - 1] as ElementNode).name}>`);
  }

  return root;
};
