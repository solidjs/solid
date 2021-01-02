import {SetStateFunction, State, StateNode} from 'solid-js/types/reactive/state';

declare module 'solid-js' {
  export interface CreateComputed<T> {
    (fn: (v?: T) => T, value?: T): void;
  }

  export interface CreateEffect<T> {
    (fn: (v?: T) => T, value?: T): void;
  }

  export interface CreateMemo<T> {
    (fn: (v?: T) => T, value?: undefined,
     areEqual?: boolean|((prev: T, next: T) => boolean)): () => T;
  }

