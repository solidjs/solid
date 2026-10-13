// The board as it crosses the wire. Flat, as it would be in a database: a
// card names its list, so moving it is one field write on one row.
export interface List {
  id: string;
  title: string;
  /** Fractional key (see order.ts): sorts between its neighbours. */
  pos: string;
}

export interface Card {
  id: string;
  listId: string;
  title: string;
  pos: string;
}

export interface Board {
  title: string;
  lists: List[];
  cards: Card[];
  // The acknowledgement. Ids of the mutations this connection's client sent
  // that the board now reflects — its most recent ones, in the order they
  // were applied. A write to an existing row is confirmed when its id shows
  // up here, in the same value that carries its effect.
  applied: string[];
}

export interface Identity {
  id: string;
  name: string;
}

export interface Member extends Identity {
  since: number;
}
