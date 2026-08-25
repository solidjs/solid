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
// A word on fit, because this file shows the PATTERN'S BOUNDARY as much as
// the pattern. Event props and one-way refs (the spinner) are the sweet
// spot: behavior on chrome you'd never ship a component for — and in chat's
// copy buttons, on markup the client couldn't author at all. The input's
// value-sync effect below is the edge: once an element's STATE must track
// client reactivity, a ref means hand-writing the binding that JSX's
// `value={...}` gives a client component for free. We keep the input server
// chrome here because one three-line effect is a fair trade for dissolving
// the shell's last hydration island — but when an element is mostly client
// state, make it a client position and let JSX do the syncing.
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
