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
import { createRoot, createSignal } from "solid-js";
import { insert } from "solid-js/web";

function createProps<T>(raw: T) {
  const keys = Object.keys(raw) as (keyof T)[];
  const props = {};
  for (let i = 0; i < keys.length; i++) {
    const [get, set] = createSignal(raw[keys[i]]);
    Object.defineProperty(props, keys[i], {
      get,
      set
    });
  }
  return props as T;
}

function withSolid<T>(ComponentType: ComponentType<T>): ComponentType<T> {
  return (rawProps: T, options: ComponentOptions) => {
    const { element } = options as {
      element: ICustomElement & { _$owner?: any };
    };
    return createRoot((dispose: Function) => {
      const props = createProps<T>(rawProps);

      element.addPropertyChangedCallback((key: string, val: any) => (props[key as keyof T] = val));
      element.addReleaseCallback(() => {
        element.renderRoot.textContent = "";
        dispose();
      });

      const comp = (ComponentType as FunctionComponent<T>)(props as T, options);
      return insert(element.renderRoot, comp);
    }, (element.assignedSlot && element.assignedSlot._$owner) || element._$owner);
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
