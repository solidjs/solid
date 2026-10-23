// Who this TAB is. Identity is per tab (sessionStorage), so two tabs of one
// browser are two people on the canvas.
//
// It is a signal provided through context, and it starts `null` — the value
// the server renders with, since the server cannot know a tab. The provider
// mints it once the app has settled in the browser, so the change flows
// through the reactive graph: presence is called again with the tab's
// identity, and from then on the tab is in the room and can point and write.
import {
  createContext,
  createSignal,
  onSettled,
  type Accessor,
  type ParentComponent
} from "solid-js";
import { isServer } from "@solidjs/web";
import type { Identity } from "~/types";

const ADJECTIVES = ["quick", "quiet", "bright", "brave", "calm", "keen", "warm", "wry"];
const ANIMALS = ["otter", "heron", "lynx", "finch", "badger", "gecko", "tapir", "wren"];

/** A fresh id: for this tab, and for the rows and writes it makes. */
export const mintId = () => Math.random().toString(36).slice(2, 12).padEnd(10, "0");

function mint(): Identity {
  const key = "board:me";
  const stored = sessionStorage.getItem(key);
  if (stored) return JSON.parse(stored);
  const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];
  const identity = { id: mintId(), name: `${pick(ADJECTIVES)}-${pick(ANIMALS)}` };
  sessionStorage.setItem(key, JSON.stringify(identity));
  return identity;
}

/** This tab's identity — `null` on the server and until the browser mints it. */
export const IdentityContext = createContext<Accessor<Identity | null>>();

/** Holds this tab's identity for the tree below; mints it in the browser once settled. */
export const IdentityProvider: ParentComponent = props => {
  const [me, setMe] = createSignal<Identity | null>(null);
  onSettled(() => {
    if (!isServer) setMe(mint());
  });
  return <IdentityContext value={me}>{props.children}</IdentityContext>;
};
