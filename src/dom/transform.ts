import { createEffect, sample, useContext, SuspenseContext } from "../index";

function createHandler(className: string) {
  return (e: HTMLElement, s: boolean) => e.classList.toggle(className, s);
}

function shallowDiff(a: HTMLElement[], b: HTMLElement[]) {
  let sa = new Set(a),
    sb = new Set(b);
  return [a.filter(i => !sb.has(i)), b.filter(i => !sa.has(i))];
}

export function selectWhen(
  signal: () => any,
  handler: string
): (s: () => any) => () => any;
export function selectWhen(
  signal: () => any,
  handler: (element: HTMLElement, selected: boolean) => void
): (s: () => any) => () => any;
export function selectWhen(
  signal: () => any,
  handler: any
): (s: () => any) => () => any {
  if (typeof handler === "string") handler = createHandler(handler);
  return list => {
    createEffect(element => {
      const model = signal();
      if (element) handler(element, false);
      if (
        (element =
          model && sample(list as () => any[]).find(el => el.model === model))
      )
        handler(element, true);
      return element;
    });
    return list;
  };
}

export function selectEach(
  signal: () => any,
  handler: string
): (s: () => any) => () => any;
export function selectEach(
  signal: () => any,
  handler: (element: HTMLElement, selected: boolean) => void
): (s: () => any) => () => any;
export function selectEach(
  signal: () => any,
  handler: any
): (s: () => any) => () => any {
  if (typeof handler === "string") handler = createHandler(handler);
  return list => {
    createEffect<HTMLElement[]>((elements = []) => {
      const models = signal(),
        newElements = sample(list as () => any[]).filter(
          el => models.indexOf(el.model) > -1
        ),
        [additions, removals] = shallowDiff(newElements, elements!);
      additions.forEach(el => handler(el, true));
      removals.forEach(el => handler(el, false));
      return newElements;
    });
    return list;
  };
}

export function awaitSuspense<T>(mapped: () => T) {
  const { state } = useContext(SuspenseContext);
  let cached: T;
  return () => (state() === "suspended" ? cached : (cached = mapped()));
}
