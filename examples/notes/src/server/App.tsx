"use server";
// The React demo's App.server.js: the application shell as a server
// component. It is static chrome with four client positions — the search
// field, the New button, the notes list, and the route outlet — so its markup
// ships as HTML once at document SSR and is never refetched. Unlike the
// original demo, navigation does NOT re-render this tree: the list and the
// note are independent server components (their own boundaries) that refresh
// fine-grained while the shell stands still.
import type { JSX } from "@solidjs/web";

export async function appView() {
  return (props: {
    search: JSX.Element;
    editButton: JSX.Element;
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
          {props.search}
          {props.editButton}
        </section>
        <nav>{props.noteList}</nav>
      </section>
      <section class="col note-viewer">{props.children}</section>
    </div>
  );
}
