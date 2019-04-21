import { setProperty, unwrap, isWrappable } from './state';

function applyState(target, parent, property, merge, key) {
  let previous = parent[property];
  if (target === previous) return;
  if (!isWrappable(target) || (previous == null)) {
    (target !== previous) && setProperty(parent, property, target);
    return;
  }

  if (Array.isArray(target)) {
    if (target.length && previous.length && (!merge || (key && target[0][key] != null))) {
      let i, j, start, end, newEnd, item, newIndicesNext, keyVal,
        temp = new Array(target.length),
        newIndices = new Map();
      // skip common prefix and suffix
      for (start = 0, end = Math.min(previous.length, target.length); start < end && (previous[start] === target[start] || key && previous[start][key] === target[start][key]); start++) {
        applyState(target[start], previous, start, merge, key);
      }
      for (end = previous.length - 1, newEnd = target.length - 1; end >= 0 && newEnd >= 0 && (previous[end] === target[newEnd] || key && previous[end][key] === target[newEnd][key]); end--, newEnd--) {
        temp[newEnd] = previous[end];
      }
      // prepare a map of all indices in target
      newIndicesNext = new Array(newEnd + 1);
      for (j = newEnd; j >= start; j--) {
        item = target[j];
        keyVal = key ? item[key] : item;
        i = newIndices.get(keyVal);
        newIndicesNext[j] = i === undefined ? -1 : i;
        newIndices.set(keyVal, j);
      }
      // step through all old items to check reuse
      for (i = start; i <= end; i++) {
        item = previous[i];
        keyVal = key ? item[key] : item;
        j = newIndices.get(keyVal);
        if (j !== undefined && j !== -1) {
          temp[j] = previous[i];
          j = newIndicesNext[j];
          newIndices.set(keyVal, j);
        }
      }
      // set all the new values
      for (j = start; j < target.length; j++) {
        if (temp.hasOwnProperty(j)) {
          setProperty(previous, j, temp[j]);
          applyState(target[j], previous, j, merge, key);
        }
        else setProperty(previous, j, target[j]);
      }
    } else {
      for (let i = 0, len = target.length; i < len; i++) {
        applyState(target[i], previous, i, merge, key);
      }
    }
    if (previous.length > target.length) setProperty(previous, 'length', target.length);
    return;
  }

  const targetKeys = Object.keys(target);
  for (let i = 0, len = targetKeys.length; i < len; i++) {
    applyState(target[targetKeys[i]], previous, targetKeys[i], merge, key);
  }
  const previousKeys = Object.keys(previous);
  for (let i = 0, len = previousKeys.length; i < len; i++) {
    if (target[previousKeys[i]] === undefined) setProperty(previous, previousKeys[i], undefined);
  }
}

// Diff method for setState
export function reconcile(path, options = {}) {
  let value;
  if (Array.isArray(path)) {
    value = path.pop();
  } else if (typeof path === 'object') {
    value = path;
    path = undefined;
  } else {
    path = Array.prototype.slice.call(arguments, 0, -1),
    value = arguments[arguments.length - 1];
    options = {};
  }
  const { merge, key = 'id' } = options as any;
  return state => {
    state = unwrap(state);
    if (path) {
      for (let i = 0; i < path.length - 1; i += 1) state = state[path[i]];
      applyState(value, state, path[path.length - 1], merge, key);
    } else applyState(value, { state }, 'state', merge, key);
  };
}