export function dynamicProperty(props: any, key: string): void;

export function normalizeIncomingArray(normalized: any[], array: any[], unwrap: boolean): boolean;

export function appendNodes(parent: Node, array: Node[], marker: Node | null): void;

export function cleanChildren(
  parent: Node,
  current: Node[],
  marker?: Node | null,
  replacement?: Node
): any;
