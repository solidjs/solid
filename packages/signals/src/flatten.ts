import { NotReadyError } from "./core/index.js";

// CARVE 4: `flatten` lived in boundaries.ts but is the general children
// resolver the renderers (`web`, `universal`, `solid`'s `children()`) walk
// through — not a boundary feature. Moved verbatim so the boundary carve
// measures boundaries alone.

// A zero-argument function is a thunk the walk calls through.
const isThunk = (value: any): boolean => typeof value === "function" && !value.length;

function unwrap(value: any): any {
  do value = value();
  while (isThunk(value));
  return value;
}

// `skipNonRendered`: null, undefined, booleans and "" render nothing.
const skipped = (value: any, options?: { skipNonRendered?: boolean }): boolean | undefined =>
  options?.skipNonRendered && (value == null || value === true || value === false || value === "");

/**
 * Resolves nested accessors and arrays in a children tree to their rendered
 * values. See the `children()` helper in solid-js for the memoized form.
 */
export function flatten(
  children: any,
  options?: { skipNonRendered?: boolean; doNotUnwrap?: boolean }
): any {
  if (isThunk(children)) {
    if (options?.doNotUnwrap) return children;
    children = unwrap(children);
  }
  if (skipped(children, options)) return;

  if (Array.isArray(children)) {
    let results: any[] = [];
    if (flattenArray(children, results, options)) {
      return () => {
        let nested = [];
        flattenArray(results, nested, { ...options, doNotUnwrap: false });
        return nested;
      };
    }
    return results;
  }
  return children;
}

function flattenArray(
  children: Array<any>,
  results: any[] = [],
  options?: { skipNonRendered?: boolean; doNotUnwrap?: boolean }
): boolean {
  let notReady: NotReadyError | null = null;
  let needsUnwrap = false;
  for (let i = 0; i < children.length; i++) {
    try {
      let child = children[i];
      if (isThunk(child)) {
        if (options?.doNotUnwrap) {
          results.push(child);
          needsUnwrap = true;
          continue;
        }
        child = unwrap(child);
      }
      if (Array.isArray(child)) {
        // OR, don't overwrite: an accessor already pushed under doNotUnwrap
        // still needs the resolving wrapper even when a later sibling
        // fragment contains no functions (#3133).
        needsUnwrap = flattenArray(child, results, options) || needsUnwrap;
      } else if (!skipped(child, options)) results.push(child);
    } catch (e) {
      if (!(e instanceof NotReadyError)) throw e;
      notReady = e;
    }
  }
  if (notReady) throw notReady;
  return needsUnwrap;
}
