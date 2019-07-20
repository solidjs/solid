export * from './runtime';
import { createComponent, insert } from './runtime';
import { createRoot, createMemo, SuspenseContext, onCleanup, sample, map, useContext } from '../index';

const EQUAL = (a: any, b: any): boolean => a === b;

export function render(code: () => any, element: Node): () => void {
  let disposer: () => void;
  createRoot((dispose) => {
    disposer = dispose;
    insert(element, code());
  });
  return disposer!;
}

export function For<T, U>(props: {each: T[], fallback?: any, transform?: (fn: () => U[]) => () => U[], children: (item: T) => U }) {
  const mapped = map<T, U>(props.children, 'fallback' in props ? () => props.fallback : undefined)(() => props.each);
  return props.transform ? props.transform(mapped) : mapped;
}

export function Show(props: {when: boolean, fallback?: any, transform?: (fn: () => any) => () => any, children: any }) {
  const condition = createMemo(() => props.when, undefined, EQUAL),
    useFallback = 'fallback' in props,
    mapped = () => condition() ? sample(() => props.children) : useFallback && sample(() => props.fallback)
  return props.transform ? props.transform(mapped) : mapped;
}

type MatchProps = { when: boolean, children: any }
export function Switch(props: { fallback?: any, transform: (fn: () => any) => () => any, children: any }) {
  let conditions = props.children;
  Array.isArray(conditions) || (conditions = [conditions]);
  const useFallback = 'fallback' in props,
    evalConditions = createMemo(() => {
      for (let i = 0; i < conditions.length; i++) {
        if (conditions[i].when) return i;
      }
      return -1;
    }, undefined, EQUAL),
    mapped = () => {
      const index = evalConditions();
      return sample(() => index < 0 ? useFallback && props.fallback : conditions[index].children);
    };
  return props.transform ? props.transform(mapped) : mapped;
}

export function Match(props: MatchProps) { return props; }

export function Suspense(props: { delayMs?: number, fallback: any, children: any }) {
  return createComponent(SuspenseContext.Provide, { value: props.delayMs,  children: () => {
    const c = useContext(SuspenseContext),
      rendered = sample(() => props.children),
      marker = document.createTextNode(''),
      doc = document.implementation.createHTMLDocument();

    Object.defineProperty(doc.body, 'host', { get() { return marker && marker.parentNode } });

    return () => {
      const value = c.suspended();
      if (c.initializing) c.initializing = false;
      if (!value) return [marker, rendered];
      setTimeout(insert(doc.body, rendered));
      return [marker, props.fallback];
    }
  }}, ['children']);
}

export function Portal(props: {mount?: Node, useShadow: boolean, children: any}) {
  const { useShadow } = props,
    container =  document.createElement('div'),
    marker = document.createTextNode(''),
    mount = props.mount || document.body,
    renderRoot = (useShadow && container.attachShadow) ? container.attachShadow({ mode: 'open' }) : container;

  Object.defineProperty(container, 'host', { get() { return marker.parentNode; } });
  insert(renderRoot, sample(() => props.children));
  mount.appendChild(container);
  onCleanup(() => mount.removeChild(container));
  return marker;
}