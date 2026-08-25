import { createRenderer } from "../src/universal.js";

const PROPERTIES = new Set(["className", "textContent"]);

function setProperty(node, name, value) {
  if (name === "style") Object.assign(node.style, value);
  else if (PROPERTIES.has(name)) node[name] = value == null ? "" : value;
  else if (value == null) node.removeAttribute(name);
  else node.setAttribute(name, value);
}

export const {
  render,
  effect,
  memo,
  createComponent,
  createElement,
  createTextNode,
  insertNode,
  insert,
  spread,
  setProp,
  mergeProps,
  applyRef,
  ref
} = createRenderer({
  createElement(string, staticProps) {
    const node = document.createElement(string);
    for (const name in staticProps) setProperty(node, name, staticProps[name]);
    return node;
  },
  createTextNode(value) {
    return document.createTextNode(value);
  },
  replaceText(textNode, value) {
    textNode.data = value;
  },
  setProperty,
  insertNode(parent, node, anchor) {
    parent.insertBefore(node, anchor);
  },
  isTextNode(node) {
    return node.type === 3;
  },
  removeNode(parent, node) {
    parent.removeChild(node);
  },
  getParentNode(node) {
    return node.parentNode;
  },
  getFirstChild(node) {
    return node.firstChild;
  },
  getNextSibling(node) {
    return node.nextSibling;
  }
});
