// The app, and the React demo's App.js: static chrome around two boundaries.
// The list and the note are server components — their markup arrives as HTML
// — and they refresh fine-grained while the shell stands still: unlike the
// original demo, navigation re-renders only the boundary that changed.
import { Loading } from "solid-js";
import { dynamic } from "@solidjs/web";
import EditButton from "~/components/EditButton";
import SearchField from "~/components/SearchField";
import SidebarNoteContent from "~/components/SidebarNoteContent";
import { getNoteList, Router } from "~/router";
import "./app.css";

export default function App() {
  return (
    <Router>
      {props => {
        // The list refetches when the search param changes — and morphs in
        // place when a mutation's single-flight response includes it.
        const NoteList = dynamic(() => getNoteList(String(props.location.query.searchText || "")));
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
                <SearchField />
                <EditButton>New</EditButton>
              </section>
              <nav>
                <Loading fallback="Loading Notes..">
                  <NoteList item={p => <SidebarNoteContent {...p} />} />
                </Loading>
              </nav>
            </section>
            <section class="col note-viewer">
              <Loading fallback="Loading Content">{props.children}</Loading>
            </section>
          </div>
        );
      }}
    </Router>
  );
}
