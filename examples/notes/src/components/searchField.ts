/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
// The demo's SearchField.client.js, dissolved (Stage 6). The search field's
// MARKUP lives in the server shell (server/App.tsx); what remains here is
// pure behavior — a bag of functions the client hands the server component:
//
// - `onSearch`/`onSubmit` are event props: the server marks the elements,
//   and the document-level delegation walk resolves them through the
//   frame's live props at dispatch time.
// - `searchInput`/`spinner` are ref props: they fire with the adopted
//   elements under this component's owner, so the effects inside sync
//   server-rendered DOM against client router state (the input restores
//   `?searchText` on deep links and back/forward; the spinner tracks the
//   pending navigation) and dispose with the app.
//
// Search state itself is unchanged: the `?searchText` query param, so typing
// navigates — the router reruns the root preload and the notes-list server
// component refetches, morphing the list boundary in place.
import { useSearchParams } from "@solidjs/router";
import { createEffect, isPending } from "solid-js";

export default function searchField() {
  const [search, setParams] = useSearchParams();
  const isSearching = () => isPending(() => search.searchText);
  return {
    onSearch: (e: InputEvent) => {
      setParams({ searchText: (e.target as HTMLInputElement).value });
    },
    onSubmit: (e: SubmitEvent) => e.preventDefault(),
    searchInput: (el: HTMLInputElement) => {
      createEffect(
        () => (search.searchText as string) || "",
        text => {
          el.value = text;
        }
      );
    },
    spinner: (el: HTMLElement) => {
      createEffect(isSearching, active => {
        el.classList.toggle("spinner--active", !!active);
        el.setAttribute("aria-busy", String(!!active));
      });
    }
  };
}
