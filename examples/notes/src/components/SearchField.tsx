/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
// The demo's SearchField.client.js. Search state is the `?searchText` query
// param, so typing navigates — the router reruns the root preload and the
// notes-list server component refetches, morphing the list boundary in place.
import { useSearchParams } from "@solidjs/router";
import { isPending } from "solid-js";

export default function SearchField() {
  const [search, setParams] = useSearchParams();
  const isSearching = () => isPending(() => search.searchText);
  return (
    <form class="search" role="search" onSubmit={e => e.preventDefault()}>
      <label class="offscreen" for="sidebar-search-input">
        Search for a note by title
      </label>
      <input
        id="sidebar-search-input"
        placeholder="Search"
        value={search.searchText || ""}
        onInput={e => {
          setParams({ searchText: e.target.value });
        }}
      />
      <div
        class={["spinner", isSearching() && "spinner--active"].join(" ")}
        role="progressbar"
        aria-busy={isSearching() ? "true" : "false"}
      />
    </form>
  );
}
