import { dynamicComponent, type Component } from "../src/index.js";

declare const Editor: Component<{ value: string }>;
declare const Viewer: Component<{ value: string }>;
declare const editing: () => boolean;

const Active = dynamicComponent(() => (editing() ? Editor : Viewer));
type ActiveProps = Parameters<typeof Active>[0];
const _value: ActiveProps["value"] = "x";
void _value;

dynamicComponent(() => (editing() ? Editor : undefined));
dynamicComponent(() => (editing() ? Editor : null));
dynamicComponent(() => Editor, { static: true });
dynamicComponent(() => Promise.resolve(Editor));

// @ts-expect-error a tag name is not a component
dynamicComponent(() => "input");
// @ts-expect-error a tag-name accessor is not a component
dynamicComponent(() => (editing() ? Editor : "input"));
