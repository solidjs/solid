export function template(html: string, isSVG?: boolean): Element;
export function wrap<T>(fn: (prev?: T) => T, init?: T): any;
export function wrapCondition(fn: () => any): () => any;
export function insert(
  parent: Element | Document | ShadowRoot | DocumentFragment,
  accessor: any,
  init?: any,
  marker?: Node
): any;
export function createComponent(
  Comp: (props: any) => any,
  props: any,
  dynamicKeys?: string[]
): any;
export function delegateEvents(eventNames: string[]): void;
export function clearDelegatedEvents(): void;
export function spread(
  node: Element,
  accessor: any,
  isSVG?: Boolean,
  skipChildren?: Boolean
): void;
export function classList(
  node: Element,
  value: { [k: string]: boolean },
  prev?: { [k: string]: boolean }
): void;
export function currentContext(): any;
export function renderToString(
  fn: (done?: () => void) => any,
  options?: {
    timeoutMs?: number;
  }
): Promise<string>;
export function hydrate(
  fn: () => unknown,
  node: Element | Document | ShadowRoot | DocumentFragment
): void;
export function getNextElement(
  template: HTMLTemplateElement,
  isSSR: boolean
): Node;
export function getNextMarker(start: Node): [Node, Array<Node>];
export function generateHydrationEventsScript(eventNames: string[]): string;
