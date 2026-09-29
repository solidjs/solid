/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
// The demo's SearchField.client.js, dissolved. The search field's MARKUP
// lives in the server shell (server/App.tsx); what remains here is the
// behavior the client contributes, as ONE attribute slot (principles §9.2.3):
// the server calls `props.search()` once and reads the returned object's
// properties at positions — `value`/`onInput` on the input, `onSubmit` on
// the form, the spinner's active class and `aria-busy`. The client binds
// exactly those positions on the server's elements.
//
// The values are getters over router state, so each position tracks its
// own reads and updates alone: the input restores `?searchText` on deep
// links and back/forward, the spinner tracks the pending navigation. Before
// attribute slots this file was refs hand-syncing that DOM (the pattern's
// boundary then — an element whose STATE tracks client reactivity wanted a
// client component). Now the binding is what the template says: a value
// position over client state is the same one line on both sides.
//
// Search state itself is unchanged: the `?searchText` query param, so typing
// navigates — the router reruns the root preload and the notes-list server
// component refetches, morphing the list boundary in place.
import { useSearchParams } from "@solidjs/router";
import { isPending } from "solid-js";

/** What the client decides about the search field. */
export interface SearchBehavior {
  value: string;
  active: boolean;
  /** `aria-busy` wants the string, not the boolean's bare attribute. */
  busy: "true" | "false";
  onInput: (e: InputEvent) => void;
  onSubmit: (e: SubmitEvent) => void;
}

export default function searchField() {
  const [search, setParams] = useSearchParams();
  const isSearching = () => !!isPending(() => search.searchText);
  return (): SearchBehavior => ({
    get value() {
      return (search.searchText as string) || "";
    },
    get active() {
      return isSearching();
    },
    get busy() {
      return isSearching() ? "true" : "false";
    },
    onInput: (e: InputEvent) => {
      setParams({ searchText: (e.target as HTMLInputElement).value });
    },
    onSubmit: (e: SubmitEvent) => e.preventDefault()
  });
}
