import { Attributes, SVGAttributes, NonComposedEvents } from 'dom-expressions';
import { createEffect as wrap, sample as ignore, getContextOwner as currentContext, runtimeConfig as sharedConfig } from '../index.js';



const eventRegistry = new Set();
const config = sharedConfig;

export { wrap, currentContext };

export function template(html, isSVG) {
  const t = document.createElement('template');
  t.innerHTML = html;
  if (t.innerHTML !== html) console.warn(`Template html does not match input:\n${t.innerHTML}\n\n${html}`);
  let node = t.content.firstChild;
  if (isSVG) node = node.firstChild;
  return node;
}

export function createComponent(Comp, props, dynamicKeys) {
  if (dynamicKeys) {
    for (let i = 0; i < dynamicKeys.length; i++) dynamicProp(props, dynamicKeys[i]);
  }

  return ignore(() => Comp(props));
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

export function classList(node, value, prev) {
  const classKeys = Object.keys(value);
  for (let i = 0, len = classKeys.length; i < len; i++) {
    const key = classKeys[i],
      classValue = value[key],
      classNames = key.split(/\s+/);
    if (prev && prev[key] === classValue) continue;
    for (let j = 0, nameLen = classNames.length; j < nameLen; j++)
      node.classList.toggle(classNames[j], classValue);
  }
}

export function spread(node, accessor, isSVG, skipChildren) {
  if (typeof accessor === 'function') {
    wrap(current => spreadExpression(node, accessor(), current, isSVG, skipChildren));
  } else spreadExpression(node, accessor, undefined, isSVG, skipChildren);
}

export function insert(parent, accessor, marker, initial) {
  if (marker !== undefined && !initial) initial = [];
  if (typeof accessor !== 'function') return insertExpression(parent, accessor, initial, marker);
  wrap(current => insertExpression(parent, accessor(), current, marker), initial);
}

// SSR
export function renderToString(code, options = {}) {
  options = { timeoutMs: 30000, ...options }
  config.hydrate = { id: '', count: 0 };
  const container = document.createElement("div");
  document.body.appendChild(container);
  return new Promise((resolve, reject) => {
    setTimeout(() => reject("renderToString timed out"), options.timeoutMs);
    function render(rendered) {
      insert(container, rendered);
      resolve(container.innerHTML);
      document.body.removeChild(container);
    }
    !code.length ? render(code()) : code(render);
  });
}

export function hydrate(code, root) {
  config.hydrate = { id: '', count: 0, registry: new Map() };
  const templates = root.querySelectorAll(`*[_hk]`);
  for (let i = 0; i < templates.length; i++) {
    const node = templates[i];
    config.hydrate.registry.set(node.getAttribute('_hk'), node);
  }
  code();
  delete config.hydrate;
}

export function getNextElement(template, isSSR) {
  const hydrate = config.hydrate;
  let node, key;
  if (!hydrate || !hydrate.registry || !(node = hydrate.registry.get(key = `${hydrate.id}:${hydrate.count++}`))) {
    const el = template.cloneNode(true);
    if (isSSR && hydrate)
      el.setAttribute('_hk', `${hydrate.id}:${hydrate.count++}`);
    return el;
  }
  if (window && window._$HYDRATION) window._$HYDRATION.completed.add(key);
  return node;
}

export function getNextMarker(start) {
  let end = start,
    count = 0,
    current = [];
  if (config.hydrate && config.hydrate.registry) {
    while (end) {
      if (end.nodeType === 8) {
        const v = end.nodeValue;
        if (v === "#") count++;
        else if (v === "/") {
          if (count === 0) return [end, current];
          count--;
        }
      }
      current.push(end);
      end = end.nextSibling;
    }
  }
  return [end, current];
}

export function runHydrationEvents(id) {
  if (window && window._$HYDRATION) {
    const { completed, events } = window._$HYDRATION;
    while (events.length) {
      const [id, e] = events[0];
      if (!completed.has(id)) return;
      eventHandler(e);
      events.shift();
    }
  }
}

export function generateHydrationEventsScript(eventNames) {
  return `!function(){function t(t){const e=function t(e){return e&&(e.getAttribute("_hk")||t(e.host&&e.host instanceof Node?e.host:e.parentNode))}(t.composedPath&&t.composedPath()[0]||t.target);e&&!window._$HYDRATION.completed.has(e)&&window._$HYDRATION.events.push([e,t])}window._$HYDRATION={events:[],completed:new Set},["${eventNames.join(
    '","'
  )}"].forEach(e=>document.addEventListener(e,t))}();`;
}

// Internal Functions
function dynamicProp(props, key) {
  const src = props[key];
  Object.defineProperty(props, key, {
    get() { return src(); },
    enumerable: true
  });
}

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

function spreadExpression(node, props, prevProps = {}, isSVG, skipChildren) {
  let info;
  if (!skipChildren && "children" in props) {
    wrap(() =>
      (prevProps.children = insertExpression(
        node,
        props.children,
        prevProps.children
      ))
    );
  }
  wrap(() => {
    for (const prop in props) {
      if (prop === "children") continue;
      const value = props[prop];
      if (value === prevProps[prop]) continue;
      if (prop === "style") {
        Object.assign(node.style, value);
      } else if (prop === "classList") {
        classList(node, value, prevProps[prop]);
        // really only for forwarding from Components, can't forward normal ref
      } else if (prop === "ref" || prop === "forwardRef") {
        value(node);
      } else if (prop.slice(0, 2) === "on") {
        const lc = prop.toLowerCase();
        if (lc !== prop && !NonComposedEvents.has(lc.slice(2))) {
          const name = lc.slice(2);
          node[`__${name}`] = value;
          delegateEvents([name]);
        } else node[lc] = value;
      } else if (prop === "events") {
        for (const eventName in value)
          node.addEventListener(eventName, value[eventName]);
      } else if ((info = Attributes[prop])) {
        if (info.type === "attribute") {
          node.setAttribute(prop, value);
        } else node[info.alias] = value;
      } else if (isSVG) {
        if ((info = SVGAttributes[prop])) {
          if (info.alias) node.setAttribute(info.alias, value);
          else node.setAttribute(prop, value);
        } else
          node.setAttribute(
            prop.replace(/([A-Z])/g, g => `-${g[0].toLowerCase()}`),
            value
          );
      } else node[prop] = value;
      prevProps[prop] = value;
    }
  });
  return prevProps;
}

function normalizeIncomingArray(normalized, array, unwrap) {
  let dynamic = false;
  for (let i = 0, len = array.length; i < len; i++) {
    let item = array[i], t;
    if (item instanceof Node) {
      normalized.push(item);
    } else if (item == null || item === true || item === false) { // matches null, undefined, true or false
      // skip
    } else if (Array.isArray(item)) {
      dynamic = normalizeIncomingArray(normalized, item) || dynamic;
    } else if ((t = typeof item) === 'string') {
      normalized.push(document.createTextNode(item));
    } else if (t === 'function') {
      if (unwrap) {
        const idx = item();
        dynamic = normalizeIncomingArray(normalized, Array.isArray(idx) ? idx : [idx]) || dynamic;
      } else {
        normalized.push(item);
        dynamic = true;
      }
    } else normalized.push(document.createTextNode(item.toString()));
  }
  return dynamic;
}

function appendNodes(parent, array, marker) {
  for (let i = 0, len = array.length; i < len; i++) parent.insertBefore(array[i], marker);
}

function cleanChildren(parent, current, marker, replacement) {
  if (marker === undefined) return parent.textContent = '';
  const node = (replacement || document.createTextNode(''));
  if (current.length) {
    node !== current[0] && parent.replaceChild(node, current[0]);
    for (let i = current.length - 1; i > 0; i--) parent.removeChild(current[i]);
  } else parent.insertBefore(node, marker);
  return [node];
}

function insertExpression(parent, value, current, marker, unwrapArray) {
  while (typeof current === "function") current = current();
  if (value === current) return current;
  const t = typeof value,
    multi = marker !== undefined;
  parent = (multi && current[0] && current[0].parentNode) || parent;

  if (t === 'string' || t === 'number') {
    if (t === 'number') value = value.toString();
    if (multi) {
      let node = current[0];
      if (node && node.nodeType === 3) {
        node.data = value;
      } else node = document.createTextNode(value);
      current = cleanChildren(parent, current, marker, node)
    } else {
      if (current !== '' && typeof current === 'string') {
        current = parent.firstChild.data = value;
      } else current = parent.textContent = value;
    }
  } else if (value == null || t === 'boolean') {
    if (config.hydrate && config.hydrate.registry) return current;
    current = cleanChildren(parent, current, marker);
  } else if (t === 'function') {
    wrap(() => current = insertExpression(parent, value(), current, marker));
    return () => current;
  } else if (Array.isArray(value)) {
    const array = [];
    if (normalizeIncomingArray(array, value, unwrapArray)) {
      wrap(() => current = insertExpression(parent, array, current, marker, true));
      return () => current;
    };
    if (config.hydrate && config.hydrate.registry) return current;
    if (array.length === 0) {
      current = cleanChildren(parent, current, marker);
      if (multi) return current;
    } else {
      if (Array.isArray(current)) {
        if (current.length === 0) {
          appendNodes(parent, array, marker);
        } else reconcileArrays(parent, current, array);
      } else if (current == null || current === '') {
        appendNodes(parent, array);
      } else {
        reconcileArrays(parent, (multi && current) || [parent.firstChild], array);
      }
    }
    current = array;
  } else if (value instanceof Node) {
    if (Array.isArray(current)) {
      if (multi) return current = cleanChildren(parent, current, marker, value);
      cleanChildren(parent, current, null, value);
    } else if (current == null || current === '') {
      parent.appendChild(value);
    } else parent.replaceChild(value, parent.firstChild);
    current = value;
  }

  return current;
}

// Picked from
// https://github.com/adamhaile/surplus/blob/master/src/runtime/content.ts#L368
var NOMATCH = -1

// reconcile the content of parent from ns to us
// see ivi's excellent writeup of diffing arrays in a vdom library:
// https://github.com/ivijs/ivi/blob/2c81ead934b9128e092cc2a5ef2d3cabc73cb5dd/packages/ivi/src/vdom/implementation.ts#L1187
// this code isn't identical, since we're diffing real dom nodes to nodes-or-strings,
// but the core methodology of trimming ends and reversals, matching nodes, then using
// the longest increasing subsequence to minimize DOM ops is inspired by ivi.
function reconcileArrays(parent, ns, us) {
  var ulen = us.length,
    // n = nodes, u = updates
    // ranges defined by min and max indices
    nmin = 0,
    nmax = ns.length - 1,
    umin = 0,
    umax = ulen - 1,
    // start nodes of ranges
    n    = ns[nmin],
    u    = us[umin],
    // end nodes of ranges
    nx   = ns[nmax],
    ux   = us[umax],
    // node, if any, just after ux, used for doing .insertBefore() to put nodes at end
    ul   = nx.nextSibling,
    i, j, k,
    loop = true;

  // scan over common prefixes, suffixes, and simple reversals
  fixes: while (loop) {
    loop = false;

    // common prefix, u === n
    while (u === n) {
      umin++;
      nmin++;
      if (umin > umax || nmin > nmax) break fixes;
      u = us[umin];
      n = ns[nmin];
    }

    // common suffix, ux === nx
    while (ux === nx) {
      ul = nx;
      umax--;
      nmax--;
      if (umin > umax || nmin > nmax) break fixes;
      ux = us[umax];
      nx = ns[nmax];
    }

    // reversal u === nx, have to swap node forward
    while (u === nx) {
      loop = true;
      parent.insertBefore(nx, n);
      umin++;
      nmax--;
      if (umin > umax || nmin > nmax) break fixes;
      u = us[umin];
      nx = ns[nmax];
    }

    // reversal ux === n, have to swap node back
    while (ux === n) {
      loop = true;
      if (ul === null) parent.appendChild(n);
      else parent.insertBefore(n, ul);
      ul = n;
      umax--;
      nmin++;
      if (umin > umax || nmin > nmax) break fixes;
      ux = us[umax];
      n = ns[nmin];
    }
  }

  // if that covered all updates, just need to remove any remaining nodes and we're done
  if (umin > umax) {
    // remove any remaining nodes
    while (nmin <= nmax) {
      parent.removeChild(ns[nmax]);
      nmax--;
    }
    return;
  }

  // if that covered all current nodes, just need to insert any remaining updates and we're done
  if (nmin > nmax) {
    // insert any remaining nodes
    while (umin <= umax) {
      parent.insertBefore(us[umin], ul);
      umin++;
    }
    return;
  }

  // Positions for reusing nodes from current DOM state
  const P = new Array(umax - umin + 1),
    I = new Map();
  for(let i = umin; i <= umax; i++) {
    P[i] = NOMATCH;
    I.set(us[i], i);
  }

  let reusingNodes = umin + us.length - 1 - umax,
    toRemove = []

  for(let i = nmin; i <= nmax; i++) {
    if (I.has(ns[i])) {
      P[I.get(ns[i])] = i
      reusingNodes++
    } else toRemove.push(i)
  }

  // Fast path for full replace
  if (reusingNodes === 0) {
    if (n !== parent.firstChild || nx !== parent.lastChild) {
      for (i = nmin; i <= nmax; i++) parent.removeChild(ns[i]);
      while (umin <= umax) {
        parent.insertBefore(us[umin], ul);
        umin++
      }
      return;
    }
    // no nodes preserved, use fast clear and append
    parent.textContent = '';
    while (umin <= umax) {
      parent.appendChild(us[umin]);
      umin++;
    }
    return;
  }

  // find longest common sequence between ns and us, represented as the indices
  // of the longest increasing subsequence in src
  var lcs = longestPositiveIncreasingSubsequence(P, umin),
    nodes = [],
    tmp = ns[nmin], lisIdx = lcs.length - 1, tmpB;;

  // Collect nodes to work with them
  for(let i = nmin; i <= nmax; i++) {
    nodes[i] = tmp;
    tmp = tmp.nextSibling;
  }

  for(let i = 0; i < toRemove.length; i++) parent.removeChild(nodes[toRemove[i]])

  for(let i = umax; i >= umin; i--) {
    if(lcs[lisIdx] === i) {
      ul = nodes[P[lcs[lisIdx]]]
      lisIdx--
    } else {
      tmpB = (P[i] === NOMATCH) ? us[i] : nodes[P[i]];
      parent.insertBefore(tmpB, ul)
      ul = tmpB
    }
  }
}

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
  var lo = -1,
    hi = seq.length;

  // fast path for simple increasing sequences
  if (hi > 0 && seq[hi - 1] <= n) return hi - 1;

  while (hi - lo > 1) {
    var mid = Math.floor((lo + hi) / 2);
    if (seq[mid] > n) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  return lo;
}