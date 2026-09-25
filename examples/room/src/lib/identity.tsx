// Who this TAB is. Identity is per tab (sessionStorage) so two tabs of the
// same browser are two members — the point of a presence demo.
//
// It is a SIGNAL provided through context, and it starts `null` — the value
// the server renders with (the document render only WATCHES the room; see
// `presence` in sources.ts). The provider mints it once the app has settled
// on the client, so the null→identity change flows through the reactive
// graph: the composer enables, the presence memo re-invokes and this tab
// joins, and the "you are…" line fills. Held in the tree rather than at
// module level because that is the SSR-safe shape: nothing about this tab
// leaks into the server's module state, and a signal created inside the
// hydrating tree is snapshotted like everything else, so the mint lands
// whenever it lands — during the hydration pass (held, then replayed) or
// after it (live) — and the page reads the server's value until then.
import {
  createContext,
  createSignal,
  onSettled,
  useContext,
  type Accessor,
  type ParentComponent
} from "solid-js";
import { isServer } from "@solidjs/web";
import type { Identity } from "./sources";

const ADJECTIVES = ["quick", "quiet", "bright", "brave", "calm", "keen", "warm", "wry"];
const ANIMALS = ["otter", "heron", "lynx", "finch", "badger", "gecko", "tapir", "wren"];

function mint(): Identity {
  const key = "room:me";
  const stored = sessionStorage.getItem(key);
  if (stored) return JSON.parse(stored);
  const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];
  const identity = {
    id: Math.random().toString(36).slice(2, 10),
    name: `${pick(ADJECTIVES)}-${pick(ANIMALS)}`
  };
  sessionStorage.setItem(key, JSON.stringify(identity));
  return identity;
}

const IdentityContext = createContext<Accessor<Identity | null>>();

/** Holds this tab's identity for the tree below; mints it on the client once settled. */
export const IdentityProvider: ParentComponent = props => {
  const [me, setMe] = createSignal<Identity | null>(null);
  onSettled(() => {
    if (!isServer) setMe(mint());
  });
  return <IdentityContext value={me}>{props.children}</IdentityContext>;
};

/** This tab's identity — `null` on the server and until the client mints it. */
export function useIdentity(): Accessor<Identity | null> {
  const me = useContext(IdentityContext);
  if (!me) throw new Error("useIdentity() must be called under <IdentityProvider>");
  return me;
}
