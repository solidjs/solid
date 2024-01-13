/**
 * This function returns `a` if `b` is deeply equal.
 *
 * If not, it will replace any deeply equal children of `b` with those of `a`.
 * This can be used for structural sharing between JSON values for example.
 */
export function sharedClone<T>(prev: any, next: T, touchAll?: boolean): T {
  const things = new Map();

  function recurse(prev: any, next: any) {
    if (prev === next) {
      return prev;
    }

    if (things.has(next)) {
      return things.get(next);
    }

    const prevIsArray = Array.isArray(prev);
    const nextIsArray = Array.isArray(next);
    const prevIsObj = isPlainObject(prev);
    const nextIsObj = isPlainObject(next);

    const isArray = prevIsArray && nextIsArray;
    const isObj = prevIsObj && nextIsObj;

    const isSameStructure = isArray || isObj;

    // Both are arrays or objects
    if (isSameStructure) {
      const aSize = isArray ? prev.length : Object.keys(prev).length;
      const bItems = isArray ? next : Object.keys(next);
      const bSize = bItems.length;
      const copy: any = isArray ? [] : {};

      let equalItems = 0;

      for (let i = 0; i < bSize; i++) {
        const key = isArray ? i : bItems[i];
        if (copy[key] === prev[key]) {
          equalItems++;
        }
      }
      if (aSize === bSize && equalItems === aSize) {
        things.set(next, prev);
        return prev;
      }
      things.set(next, copy);
      for (let i = 0; i < bSize; i++) {
        const key = isArray ? i : bItems[i];
        if (typeof bItems[i] === 'function') {
          copy[key] = prev[key];
        } else {
          copy[key] = recurse(prev[key], next[key]);
        }
        if (copy[key] === prev[key]) {
          equalItems++;
        }
      }

      return copy;
    }

    if (nextIsArray) {
      const copy: any[] = [];
      things.set(next, copy);
      for (let i = 0; i < next.length; i++) {
        copy[i] = recurse(undefined, next[i]);
      }
      return copy as T;
    }

    if (nextIsObj) {
      const copy = {} as any;
      things.set(next, copy);
      const nextKeys = Object.keys(next);
      for (let i = 0; i < nextKeys.length; i++) {
        const key = nextKeys[i]!;
        copy[key] = recurse(undefined, next[key]);
      }
      return copy as T;
    }

    return next;
  }

  return recurse(prev, next);
}

// Copied from: https://github.com/jonschlinkert/is-plain-object
function isPlainObject(o: any) {
  if (!hasObjectPrototype(o)) {
    return false;
  }

  // If has modified constructor
  const ctor = o.constructor;
  if (typeof ctor === 'undefined') {
    return true;
  }

  // If has modified prototype
  const prot = ctor.prototype;
  if (!hasObjectPrototype(prot)) {
    return false;
  }

  // If constructor does not have an Object-specific method
  if (!prot.hasOwnProperty('isPrototypeOf')) {
    return false;
  }

  // Most likely a plain Object
  return true;
}

function hasObjectPrototype(o: any) {
  return Object.prototype.toString.call(o) === '[object Object]';
}
