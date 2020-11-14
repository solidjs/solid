export const Aliases: Record<string, string>;
export const Properties: Set<string>;
export const ChildProperties: Set<string>;
export const NonComposedEvents: Set<string>;
export const SVGElements: Set<string>;
export const SVGNamespace: Record<string, string>;

type MountableElement = Element | Document | ShadowRoot | DocumentFragment | Node;
export function render(code: () => JSX.Element, element: MountableElement): () => void;
export function template(html: string, count: number, isSVG?: boolean): Element;
export function effect<T>(fn: (prev?: T) => T, init?: T): void;
export function memo<T>(fn: () => T, equal: boolean): () => T;
export function insert<T>(
  parent: MountableElement,
  accessor: (() => T) | T,
  marker?: Node | null,
  init?: JSX.Element
): JSX.Element;
export function createComponent<T>(Comp: (props: T) => JSX.Element, props: T): JSX.Element;
export function delegateEvents(eventNames: string[]): void;
export function clearDelegatedEvents(): void;
export function spread<T>(
  node: Element,
  accessor: (() => T) | T,
  isSVG?: Boolean,
  skipChildren?: Boolean
): void;
export function assign(node: Element, props: any, isSVG?: Boolean, skipChildren?: Boolean): void;
export function setAttribute(node: Element, name: string, value: string): void;
export function setAttributeNS(node: Element, namespace: string, name: string, value: string): void;
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
export function currentContext(): unknown;
export function dynamicProperty(props: unknown, key: string): unknown;
export function assignProps(target: unknown, ...sources: unknown[]): unknown;

export function hydrate(fn: () => JSX.Element, node: MountableElement): void;
export function getHydrationKey(): string;
export function getNextElement(template: HTMLTemplateElement, isSSR: boolean): Node;
export function getNextMarker(start: Node): [Node, Array<Node>];
