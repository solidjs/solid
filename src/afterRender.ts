import S from 's-js';

type DelegatableNode = Node & { model: any }
function createHandler(className: string) {
  return (e: HTMLElement, s: boolean) => e.classList.toggle(className, s);
}

function shallowDiff(a: HTMLElement[], b: HTMLElement[]) {
  let sa = new Set(a), sb = new Set(b);
  return [a.filter(i => !sb.has(i)), (b.filter(i => !sa.has(i)))];
}

export function selectWhen(signal: () => any, handler: string) : (s: Node, e: Node | null) => void
export function selectWhen(signal: () => any, handler: (element: HTMLElement, selected: boolean) => void) : (s: Node, e: Node | null) => void
export function selectWhen(signal: () => any, handler: any) : (s: Node, e: Node | null) => void {
  if (typeof handler === 'string') handler = createHandler(handler);
  let start: Node, end: Node | null;
  S.makeComputationNode((element?: HTMLElement) => {
    const model = signal();
    if (element) handler(element, false);
    let marker: Node | null = start;
    while(marker && marker !== end) {
      if ((marker as DelegatableNode).model === model) {
        handler(marker, true);
        return marker;
      }
      marker = marker.nextSibling;
    }
  });
  return (s, e) => (start = s, end = e);
}

export function selectEach(signal: () => any, handler: string) : (s: Node, e: Node | null) => void
export function selectEach(signal: () => any, handler: (element: HTMLElement, selected: boolean) => void) : (s: Node, e: Node | null) => void
export function selectEach(signal: () => any, handler: any) : (s: Node, e: Node | null) => void {
  if (typeof handler === 'string') handler = createHandler(handler);
  let start: Node, end: Node | null;
  S.makeComputationNode((elements: HTMLElement[] = []) => {
    const models = signal(), newElements = [];
    let marker: Node | null = start;
    while(marker && marker !== end) {
      if (models.indexOf((marker as DelegatableNode).model) > -1) newElements.push(marker as HTMLElement);
      marker = marker.nextSibling;
    }
    const [additions, removals] = shallowDiff(newElements, elements);
    additions.forEach(el => handler(el, true));
    removals.forEach(el => handler(el, false));
    return newElements;
  });
  return (s, e) => (start = s, end = e);
}