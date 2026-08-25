import type { JSX } from "@solidjs/web";

export type FunctionComponent = (...args: any[]) => any;
/**
 * Component registry type
 * @example
 * ```tsx
 * const components: ComponentRegistry = {
 *   MyComponent: (props) => <div>Hello {props.name}</div>
 * }
 * ```
 */
export type ComponentRegistry = Record<string, FunctionComponent>;

/**
 * Tagged JSX instance type
 * @template T Component registry
 */
export type TaggedJSXInstance<T extends ComponentRegistry> = {
  /**
   * Tagged JSX template function
   * @example
   * ```tsx
   * const myTemplate = html`<div>Hello World</div>`
   * ```
   */
  (strings: TemplateStringsArray, ...values: any[]): JSX.Element;

  /**
   * Self reference to tagged JSX instance for tooling
   * @example
   * ```tsx
   * const MyComponent: FunctionComponent = (props) => {
   *   // Use html to create a template inside a component
   *   return myTaggedJSX.jsx`<div>Hello ${props.name}</div>`
   * ```
   */
  jsx: TaggedJSXInstance<T>;

  /**
   * Create a new tagged JSX instance with additional components added to the registry
   * @param components New components to add to the registry
   * @example
   * ```tsx
   * const MyComponent: FunctionComponent = (props) => <div>Hello {props.name}</div>
   * const myTaggedJSX = html.define({MyComponent})
   * const myTemplate = myTaggedJSX`<MyComponent name="World" />`
   * ```
   */
  define<TNew extends ComponentRegistry>(components: TNew): TaggedJSXInstance<T & TNew>;

  /**
   * Component registry
   */
  components: T;
};

type MountableElement = Element | Document | ShadowRoot | DocumentFragment | Node;

export interface Runtime {
  insert(parent: MountableElement, accessor: any, marker?: Node | null, init?: any): any;
  spread<T>(node: Element, accessor: (() => T) | T, skipChildren?: boolean): void;
  createComponent(Comp: (props: any) => any, props: any): any;
  mergeProps(...sources: unknown[]): any;
  claimElement<T extends Element>(node: T): T;
  SVGElements: Set<string>;
  VoidElements: Set<string>;
  RawTextElements: Set<string>;
  MathMLElements: Set<string>;
}
