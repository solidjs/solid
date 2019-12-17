import { createEffect } from "../index.js";

function createHandler(className: string) {
  return (e: Element, s: boolean) => e.classList.toggle(className, s);
}

export function walkDOM(depth: number = 1) {
  let stack: Element[] = [];
  return (node: Element | null) => {
    if (!node) {
      stack = [];
      return null;
    }
    if (depth > stack.length) {
      if (node.firstElementChild) {
        stack.push(node);
        node = node.firstElementChild;
      } else {
        let ns;
        while ((ns = node!.nextElementSibling) === null) {
          if (!(stack.length && (node = stack.pop()!))) return null;
        }
        node = ns;
      }
      return node;
    }
    return null;
  };
}

export function select<T>(
  signal: () => T,
  handler: string,
  iterator?: (node: Element | null) => Element | null
): (ref: Element) => void;
export function select<T>(
  signal: () => T,
  handler: (element: Element, selected: boolean) => void,
  iterator?: (node: Element | null) => Element | null
): (ref: Element) => void;
export function select<T>(
  signal: () => T,
  handler: any,
  iterator?: (node: Element | null) => Element | null
): (ref: Element) => void {
  if (typeof handler === "string") handler = createHandler(handler);
  return (ref: Element) => {
    createEffect<(Element & { model?: T }) | undefined>(element => {
      const model = signal();
      element && handler(element, false);
      let node: (Element & { model?: T }) | null = ref.firstElementChild;
      while (node) {
        if (node.model === model)
          return iterator && iterator(null), handler(node, true), node;
        node = (iterator && iterator(node)) || node!.nextElementSibling;
      }
    });
  };
}

export function selectAll<T>(
  signal: () => T[],
  handler: string,
  iterator?: (node: Element | null) => Element | null
): (ref: Element) => void;
export function selectAll<T>(
  signal: () => T[],
  handler: (element: Element, selected: boolean) => void,
  iterator?: (node: Element | null) => Element | null
): (ref: Element) => void;
export function selectAll<T>(
  signal: () => T[],
  handler: any,
  iterator?: (node: Element | null) => Element | null
): (ref: Element) => void {
  if (typeof handler === "string") handler = createHandler(handler);
  return (ref: Element) => {
    createEffect<Set<Element>>((elements = new Set<Element>()) => {
      const models = new Set(signal()),
        newElements = new Set<Element>();
      let node: (Element & { model?: T }) | null = ref.firstElementChild;
      while (node) {
        if (node.model && models.has(node.model)) newElements.add(node);
        node = (iterator && iterator(node)) || node!.nextElementSibling;
      }
      for (let removal of elements)
        !newElements.has(removal) && handler(removal, false);
      for (let addition of newElements)
        !elements.has(addition) && handler(addition, true);
      return newElements;
    });
  };
}
