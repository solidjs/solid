export interface RendererOptions<NodeType> {
  createElement(tag: string, staticProps?: Record<string, unknown>): NodeType;
  createTextNode(value: string): NodeType;
  createSentinel?(): NodeType;
  replaceText(textNode: NodeType, value: string): void;
  isTextNode(node: NodeType): boolean;
  setProperty<T>(node: NodeType, name: string, value: T, prev?: T): void;
  insertNode(parent: NodeType, node: NodeType, anchor?: NodeType): void;
  removeNode(parent: NodeType, node: NodeType): void;
  cleanupNodes?(parent: NodeType, nodes: NodeType[]): void;
  getParentNode(node: NodeType): NodeType | undefined;
  getFirstChild(node: NodeType): NodeType | undefined;
  getNextSibling(node: NodeType): NodeType | undefined;
}

export interface Renderer<NodeType> {
  render(code: () => NodeType, node: NodeType): () => void;
  effect<T>(fn: (prev?: T) => T, effect: (value: T, prev?: T) => void): void;
  memo<T>(fn: () => T, equal: boolean): () => T;
  createComponent<T>(Comp: (props: T) => NodeType, props: T): NodeType;
  createElement(tag: string, staticProps?: Record<string, unknown>): NodeType;
  createTextNode(value: string): NodeType;
  insertNode(parent: NodeType, node: NodeType, anchor?: NodeType): void;
  insert<T>(parent: any, accessor: (() => T) | T, marker?: any | null, initial?: any): NodeType;
  spread<T extends object>(node: any, props: T, skipChildren?: boolean): void;
  setProp<T>(node: NodeType, name: string, value: T, prev?: T): T;
  mergeProps(...sources: unknown[]): unknown;
  applyRef(
    r: ((element: NodeType) => void) | ((element: NodeType) => void)[],
    element: NodeType
  ): void;
  ref(
    fn: () => ((element: NodeType) => void) | ((element: NodeType) => void)[],
    element: NodeType
  ): void;
}

export function createRenderer<NodeType>(options: RendererOptions<NodeType>): Renderer<NodeType>;
