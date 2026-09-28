"use server";
// The React demo's App.server.js: the application shell as a server
// component. It is static chrome with two client positions — the notes list
// and the route outlet — so its markup ships as HTML once at document SSR
// and is never refetched. Unlike the original demo, navigation does NOT
// re-render this tree: the list and the note are independent server
// components (their own boundaries) that refresh fine-grained while the
// shell stands still.
//
// The search field is NOT a client position either (the React demo's
// SearchField.client.js, and this file's `search` slot until Stage 6): its
// markup is server chrome like everything else, and the CLIENT contributes
// an ATTRIBUTE slot (principles §9.2.3) — one call, `props.search()`, returning
// the values and handlers this template reads at positions: the input's
// `value` and `onInput`, the form's `onSubmit`, the spinner's class and
// `aria-busy`. The client owns exactly those positions; the router state
// they track is the client's, so the reads are getters over it and each
// position updates on its own. One input needed a whole shipped component
// before; now it needs one small object — see searchField.ts.
//
// The New button is NOT a client position either: EditButton is a plain
// anchor, and the router intercepts every same-origin <a> at the document
// level, so server-rendered links SPA-navigate without shipping a component.
// (The React demo needed a client component here because its navigation was
// a context call — ours is just an href.)
import type { JSX } from "@solidjs/web";
import type { AttributeSlot } from "@solidjs/web/frames";
import EditButton from "~/components/EditButton";
import type { SearchBehavior } from "~/components/searchField";

export async function appView() {
  return (props: {
    search: AttributeSlot<{}, SearchBehavior>;
    noteList: JSX.Element;
    children: JSX.Element;
  }) => {
    const search = props.search();
    return (
      <div class="main">
        <section class="col sidebar">
          <section class="sidebar-header">
            <a href="/">
              <img
                class="logo"
                src="/logo.svg"
                width="22px"
                height="20px"
                alt=""
                role="presentation"
              />
            </a>
            <strong>Solid Notes</strong>
          </section>
          <section class="sidebar-menu" role="menubar">
            <form class="search" role="search" onSubmit={search.onSubmit}>
              <label class="offscreen" for="sidebar-search-input">
                Search for a note by title
              </label>
              <input
                id="sidebar-search-input"
                placeholder="Search"
                value={search.value}
                onInput={search.onInput}
              />
              <div
                class={{ spinner: true, "spinner--active": search.active }}
                role="progressbar"
                aria-busy={search.busy}
              />
            </form>
            <EditButton>New</EditButton>
          </section>
          <nav>{props.noteList}</nav>
        </section>
        <section class="col note-viewer">{props.children}</section>
      </div>
    );
  };
}
