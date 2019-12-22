import { createDependentEffect } from "solid-js";

const SymbolCopy = Symbol as any;
const $$observable = Symbol.observable || (SymbolCopy.observable = Symbol("observable"))

type ObservableObserver<T> = ((v: T) => void) | {
  next: (v: T) => void;
  error?: (v: any) => void;
  complete?: (v: boolean) => void;
};
export function observable<T>(input: () => T) {
  return {
    subscribe(observer: ObservableObserver<T>) {
      if (!(observer instanceof Object) || observer == null) {
        throw new TypeError("Expected the observer to be an object.");
      }
      const handler =  "next" in observer ? observer.next : observer;
      let complete = false;
      createDependentEffect(() => {
        if (complete) return;
        handler(input());
      }, input);
      return {
        unsubscribe() {
          complete = true;
        }
      };
    },
    [$$observable]() {
      return this;
    }
  };
}
