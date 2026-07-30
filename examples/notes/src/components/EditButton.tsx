/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { JSX } from "@solidjs/web";

export default function EditButton(props: { noteId?: number; children: JSX.Element }) {
  const isDraft = !("noteId" in props);
  return (
    <a
      href={!isDraft ? `/notes/${props.noteId}/edit` : `/new`}
      class={["edit-button", isDraft ? "edit-button--solid" : "edit-button--outline"].join(" ")}
      role="menuitem"
    >
      {props.children}
    </a>
  );
}
