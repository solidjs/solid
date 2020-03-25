import { Attributes, SVGAttributes, NonComposedEvents } from 'dom-expressions';
import { createEffect as wrap, sample as ignore, getContextOwner as currentContext, runtimeConfig as sharedConfig } from '../index.js';



const eventRegistry = new Set();
const config = sharedConfig;

export { wrap, currentContext };

export function template(html, check, isSVG) {
  const t = document.createElement('template');
  t.innerHTML = html;
  if (check && t.innerHTML.split("<").length - 1 !== check) console.warn(`Template html does not match input:\n${t.innerHTML}\n\n${html}`);
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
      classValue = !!value[key],
      classNames = key.split(/\s+/);
    if (!key || prev && prev[key] === classValue) continue;
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
      const data = node[`${key}Data`];
      data ? handler(data, e): handler(e);
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
      } else if (prop === "on") {
        for (const eventName in value)
          node.addEventListener(eventName, value[eventName]);
      } else if (prop === "onCapture") {
        for (const eventName in value)
          node.addEventListener(eventName, value[eventName], true);
      } else if (prop.slice(0, 2) === "on") {
        const lc = prop.toLowerCase();
        if (!NonComposedEvents.has(lc.slice(2))) {
          const name = lc.slice(2);
          if (Array.isArray(value)) {
            node[`__${name}`] = value[0];
            node[`__${name}Data`] = value[1];
          } else node[`__${name}`] = value;
          delegateEvents([name]);
        } else node[lc] = value;
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

/*
Slightly modified version of: https://github.com/WebReflection/udomdiff/blob/master/index.js
*/
function reconcileArrays(parentNode, a, b) {
  let bLength = b.length,
    aEnd = a.length,
    bEnd = bLength,
    aStart = 0,
    bStart = 0,
    after = a[aEnd - 1].nextSibling,
    map = null;

  while (aStart < aEnd || bStart < bEnd) {
    // append
    if (aEnd === aStart) {
      const node =
        bEnd < bLength
          ? bStart
            ? b[bStart - 1].nextSibling
            : b[bEnd - bStart]
          : after;

      while (bStart < bEnd) parentNode.insertBefore(b[bStart++], node);
    // remove
    } else if (bEnd === bStart) {
      while (aStart < aEnd) {
        if (!map || !map.has(a[aStart])) parentNode.removeChild(a[aStart]);
        aStart++;
      }
    // common prefix
    } else if (a[aStart] === b[bStart]) {
      aStart++;
      bStart++;
    // common suffix
    } else if (a[aEnd - 1] === b[bEnd - 1]) {
      aEnd--;
      bEnd--;
    // swap forward
    } else if (aEnd - aStart === 1 && bEnd - bStart === 1) {
      if (map && map.has(a[aStart])) {
        parentNode.insertBefore(b[bStart], bEnd < bLength ? b[bEnd] : after);
      } else parentNode.replaceChild(b[bStart], a[aStart]);
      break;
    // swap backward
    } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]) {
      const node = a[--aEnd].nextSibling;
      parentNode.insertBefore(b[bStart++], a[aStart++].nextSibling);
      parentNode.insertBefore(b[--bEnd], node);

      a[aEnd] = b[bEnd];
    // fallback to map
    } else {
      if (!map) {
        map = new Map();
        let i = bStart;

        while (i < bEnd) map.set(b[i], i++);
      }

      if (map.has(a[aStart])) {
        const index = map.get(a[aStart]);

        if (bStart < index && index < bEnd) {
          let i = aStart,
            sequence = 1;

          while (++i < aEnd && i < bEnd) {
            if (!map.has(a[i]) || map.get(a[i]) !== index + sequence) break;
            sequence++;
          }

          if (sequence > index - bStart) {
            const node = a[aStart];
            while (bStart < index) parentNode.insertBefore(b[bStart++], node);
          } else parentNode.replaceChild(b[bStart++], a[aStart++]);
        } else aStart++;
      } else parentNode.removeChild(a[aStart++]);
    }
  }

  return b;
}