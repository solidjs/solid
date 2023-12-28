import { createHyperScript } from "./hyperscript";
import {
  spread,
  assign,
  insert,
  createComponent,
  dynamicProperty,
  SVGElements
} from "solid-js/web";
import type { Component, JSX } from "solid-js";

export type MaybeFn<T> = T | (() => T);
export type MaybeArr<T> = T | T[];
export type Selector<T extends string> = `${T}#${string}` | `${T}.${string}`;
export type BareSelector = Selector<"">
export type MaybeSelector<T extends string> = T | Selector<T>;

export type MaybeFnProps<T extends object> = {
  [K in keyof T]: MaybeFn<T[K]>;
};

export interface SolidHyperScript {
  <K extends keyof JSX.IntrinsicElements, P extends MaybeFnProps<JSX.IntrinsicElements[K]>>(
    key: MaybeSelector<K>,
    props: MaybeFnProps<P>,
    ...children: MaybeArr<MaybeFn<JSX.Element>>[]
  ): () => MaybeArr<JSX.Element>;

  <K extends keyof JSX.IntrinsicElements, P extends MaybeFnProps<JSX.IntrinsicElements[K]>>(
    key: {} extends JSX.IntrinsicElements[K] ? MaybeSelector<K> : never, // Prevent skipping args if mandatory props present
    ...children: MaybeArr<MaybeFn<JSX.Element>>[]
  ): () => MaybeArr<JSX.Element>;

  <P extends MaybeFnProps<JSX.IntrinsicElements["div"]>>(
    key: BareSelector,
    props: MaybeFnProps<P>,
    ...children: MaybeArr<MaybeFn<JSX.Element>>[]
  ): () => MaybeArr<JSX.Element>;

  <P extends MaybeFnProps<JSX.IntrinsicElements["div"]>>(
    key: BareSelector,
    ...children: MaybeArr<MaybeFn<JSX.Element>>[]
  ): () => MaybeArr<JSX.Element>;

  <P extends object>(
    component: Component<P>,
    props: MaybeFnProps<P>,
    ...children: MaybeArr<MaybeFn<JSX.Element>>[]
  ): () => MaybeArr<JSX.Element>;

  <P extends object>(
    component: {} extends P ? Component<P> : never, // Prevent skipping args if mandatory props present
    ...children: MaybeArr<MaybeFn<JSX.Element>>[]
  ): () => MaybeArr<JSX.Element>;

  Fragment: (props: {
    children: (() => JSX.Element) | (() => JSX.Element)[];
  }) => MaybeArr<JSX.Element>;
}

const h = createHyperScript({
  spread,
  assign,
  insert,
  createComponent,
  dynamicProperty,
  SVGElements
}) as SolidHyperScript;

export default h;
