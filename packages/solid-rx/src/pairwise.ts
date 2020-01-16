export function pairwise<T>(): (v: () => T) => () => [T, T];
export function pairwise<T>(input: () => T): () => [T, T];
export function pairwise<T>(input?: any): any {
  return arguments.length === 0 ? pairwise : pairwise(input);

  function pairwise(input: () => T) {
    let prevValue: T;
    return () => {
      const value = input(),
        result = [prevValue, value];
      prevValue = value;
      return result;
    };
  }
}
