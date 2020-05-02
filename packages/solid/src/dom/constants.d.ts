declare type AttributeInfo = {
  [key: string]: {
    type: string;
    alias?: string;
  };
};
export const Attributes: AttributeInfo;

export const SVGAttributes: AttributeInfo;

export const NonComposedEvents: Set<string>;

export const SVGElements: Set<string>;
