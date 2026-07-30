/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
// The React demo's SidebarNoteContent.client.js: the per-note client shell.
// `children` (the header) and `expandedChildren` (the excerpt) arrive as
// server markup through the slot; `id` and `title` ride as slot args. The
// flash animation fires when the title arg CHANGES on the same occurrence —
// entity identity across single-flight morphs, courtesy of the `$key` the
// server names each occurrence with.
import { useLocation } from "@solidjs/router";
import { createEffect, createSignal, Show } from "solid-js";
import type { JSX } from "@solidjs/web";

export default function SidebarNoteContent(props: {
  id: number;
  title: string;
  children: JSX.Element;
  expandedChildren: JSX.Element;
}) {
  const location = useLocation();
  const [isExpanded, setIsExpanded] = createSignal(false);
  const isActive = () => location.pathname.startsWith(`/notes/${props.id}`);
  let itemRef!: HTMLDivElement;

  let title = props.title;
  createEffect(
    () => props.title,
    newTitle => {
      if (newTitle !== title) {
        title = newTitle;
        itemRef.classList.add("flash");
      }
    }
  );

  return (
    <div
      ref={itemRef}
      onAnimationEnd={() => {
        itemRef.classList.remove("flash");
      }}
      style={{ color: "black" }}
      class={["sidebar-note-list-item", isExpanded() ? "note-expanded" : ""].join(" ")}
    >
      {props.children}
      <a
        href={`/notes/${props.id}`}
        class="sidebar-note-open"
        style={{
          "background-color": isActive() ? "var(--tertiary-blue)" : "",
          border: isActive() ? "1px solid var(--primary-border)" : "1px solid transparent"
        }}
      >
        Open note for preview
      </a>
      <button
        class="sidebar-note-toggle-expand"
        onClick={e => {
          e.stopPropagation();
          setIsExpanded(isExpanded => !isExpanded);
        }}
      >
        <Show
          when={isExpanded()}
          fallback={<img src="/chevron-down.svg" width="10px" height="10px" alt="Collapse" />}
        >
          <img src="/chevron-up.svg" width="10px" height="10px" alt="Expand" />
        </Show>
      </button>
      <div style={{ display: isExpanded() ? "block" : "none" }}>{props.expandedChildren}</div>
    </div>
  );
}
