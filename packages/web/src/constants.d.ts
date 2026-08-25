/**
 * Flags
 *
 * - 1 - Stateful property - value derives from reactive state
 * - 2 - Locked to property - value not specially treated
 */
export const DOMWithState: Record<string, Record<string, 1 | 2>>;

export const ChildProperties: Set<string>;

export const DelegatedEvents: Set<string>;

export const SVGElements: Set<string>;

export const MathMLElements: Set<string>;

export const VoidElements: Set<string>;

export const RawTextElements: Set<string>;

export const Namespaces: Record<string, string>;

export const DOMElements: Set<string>;
