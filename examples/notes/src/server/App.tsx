"use server";
// The React demo's App.server.js: the application shell as a server
// component. It is static chrome with two client positions — the notes list
// and the route outlet — so its markup ships as HTML once at document SSR
// and is never refetched. Unlike the original demo, navigation does NOT
// re-render this tree: the list and the note are independent server
// components (their own boundaries) that refresh fine-grained while the
// shell stands still.
//
// The search field is NOT a client position anymore (the React demo's
// SearchField.client.js, and this file's `search` slot until Stage 6): its
// markup is server chrome like everything else, and the CLIENT contributes
// only behavior — `onInput` is an event prop resolved through the frame's
// live props at dispatch, and the two refs hand the client the input and
// spinner elements at adoption, where effects sync them against router
// state. One input needed a whole shipped component before; now it needs
// three functions.
//
// The New button is NOT a client position either: EditButton is a plain
// anchor, and the router intercepts every same-origin <a> at the document
// level, so server-rendered links SPA-navigate without shipping a component.
// (The React demo needed a client component here because its navigation was
// a context call — ours is just an href.)
import type { JSX } from "@solidjs/web";
import EditButton from "~/components/EditButton";

export async function appView() {
  return (props: {
    onSearch: (e: InputEvent) => void;
    onSubmit: (e: SubmitEvent) => void;
    searchInput: (el: HTMLInputElement) => void;
    spinner: (el: HTMLElement) => void;
    noteList: JSX.Element;
    children: JSX.Element;
  }) => (
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
          <form class="search" role="search" onSubmit={props.onSubmit}>
            <label class="offscreen" for="sidebar-search-input">
              Search for a note by title
            </label>
            <input
              id="sidebar-search-input"
              placeholder="Search"
              onInput={props.onSearch}
              ref={props.searchInput}
            />
            <div class="spinner" role="progressbar" aria-busy="false" ref={props.spinner} />
          </form>
          <EditButton>New</EditButton>
        </section>
        <nav>{props.noteList}</nav>
      </section>
      <section class="col note-viewer">{props.children}</section>
    </div>
  );
}
