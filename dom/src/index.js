import { createRuntime, createHyperScript } from 'babel-plugin-jsx-dom-expressions';
import S from 's-js';

function createHandler(className) {
  return (e, s) => e.classList.toggle(className, s);
}

function shallowDiff(a, b) {
  let sa = new Set(a), sb = new Set(b);
  return [a.filter(i => !sb.has(i)), (b.filter(i => !sa.has(i)))];
}

export const r = createRuntime({wrap: S.makeComputationNode, root: S.root, cleanup: S.cleanup, sample: S.sample});

export function selectWhen(signal, handler) {
  if (typeof handler === 'string') handler = createHandler(handler);
  let start, end;
  S.makeComputationNode(element => {
    const model = signal();
    if (element) {
      handler(element, false);
    }
    let marker = start;
    while(marker && marker !== end) {
      if (marker.model === model) {
        handler(marker, true);
        return marker;
      }
      marker = marker.nextSibling;
    }
  });
  return (s, e) => (start = s, end = e);
}

export function selectEach(signal, handler) {
  if (typeof handler === 'string') {
    handler = createHandler(handler);
  }
  let start, end;
  S.makeComputationNode(elements => {
    const models = signal(), newElements = [];
    let marker = start;
    while(marker && marker !== end) {
      if (models.indexOf(marker.model) > -1) {
        newElements.push(marker);
      }
      marker = marker.nextSibling;
    }
    const [additions, removals] = shallowDiff(newElements, elements);
    additions.forEach(el => handler(el, true));
    removals.forEach(el => handler(el, false));
    return newElements;
  });
  return (s, e) => (start = s, end = e);
}

export const h = createHyperScript(r);