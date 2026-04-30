/**
 * Renderer-owned object value returned from Solid component trees.
 *
 * The concrete rendered value belongs to the active renderer or JSX factory
 * (`@solidjs/web`, `@solidjs/h`, custom renderers, etc.), so core does not
 * model DOM nodes or any other platform object here.
 */
export type RenderedElement = object & {
  readonly call?: never;
  readonly apply?: never;
  readonly bind?: never;
};

export type Element =
  | RenderedElement
  | ArrayElement
  | (string & {})
  | number
  | boolean
  | null
  | undefined;

export interface ArrayElement extends Array<Element> {}
