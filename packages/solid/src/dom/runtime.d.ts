type MountableElement = Element | Document | ShadowRoot | DocumentFragment | Node;
export function render(code: () => any, element: MountableElement): () => void;
export function hydrate(fn: () => unknown, node: MountableElement): void;

export function template(html: string, count: number, isSVG?: boolean): Element;
export function effect<T>(fn: (prev?: T) => T, init?: T): any;
export function memo<T>(fn: () => T, equal: boolean): () => T;
export function insert(
  parent: MountableElement,
  accessor: any,
  marker?: Node | null,
  init?: any
): any;
export function createComponent(Comp: (props: any) => any, props: any): any;
export function delegateEvents(eventNames: string[]): void;
export function clearDelegatedEvents(): void;
export function spread(node: Element, accessor: any, isSVG?: Boolean, skipChildren?: Boolean): void;
export function assign(node: Element, props: any, isSVG?: Boolean, skipChildren?: Boolean): void;
export function setAttribute(node: Element, name: string, value: any): void;
export function setAttributeNS(node: Element, namespace: string, name: string, value: any): void;
export function classList(
  node: Element,
  value: { [k: string]: boolean },
  prev?: { [k: string]: boolean }
): void;
export function style(
  node: Element,
  value: { [k: string]: string },
  prev?: { [k: string]: string }
): void;
export function currentContext(): any;
export function dynamicProperty(props: any, key: string): any;
export function assignProps(target: any, ...sources: any): any

export function getHydrationKey(): string;
export function getNextElement(template: HTMLTemplateElement, isSSR: boolean): Node;
export function getNextMarker(start: Node): [Node, Array<Node>];
export function generateHydrationScript(options: { eventNames: string[], streaming: boolean }): string;

export function ssrClassList(value: { [k: string]: boolean }): string;
export function ssrStyle(value: { [k: string]: string }): string;
export function ssrSpread(accessor: any, isSVG: boolean, skipChildren: boolean): () => string;
export function escape(html: string): string;

declare type AttributeInfo = {
  [key: string]: {
    type: string;
    alias?: string;
  };
};
export const Attributes: AttributeInfo;
export const SVGAttributes: AttributeInfo;
export const NonComposedEvents: Set<string>;
export const SVGElements: Set<string>;
export const SVGNamespace: Record<string, string>;