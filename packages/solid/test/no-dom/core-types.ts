import type { Component, Element, ParentProps, ResolvedChildren } from "solid-js";
import { children, createSignal, Show } from "solid-js";

const [value] = createSignal(1);

const Primitive: Component = () => "ready";
const Parent: Component<ParentProps> = props => props.children;

children((): Element => ["a", 1, false, null]);

const resolved: ResolvedChildren = "child";

Show({
  when: value(),
  children: current => current(),
  fallback: resolved
});

void Primitive;
void Parent;
