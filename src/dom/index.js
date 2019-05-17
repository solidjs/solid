import { Attributes } from 'dom-expressions';
import S from 's-js';

const wrap = S,
  root = S.root,
  sample = S.sample,
  cleanup = S.cleanup;

const GROUPING = '__rGroup',
  FORWARD = 'nextSibling',
  BACKWARD = 'previousSibling';
let groupCounter = 0;

export { wrap };

function normalizeIncomingArray(normalized, array) {
  for (let i = 0, len = array.length; i < len; i++) {
    let item = array[i];
    if (item instanceof Node) {
      if (item.nodeType === 11) {
        normalizeIncomingArray(normalized, item.childNodes)
      } else normalized.push(item);
    } else if (item == null || item === true || item === false) { // matches null, undefined, true or false
      // skip
    } else if (Array.isArray(item)) {
      normalizeIncomingArray(normalized, item);
    } else if (typeof item === 'string') {
      normalized.push(document.createTextNode(item));
    } else {
      normalized.push(document.createTextNode(item.toString()));
    }
  }
  return normalized;
}

function addNode(parent, node, afterNode, counter) {
  if (Array.isArray(node)) {
    if (!node.length) return;
    node = normalizeIncomingArray([], node);
    let mark = node[0];
    if (node.length !== 1) mark[GROUPING] = node[node.length - 1][GROUPING] = counter;
    for (let i = 0; i < node.length; i++)
      afterNode ? parent.insertBefore(node[i], afterNode) : parent.appendChild(node[i]);
    return mark;
  }
  let mark, t = typeof node;
  if (t === 'string' || t === 'number') node = document.createTextNode(node);
  else if (node.nodeType === 11 && (mark = node.firstChild) && mark !== node.lastChild) {
    mark[GROUPING] = node.lastChild[GROUPING] = counter;
  }

  afterNode ? parent.insertBefore(node, afterNode) : parent.appendChild(node);
  return mark || node;
}

function step(node, direction, inner) {
  const key = node[GROUPING];
  if (key) {
    node = node[direction];
    while(node && node[GROUPING] !== key) node = node[direction];
  }
  return inner ? node : node[direction];
}

function removeNodes(parent, node, end) {
  let tmp;
  while(node !== end) {
    tmp = node.nextSibling;
    parent.removeChild(node);
    node = tmp;
  }
}

function clearAll(parent, current, marker, startNode) {
  if (!marker) return parent.textContent = '';
  if (Array.isArray(current)) startNode = current[0];
  else if (current != null && current != '' && startNode === undefined) {
    startNode = step(marker.previousSibling, BACKWARD, true);
  }
  startNode && removeNodes(parent, startNode, marker);
  return '';
}

function insertExpression(parent, value, current, marker) {
  if (value === current) return current;
  parent = (marker && marker.parentNode) || parent;
  const t = typeof value;
  if (t === 'string' || t === 'number') {
    if (t === 'number') value = value.toString();
    if (marker) {
      if (value === '') clearAll(parent, current, marker)
      else if (current !== '' && typeof current === 'string') {
        marker.previousSibling.data = value;
      } else {
        const node = document.createTextNode(value);
        if (current !== '' && current != null) {
          parent.replaceChild(node, marker.previousSibling);
        } else parent.insertBefore(node, marker);
      }
      current = value;
    } else {
      if (current !== '' && typeof current === 'string') {
        current = parent.firstChild.data = value;
      } else current = parent.textContent = value;
    }
  } else if (value == null || t === 'boolean') {
    current = clearAll(parent, current, marker);
  } else if (t === 'function') {
    wrap(function() { current = insertExpression(parent, value(), current, marker); });
  } else if (value instanceof Node || Array.isArray(value)) {
    clearAll(parent, current, marker);
    addNode(parent, value, marker, ++groupCounter);
    current = value;
  } else {
    throw new Error("content must be Node, stringable, or array of same");
  }

  return current;
}

export function insert(parent, accessor, init, marker) {
  if (typeof accessor !== 'function') return insertExpression(parent, accessor, init, marker);
  wrap((current = init) => insertExpression(parent, accessor(), current, marker));
}

function dynamicProp(props, key) {
  const src = props[key];
  Object.defineProperty(props, key, {
    get() { return src(); },
    enumerable: true
  });
}

export function createComponent(Comp, props, dynamicKeys) {
  if (dynamicKeys) {
    for (let i = 0; i < dynamicKeys.length; i++) dynamicProp(props, dynamicKeys[i]);
  }
  return Comp(props);
}

const eventRegistry = new Set();
function lookup(el) {
  return el && (el.model || lookup(el.host || el.parentNode));
}

function eventHandler(e) {
  const key =  `__${e.type}`;
  let node = (e.composedPath && e.composedPath()[0]) || e.target;
  // reverse Shadow DOM retargetting
  if (e.target !== node) {
    Object.defineProperty(e, 'target', {
      configurable: true,
      value: node
    })
  }

  // simulate currentTarget
  Object.defineProperty(e, 'currentTarget', {
    configurable: true,
    get() { return node; }
  })

  while (node !== null) {
    const handler = node[key];
    if (handler) {
      const model = handler.length > 1 ? lookup(node): undefined;
      handler(e, model);
      if (e.cancelBubble) return;
    }
    node = (node.host && node.host instanceof Node) ? node.host : node.parentNode;
  }
}

export function delegateEvents(eventNames) {
  for (let i = 0, l = eventNames.length; i < l; i++) {
    const name = eventNames[i];
    if (!eventRegistry.has(name)) {
      eventRegistry.add(name);
      document.addEventListener(name, eventHandler);
    }
  }
}

export function clearDelegatedEvents() {
  for (let name of eventRegistry.keys()) document.removeEventListener(name, eventHandler);
  eventRegistry.clear();
}

export function classList(node, value) {
  const classKeys = Object.keys(value);
  for (let i = 0; i < classKeys.length; i++) {
    const key = classKeys[i],
      classNames = key.split(/\s+/);
    for (let j = 0; j < classNames.length; j++)
      node.classList.toggle(classNames[j], value[key]);
  }
}

function spreadExpression(node, props) {
  let info;
  for (const prop in props) {
    const value = props[prop];
    if (prop === 'style') {
      Object.assign(node.style, value);
    } else if (prop === 'classList') {
      classList(node, value);
    } else if (prop === 'events') {
      for (const eventName in value) node.addEventListener(eventName, value[eventName]);
    } else if (info = Attributes[prop]) {
      if (info.type === 'attribute') {
        node.setAttribute(prop, value)
      } else node[info.alias] = value;
    } else node[prop] = value;
  }
}

export function spread(node, accessor) {
  if (typeof accessor === 'function') {
    wrap(() => spreadExpression(node, accessor()));
  } else spreadExpression(node, accessor);
}

export function when(parent, accessor, expr, options, marker) {
  let beforeNode, current, disposable;
  const { afterRender, fallback } = options;

  if (marker) beforeNode = marker.previousSibling;
  cleanup(function dispose() { disposable && disposable(); });

  wrap(cached => {
    const value = accessor();
    if (value === cached) return cached;
    return sample(() => {
      parent = (marker && marker.parentNode) || parent;
      disposable && disposable();
      if (value == null || value === false) {
        clearAll(parent, current, marker, beforeNode ? beforeNode.nextSibling : parent.firstChild);
        current = null;
        afterRender && afterRender(current, marker);
        if (fallback) {
          root(disposer => {
            disposable = disposer;
            current = insertExpression(parent, fallback(), current, marker)
          });
        }
        return value;
      }
      root(disposer => {
        disposable = disposer;
        current = insertExpression(parent, expr(value), current, marker)
      });
      afterRender && afterRender(current, marker);
      return value;
    });
  });
}

function insertNodes(parent, node, end, target) {
  let tmp;
  while (node !== end) {
    tmp = node.nextSibling;
    parent.insertBefore(node, target);
    node = tmp;
  }
}

function cleanNode(disposables, node) {
  let disposable;
  (disposable = disposables.get(node)) && disposable();
  disposables.delete(node);
}

// Picked from
// https://github.com/adamhaile/surplus/blob/master/src/runtime/content.ts#L368

// return an array of the indices of ns that comprise the longest increasing subsequence within ns
function longestPositiveIncreasingSubsequence(ns, newStart) {
  let seq = [],
    is = [],
    l = -1,
    pre = new Array(ns.length);

  for (let i = newStart, len = ns.length; i < len; i++) {
    let n = ns[i];
    if (n < 0) continue;
    let j = findGreatestIndexLEQ(seq, n);
    if (j !== -1) pre[i] = is[j];
    if (j === l) {
      l++;
      seq[l] = n;
      is[l]  = i;
    } else if (n < seq[j + 1]) {
      seq[j + 1] = n;
      is[j + 1] = i;
    }
  }

  for (let i = is[l]; l >= 0; i = pre[i], l--) {
    seq[l] = i;
  }

  return seq;
}

function findGreatestIndexLEQ(seq, n) {
  // invariant: lo is guaranteed to be index of a value <= n, hi to be >
  // therefore, they actually start out of range: (-1, last + 1)
  let lo = -1,
    hi = seq.length;

  // fast path for simple increasing sequences
  if (hi > 0 && seq[hi - 1] <= n) return hi - 1;

  while (hi - lo > 1) {
    let mid = Math.floor((lo + hi) / 2);
    if (seq[mid] > n) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  return lo;
}

// This is almost straightforward implementation of reconcillation algorithm
// based on ivi documentation:
// https://github.com/localvoid/ivi/blob/2c81ead934b9128e092cc2a5ef2d3cabc73cb5dd/packages/ivi/src/vdom/implementation.ts#L1366
// With some fast paths from Surplus implementation:
// https://github.com/adamhaile/surplus/blob/master/src/runtime/content.ts#L86
// And working with data directly from Stage0:
// https://github.com/Freak613/stage0/blob/master/reconcile.js
// This implementation is tailored for fine grained change detection and adds support for fragments
export function each(parent, accessor, expr, options, afterNode) {
  let disposables = new Map(),
    isFallback = false,
    beforeNode = afterNode ? afterNode.previousSibling : null;
  const { afterRender, fallback } = options;

  function createFn(item, i, afterNode) {
    return root(disposer => {
      const node = addNode(parent, expr(item, i), afterNode, ++groupCounter);
      disposables.set(node, disposer);
      return node;
    });
  }

  function after() {
    afterRender && afterRender(
      beforeNode ? beforeNode.nextSibling : parent.firstChild, afterNode
    );
  }

  function disposeAll() {
    for (let i of disposables.keys()) disposables.get(i)();
    disposables.clear();
  }

  cleanup(disposeAll);
  wrap((renderedValues = []) => {
    const data = accessor() || [];
    return sample(() => {
      parent = (afterNode && afterNode.parentNode) || parent;
      const length = data.length;

      // Fast path for clear
      if (length === 0 || isFallback) {
        if (beforeNode || afterNode) {
          let node = beforeNode ? beforeNode.nextSibling : parent.firstChild;
          removeNodes(parent, node, afterNode === undefined ? null : afterNode);
        } else parent.textContent = "";
        disposeAll();
        if (length === 0) {
          after();
          if (fallback) {
            isFallback = true;
            root(disposer => {
              const node = addNode(parent, fallback(), afterNode, ++groupCounter);
              disposables.set(node, disposer);
            });
          }
          return [];
        } else isFallback = false;
      }

      // Fast path for create
      if (renderedValues.length === 0) {
        for (let i = 0; i < length; i++) createFn(data[i], i, afterNode);
        after();
        return data.slice(0);
      }

      let prevStart = 0,
        newStart = 0,
        loop = true,
        prevEnd = renderedValues.length-1, newEnd = length-1,
        a, b,
        prevStartNode = beforeNode ? beforeNode.nextSibling : parent.firstChild,
        newStartNode = prevStartNode,
        prevEndNode = afterNode ? afterNode.previousSibling : parent.lastChild,
        newAfterNode = afterNode;

      fixes: while(loop) {
        loop = false;
        let _node;

        // Skip prefix
        a = renderedValues[prevStart], b = data[newStart];
        while(a === b) {
          prevStart++;
          newStart++;
          newStartNode = prevStartNode = step(prevStartNode, FORWARD);
          if (prevEnd < prevStart || newEnd < newStart) break fixes;
          a = renderedValues[prevStart];
          b = data[newStart];
        }

        // Skip suffix
        a = renderedValues[prevEnd], b = data[newEnd];
        while(a === b) {
          prevEnd--;
          newEnd--;
          newAfterNode = step(prevEndNode, BACKWARD, true);
          prevEndNode = newAfterNode.previousSibling;
          if (prevEnd < prevStart || newEnd < newStart) break fixes;
          a = renderedValues[prevEnd];
          b = data[newEnd];
        }

        // Fast path to swap backward
        a = renderedValues[prevEnd], b = data[newStart];
        while(a === b) {
          loop = true;
          _node = step(prevEndNode, BACKWARD);
          let mark = _node.nextSibling;
          if (newStartNode !== mark) {
            insertNodes(parent, mark, prevEndNode.nextSibling, newStartNode)
            prevEndNode = _node;
          }
          newStart++;
          prevEnd--;
          if (prevEnd < prevStart || newEnd < newStart) break fixes;
          a = renderedValues[prevEnd];
          b = data[newStart];
        }

        // Fast path to swap forward
        a = renderedValues[prevStart], b = data[newEnd];
        while(a === b) {
          loop = true;
          _node = step(prevStartNode, FORWARD);
          if (prevStartNode !== newAfterNode) {
            let mark = _node.previousSibling;
            insertNodes(parent, prevStartNode, _node, newAfterNode);
            newAfterNode = mark;
            prevStartNode = _node;
          }
          prevStart++;
          newEnd--;
          if (prevEnd < prevStart || newEnd < newStart) break fixes;
          a = renderedValues[prevStart];
          b = data[newEnd];
        }
      }

      // Fast path for shrink
      if (newEnd < newStart) {
        if (prevStart <= prevEnd) {
          let next, node;
          while(prevStart <= prevEnd) {
            node = step(prevEndNode, BACKWARD, true);
            next = node.previousSibling;
            removeNodes(parent, node, prevEndNode.nextSibling);
            cleanNode(disposables, node);
            prevEndNode = next;
            prevEnd--;
          }
        }
        after();
        return data.slice(0);
      }

      // Fast path for add
      if (prevEnd < prevStart) {
        if (newStart <= newEnd) {
          while(newStart <= newEnd) {
            createFn(data[newStart], newStart, newAfterNode);
            newStart++;
          }
        }
        after();
        return data.slice(0);
      }

      // Positions for reusing nodes from current DOM state
      const P = new Array(newEnd + 1 - newStart);
      for(let i = newStart; i <= newEnd; i++) P[i] = -1;

      // Index to resolve position from current to new
      const I = new Map();
      for(let i = newStart; i <= newEnd; i++) I.set(data[i], i);

      let reusingNodes = 0, toRemove = [];
      for(let i = prevStart; i <= prevEnd; i++) {
        if (I.has(renderedValues[i])) {
          P[I.get(renderedValues[i])] = i;
          reusingNodes++;
        } else toRemove.push(i);
      }

      // Fast path for full replace
      if (reusingNodes === 0) {
        const doRemove = prevStartNode !== parent.firstChild || prevEndNode !== parent.lastChild;
        let node = prevStartNode, mark;
        newAfterNode = prevEndNode.nextSibling;
        while(node !== newAfterNode) {
          mark = step(node, FORWARD);
          cleanNode(disposables, node);
          doRemove && removeNodes(parent, node, mark);
          node = mark;
          prevStart++;
        }
        !doRemove && (parent.textContent = "");

        for(let i = newStart; i <= newEnd; i++) createFn(data[i], i, newAfterNode);
        after();
        return data.slice(0);
      }

      // What else?
      const longestSeq = longestPositiveIncreasingSubsequence(P, newStart),
        nodes= [];
      let tmpC = prevStartNode, lisIdx = longestSeq.length - 1, tmpD;

      // Collect nodes to work with them
      for(let i = prevStart; i <= prevEnd; i++) {
        nodes[i] = tmpC;
        tmpC = step(tmpC, FORWARD);
      }

      for(let i = 0; i < toRemove.length; i++) {
        let index = toRemove[i],
          node = nodes[index];
        removeNodes(parent, node, step(node, FORWARD));
        cleanNode(disposables, node);
      }

      for(let i = newEnd; i >= newStart; i--) {
        if(longestSeq[lisIdx] === i) {
          newAfterNode = nodes[P[longestSeq[lisIdx]]];
          lisIdx--;
        } else {
          if (P[i] === -1) {
            tmpD = createFn(data[i], i, newAfterNode);
          } else {
            tmpD = nodes[P[i]];
            insertNodes(parent, tmpD, step(tmpD, FORWARD), newAfterNode);
          }
          newAfterNode = tmpD;
        }
      }

      after();
      return data.slice(0);
    });
  });
}

export function suspend(parent, accessor, expr, options, marker) {
  let beforeNode, disposable, current, first = true;
  const { fallback } = options,
    doc = document.implementation.createHTMLDocument(),
    rendered = sample(expr);

  if (marker) beforeNode = marker.previousSibling;
  for (let name of eventRegistry.keys()) doc.addEventListener(name, eventHandler);
  Object.defineProperty(doc.body, 'host', { get() { return (marker && marker.parentNode) || parent; } });
  cleanup(function dispose() { disposable && disposable(); });

  wrap(cached => {
    const value = !!accessor();
    let node;
    if (value === cached) return cached;
    parent = (marker && marker.parentNode) || parent;
    if (value) {
      if (first) {
        insertExpression(doc.body, rendered);
        first = false;
      } else {
        node = beforeNode ? beforeNode.nextSibling : parent.firstChild;
        while (node && node !== marker) {
          const next = node.nextSibling;
          doc.body.appendChild(node);
          node = next;
        }
      }
      if (fallback) {
        sample(() => root(disposer => {
          disposable = disposer;
          current = insertExpression(parent, fallback(), null, marker)
        }));
      }
      return value;
    }
    if (first) {
      insertExpression(parent, rendered, null, marker);
      first = false;
    } else {
      if (disposable) {
        clearAll(parent, current, marker, beforeNode ? beforeNode.nextSibling : parent.firstChild);
        disposable();
      }
      while (node = doc.body.firstChild) parent.insertBefore(node, marker);
    }
    return value;
  });
}

export function portal(parent, accessor, expr, options, marker) {
  const { useShadow } = options,
    container =  document.createElement('div'),
    anchor = (accessor && sample(accessor)) || document.body,
    renderRoot = (useShadow && container.attachShadow) ? container.attachShadow({ mode: 'open' }) : container;
  Object.defineProperty(container, 'host', { get() { return (marker && marker.parentNode) || parent; } });
  const nodes = sample(() => expr(container));
  insertExpression(container, nodes);
  // ShadyDOM polyfill doesn't handle mutationObserver on shadowRoot properly
  if (container !== renderRoot) Promise.resolve().then(() => { while(container.firstChild) renderRoot.appendChild(container.firstChild); });
  anchor.appendChild(container);
  cleanup(() => anchor.removeChild(container));
}