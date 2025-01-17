export function isUndefined(value: any): value is undefined {
  return typeof value === "undefined";
}

export function flatten(children: any, flags: { error?: any } = {}): any {
  try {
    while (typeof children === "function" && !children.length) children = children();
  } catch (err) {
    flags.error ??= err;
    return;
  }
  if (Array.isArray(children)) {
    const results: Array<any> = [];
    for (let i = 0; i < children.length; i++) {
      const result = flatten(children[i], flags);
      Array.isArray(result) ? results.push(...result) : results.push(result);
    }
    return results;
  }
  return children;
}
