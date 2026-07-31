"use server";
// The React demo's App.server.js: the application shell as a server
// component. It is static chrome with three client positions — the search
// field, the notes list, and the route outlet — so its markup ships as HTML
// once at document SSR and is never refetched. Unlike the original demo,
// navigation does NOT re-render this tree: the list and the note are
// independent server components (their own boundaries) that refresh
// fine-grained while the shell stands still.
//
// The New button is NOT a client position: EditButton is a plain anchor, and
// the router intercepts every same-origin <a> at the document level, so
// server-rendered links SPA-navigate without shipping a component. (The React
// demo needed a client component here because its navigation was a context
// call — ours is just an href.)
import type { JSX } from "@solidjs/web";
import EditButton from "~/components/EditButton";

export async function appView() {
  return (props: { search: JSX.Element; noteList: JSX.Element; children: JSX.Element }) => (
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
          {props.search}
          <EditButton>New</EditButton>
        </section>
        <nav>{props.noteList}</nav>
      </section>
      <section class="col note-viewer">{props.children}</section>
    </div>
  );
}
