import { createEffect, sample } from "../index.js";

function createHandler(className: string) {
  return (e: Element, s: boolean) => e.classList.toggle(className, s);
}

function shallowDiff(a: Element[], b: Element[]) {
  let sa = new Set(a),
    sb = new Set(b);
  return [a.filter(i => !sb.has(i)), b.filter(i => !sa.has(i))];
}

export function selectWhen<T>(
  signal: () => T,
  handler: string
): (s: () => Element[]) => () => Element[];
export function selectWhen<T>(
  signal: () => T,
  handler: (element: Element, selected: boolean) => void
): (s: () => Element[]) => () => Element[];
export function selectWhen<T>(
  signal: () => T,
  handler: any
): (s: () => Element[]) => () => Element[] {
  if (typeof handler === "string") handler = createHandler(handler);
  return (list: () => Element[]) => {
    createEffect<Element | undefined>(element => {
      const model = signal();
      if (element) handler(element, false);
      if (
        (element =
          model &&
          sample(list).find(
            (el: Element & { model?: T }) => el.model === model
          ))
      )
        handler(element, true);
      return element;
    });
    return list;
  };
}

export function selectEach<T>(
  signal: () => T[],
  handler: string
): (s: () => Element[]) => () => Element[];
export function selectEach<T>(
  signal: () => T[],
  handler: (element: Element, selected: boolean) => void
): (s: () => Element[]) => () => Element[];
export function selectEach<T>(
  signal: () => T[],
  handler: any
): (s: () => Element[]) => () => Element[] {
  if (typeof handler === "string") handler = createHandler(handler);
  return (list: () => Element[]) => {
    createEffect<Element[]>((elements = []) => {
      const models = signal(),
        newElements = sample(list).filter(
          (el: Element & { model?: T }) => models.indexOf(el.model!) > -1
        ),
        [additions, removals] = shallowDiff(newElements, elements!);
      additions.forEach(el => handler(el, true));
      removals.forEach(el => handler(el, false));
      return newElements;
    });
    return list;
  };
}
