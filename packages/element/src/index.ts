import {
  register,
  ComponentType as mComponentType,
  ICustomElement,
  FunctionComponent,
  ComponentOptions,
  PropsDefinitionInput
} from "component-register";
export { hot, getCurrentElement, noShadowDOM } from "component-register";
export type ComponentType<T> = mComponentType<T>;
import { createRoot, createSignal, runWithOwner } from "solid-js";
import { insert, registerDelegatedRoot, unregisterDelegatedRoot } from "@solidjs/web";

function createProps<T extends object>(raw: T) {
  const keys = Object.keys(raw) as (keyof T)[];
  const props = {};
  for (let i = 0; i < keys.length; i++) {
    const [get, set] = createSignal(() => raw[keys[i]]);
    Object.defineProperty(props, keys[i], {
      get,
      set(v) {
        set(() => v);
      }
    });
  }
  return props as T;
}

function lookupContext(el: ICustomElement & { _$owner?: any }) {
  if (el.assignedSlot && el.assignedSlot._$owner) return el.assignedSlot._$owner;
  let next: Element & { _$owner?: any } = el.parentNode;
  while (next) {
    if (next._$owner) return next._$owner;
    if (next.assignedSlot && (next.assignedSlot as Element & { _$owner?: any })._$owner)
      return (next.assignedSlot as Element & { _$owner?: any })._$owner;
    next = next.parentNode as Element;
  }
  return el._$owner;
}

function withSolid<T extends object>(ComponentType: ComponentType<T>): ComponentType<T> {
  return (rawProps: T, options: ComponentOptions) => {
    const { element } = options as {
      element: ICustomElement & { _$owner?: any };
    };
    const owner = lookupContext(element);
    let rootBodyStarted = false;
    function createComponent() {
      return createRoot((dispose: Function) => {
        rootBodyStarted = true;
        const props = createProps<T>(rawProps);
        element.addPropertyChangedCallback(
          (key: string, val: any) => (props[key as keyof T] = val)
        );
        element.addReleaseCallback(() => {
          unregisterDelegatedRoot(element.renderRoot as Node);
          (element.renderRoot as Node).textContent = "";
          dispose();
        });

        const comp = (ComponentType as FunctionComponent<T>)(props as T, options);
        registerDelegatedRoot(element.renderRoot as Node);
        return insert(element.renderRoot, comp);
      });
    }

    if (owner) {
      try {
        return runWithOwner(owner, createComponent);
      } catch (e) {
        // A throw before the root body ever ran can only be the owner
        // adoption itself failing: the looked-up `_$owner` was stamped by a
        // DIFFERENT copy of the Solid runtime (an element library bundling
        // its own solid-js embedded in a Solid host page — #3053), whose
        // owner layout this copy cannot link into. Context can't
        // meaningfully cross runtime copies anyway, so render in an
        // ownerless root instead of leaving the shadow root empty. Anything
        // thrown after the body started is a real component error — rethrow.
        if (rootBodyStarted) throw e;
        console.warn(
          `<${element.localName}>: found an _\$owner from a different copy of the Solid ` +
            "runtime (a second solid-js is on this page — likely bundled into a compiled " +
            "element library). Owners cannot be adopted across copies; rendering without " +
            "an owner. Context will not cross this boundary."
        );
        return createComponent();
      }
    }
    return createComponent();
  };
}

function customElement<T extends object>(
  tag: string,
  ComponentType: ComponentType<T>
): CustomElementConstructor;
function customElement<T extends object>(
  tag: string,
  props: PropsDefinitionInput<T>,
  ComponentType: ComponentType<T>
): CustomElementConstructor;
function customElement<T extends object>(
  tag: string,
  props: PropsDefinitionInput<T> | ComponentType<T>,
  ComponentType?: ComponentType<T>
): CustomElementConstructor {
  if (arguments.length === 2) {
    ComponentType = props as ComponentType<T>;
    props = {} as PropsDefinitionInput<T>;
  }
  return register<T>(tag, props as PropsDefinitionInput<T>)(withSolid(ComponentType!));
}

export { withSolid, customElement };
