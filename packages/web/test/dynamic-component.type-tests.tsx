/** @jsxImportSource @solidjs/web */

// `dynamicComponent` is `dynamic` with the tag arm removed, and its SOURCE
// TYPE is the user's guard: a source that can answer with a tag name is a
// compile error here and fine on `dynamic`. A server component reference is
// typed as the server function's declared answer — a `Component<P>` (or
// `LiveSource<Component<P>>` for a `live` declaration, an intersection that
// is still a `Component<P>`) — so it needs no special case in the union.
import { dynamic, dynamicComponent } from "@solidjs/web";
import type { LiveSource } from "@solidjs/web/server-functions/client";
import type { Component, Element as SolidElement } from "solid-js";

declare const Editor: Component<{ value: string }>;
declare const Viewer: Component<{ value: string }>;
declare const editing: () => boolean;
declare const tag: () => "input" | "textarea";

// A server function answering with a server component: on the client its
// call is a promise of the component; a `live` declaration's call is the
// branded iterable, typed as the component itself.
declare function getStory(
  id: number
): Promise<Component<{ comment: (p: { cid: number; children?: SolidElement }) => SolidElement }>>;
declare function feed(room: string): LiveSource<Component<{ compose: () => SolidElement }>>;

// --- dynamicComponent: components only -----------------------------------

const Active = dynamicComponent(() => (editing() ? Editor : Viewer));
<Active value="x" />;
// @ts-expect-error props are the resolved component's
<Active value={1} />;

const Story = dynamicComponent(() => getStory(1));
<Story comment={p => <b>{p.cid}</b>} />;
// @ts-expect-error the slot's props are the server component's
<Story comment={(p: { nope: string }) => p.nope} />;

const Feed = dynamicComponent(() => feed("room"));
<Feed compose={() => <input />} />;

dynamicComponent(() => (editing() ? Editor : undefined));
dynamicComponent(() => (editing() ? Editor : null));
dynamicComponent(() => editing() && Editor);
dynamicComponent(() => Editor, { static: true });
dynamicComponent(() => getStory(1), { deferStream: true });

// A tag name is not a component — use `dynamic` for one.
// @ts-expect-error a tag name
dynamicComponent(() => "input");
// @ts-expect-error a tag name from a union
dynamicComponent(() => tag());
// @ts-expect-error a promise of a tag name
dynamicComponent(() => Promise.resolve("input" as const));
// @ts-expect-error a source that MAY answer with a tag name
dynamicComponent(() => (editing() ? Editor : "input"));
// @ts-expect-error an arbitrary string
dynamicComponent(() => "my-element" as string);

// --- dynamic: the full contract, unchanged --------------------------------

dynamic(() => "input");
dynamic(() => tag());
dynamic(() => Promise.resolve("input" as const));
const Field = dynamic(() => (editing() ? Editor : "input"));
<Field value="x" />;
dynamic(() => getStory(1));
dynamic(() => feed("room"));
