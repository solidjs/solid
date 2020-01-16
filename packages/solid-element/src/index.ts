import {
  register,
  ComponentType as mComponentType,
  ICustomElement,
  FunctionComponent,
  ComponentOptions,
  PropsDefinitionInput
} from "component-register";
export { hot, getCurrentElement } from "component-register";
export type ComponentType<T> = mComponentType<T>;
import { createRoot, createState } from "solid-js";
import { insert } from "solid-js/dom";

function withSolid<T>(ComponentType: ComponentType<T>): ComponentType<T> {
  return (rawProps: T, options: ComponentOptions) => {
    const { element } = options as {
      element: ICustomElement & { _context?: any };
    };
    return createRoot((dispose: Function) => {
      const [props, setProps] = createState<T>(rawProps);

      element.addPropertyChangedCallback((key: string, val: any) =>
        setProps({ [key]: val } as any)
      );
      element.addReleaseCallback(() => dispose());

      return insert(
        element.renderRoot(),
        (ComponentType as FunctionComponent<T>)(props as T, options)
      );
    }, (element.assignedSlot && element.assignedSlot._context) || element._context);
  };
}

function customElement<T>(
  tag: string,
  ComponentType: ComponentType<T>
): (ComponentType: ComponentType<T>) => any;
function customElement<T>(
  tag: string,
  props: PropsDefinitionInput<T>,
  ComponentType: ComponentType<T>
): (ComponentType: ComponentType<T>) => any;
function customElement<T>(
  tag: string,
  props: PropsDefinitionInput<T> | ComponentType<T>,
  ComponentType?: ComponentType<T>
): (ComponentType: ComponentType<T>) => any {
  if (arguments.length === 2) {
    ComponentType = props as ComponentType<T>;
    props = {} as PropsDefinitionInput<T>;
  }
  return register<T>(tag, props as PropsDefinitionInput<T>)(withSolid(ComponentType!));
}

export { withSolid, customElement };
