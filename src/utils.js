import S from 's-js';

function comparer(v, k, b, isArray, path, r) {
  let ref, ref1;
  const newPath = path.concat([k]);
  if (isArray && !(((v != null ? v.id : void 0) && (v != null ? v.id : void 0) === ((ref = b[k]) != null ? ref.id : void 0)) || ((v != null ? v._id : void 0) && (v != null ? v._id : void 0) === ((ref1 = b[k]) != null ? ref1._id : void 0))) || !((v != null) && ((b != null ? b[k] : void 0) != null) && (v instanceof Object))) {
    return r.push(newPath.concat([v]));
  }
  return r.push.apply(r, diff(v, b[k], newPath));
}

function resolveAsync(value, fn) {
  if (!isObject(value)) return fn(value);
  if ('subscribe' in value) {
    const dispose = value.subscribe(fn);
    S.cleanup(function disposer() { dispose.unsubscribe(); });
    return;
  }
  if ('then' in value) {
    value.then(fn);
    return;
  }
  fn(value);
}

export function isObject(obj) {
  let ref;
  return obj !== null && ((ref = typeof obj) === 'object' || ref === 'function');
}

export function diff(a, b, path = []) {
  let i, k, l, len, v;
  const r = [];
  if (!isObject(a) || (b == null)) {
    if (a !== b) {
      r.push(path.concat([a]));
    }
  } else if (Array.isArray(a)) {
    for (k = i = 0, len = a.length; i < len; k = ++i) {
      v = a[k];
      if ((b != null ? b[k] : void 0) !== v) comparer(v, k, b, true, path, r);
    }
    if ((b != null ? b.length : void 0) > a.length) {
      l = a.length;
      while (l < b.length) {
        r.push(path.concat([l, void 0]));
        l++;
      }
    }
  } else {
    for (k in a) {
      v = a[k];
      if ((b != null ? b[k] : void 0) !== v)
        comparer(v, k, b, false, path, r);
    }
    for (k in b) {
      v = b[k];
      if (!(k in a))
        r.push(path.concat([k, void 0]));
    }
  }
  return r;
}

export function unwrap(item, deep) {
  let keys, result, unwrapped, v;
  if (result = item != null ? item._state : void 0) return result;

  if (!deep || !isObject(item) || (typeof item === 'function') || (item instanceof Element)) return item;

  keys = Object.keys(item);
  for (let i = 0, l = keys.length; i < l; i++) {
    v = item[keys[i]];
    if ((unwrapped = unwrap(v, true)) !== v) item[keys[i]] = unwrapped;
  }
  return item;
}

export function clone(v) {
  if (!isObject(v)) return v;

  if (Array.isArray(v)) return v.slice(0);

  return Object.assign({}, v);
}

export function select() {
  const mapFn1 = selection => () => {
    const unwrapped = unwrap(selection(), true),
      results = [];
    resolveAsync(unwrapped, (value) => {
      if (value === void 0) return;
      for (let key in value || {}) {
        results.push(diff(value[key], this._state[key], [key]));
      }
      this.replace([].concat(...results));
    });
  };

  const mapFn2 = (key, selector) => () => {
    const unwrapped = unwrap(selector(), true);
    resolveAsync(unwrapped, (value) => {
      if (value === void 0) return;
      this.replace(diff(value, this._state[key], [key]));
    });
  };

  for (let i = 0; i < arguments.length; i++) {
    const selection = arguments[i];
    if (typeof selection === 'function' || 'then' in selection || 'subscribe' in selection) {
      S.makeComputationNode(mapFn1(selection));
      continue;
    }
    for (let key in selection) {
      if (!(key in this)) this._defineProperty(key);
      S.makeComputationNode(mapFn2(key, selection[key]));
    }
  }
  return this;
}

