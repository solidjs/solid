declare global {
  /**
   * Based on JSX types for Surplus and Inferno and adapted for `dom-expressions`.
   *
   * https://github.com/adamhaile/surplus/blob/master/index.d.ts
   * https://github.com/infernojs/inferno/blob/master/packages/inferno/src/core/types.ts
   */

  namespace JSX {
    type Element =
      | Node
      | ArrayElement
      | FunctionElement
      | string
      | number
      | boolean
      | null
      | undefined;

    interface ArrayElement extends Array<Element> {}
    interface FunctionElement {
      (): Element;
    }

    // Let TS know the name of the `children` property in order for it to be able to type check them.
    // https://github.com/Microsoft/TypeScript/issues/18357
    interface ElementChildrenAttribute {
      children: {};
    }

    interface EventHandler<T, E extends Event> {
      (e: E & { currentTarget: T; target: T }): void;
    }

    interface BoundEventHandler<T, E extends Event> {
      0: (data: any, e: E & { currentTarget: T; target: T }) => void;
      1: any;
    }

    type EventHandlerUnion<T, E extends Event> = EventHandler<T, E> | BoundEventHandler<T, E>;

    // Intrinsic attributes enable us to define certain keys as attributes on an element, while
    // at the same time hiding them from the element's `props`.
    // https://github.com/Microsoft/TypeScript/issues/5478
    interface IntrinsicAttributes {
      ref?: HTMLElement | ((e: HTMLElement) => void);
    }

    // https://github.com/ryansolid/babel-plugin-jsx-dom-expressions#special-binding
    interface CustomAttributes<T> {
      ref?: T | ((el: T) => void);
      classList?: { [k: string]: boolean | undefined };
      on?: { [key: string]: EventHandler<T, CustomEvent> };
      onCapture?: { [key: string]: EventHandler<T, CustomEvent> };
    }

    // https://github.com/ryansolid/babel-plugin-jsx-dom-expressions#oneventname
    interface DOMAttributes<T> extends CustomAttributes<T> {
      children?: Element;
      innerHTML?: string;
      innerText?: string;
      textContent?: string;

      // Clipboard Events
      onCopy?: EventHandlerUnion<T, ClipboardEvent>;
      onCut?: EventHandlerUnion<T, ClipboardEvent>;
      onPaste?: EventHandlerUnion<T, ClipboardEvent>;

      // Composition Events
      onCompositionEnd?: EventHandlerUnion<T, CompositionEvent>;
      onCompositionStart?: EventHandlerUnion<T, CompositionEvent>;
      onCompositionUpdate?: EventHandlerUnion<T, CompositionEvent>;

      // Focus Events
      onFocus?: EventHandlerUnion<T, FocusEvent>;
      onBlur?: EventHandlerUnion<T, FocusEvent>;

      // Form Events
      onChange?: EventHandlerUnion<T, Event>;
      onInput?: EventHandlerUnion<T, InputEvent>;
      onReset?: EventHandlerUnion<T, Event>;
      onSubmit?: EventHandlerUnion<T, FocusEvent>;

      // Image Events
      onLoad?: EventHandlerUnion<T, Event>;
      onError?: EventHandlerUnion<T, Event>; // also a Media Event

      // Keyboard Events
      onKeyDown?: EventHandlerUnion<T, KeyboardEvent>;
      onKeyPress?: EventHandlerUnion<T, KeyboardEvent>;
      onKeyUp?: EventHandlerUnion<T, KeyboardEvent>;

      // Pointer Events
      onGotPointerCapture?: EventHandlerUnion<T, PointerEvent>;
      onLostPointerCapture?: EventHandlerUnion<T, PointerEvent>;
      onPointerCancel?: EventHandlerUnion<T, PointerEvent>;
      onPointerDown?: EventHandlerUnion<T, PointerEvent>;
      onPointerEnter?: EventHandlerUnion<T, PointerEvent>;
      onPointerLeave?: EventHandlerUnion<T, PointerEvent>;
      onPointerMove?: EventHandlerUnion<T, PointerEvent>;
      onPointerOver?: EventHandlerUnion<T, PointerEvent>;
      onPointerOut?: EventHandlerUnion<T, PointerEvent>;
      onPointerUp?: EventHandlerUnion<T, PointerEvent>;

      // Media Events
      onAbort?: EventHandlerUnion<T, Event>;
      onCanPlay?: EventHandlerUnion<T, Event>;
      onCanPlayThrough?: EventHandlerUnion<T, Event>;
      onDurationChange?: EventHandlerUnion<T, Event>;
      onEmptied?: EventHandlerUnion<T, Event>;
      onEncrypted?: EventHandlerUnion<T, Event>;
      onEnded?: EventHandlerUnion<T, Event>;
      onLoadedData?: EventHandlerUnion<T, Event>;
      onLoadedMetadata?: EventHandlerUnion<T, Event>;
      onLoadStart?: EventHandlerUnion<T, Event>;
      onPause?: EventHandlerUnion<T, Event>;
      onPlay?: EventHandlerUnion<T, Event>;
      onPlaying?: EventHandlerUnion<T, Event>;
      onProgress?: EventHandlerUnion<T, Event>;
      onRateChange?: EventHandlerUnion<T, Event>;
      onSeeked?: EventHandlerUnion<T, Event>;
      onSeeking?: EventHandlerUnion<T, Event>;
      onStalled?: EventHandlerUnion<T, Event>;
      onSuspend?: EventHandlerUnion<T, Event>;
      onTimeUpdate?: EventHandlerUnion<T, Event>;
      onVolumeChange?: EventHandlerUnion<T, Event>;
      onWaiting?: EventHandlerUnion<T, Event>;

      // MouseEvents
      onClick?: EventHandlerUnion<T, MouseEvent>;
      onContextMenu?: EventHandlerUnion<T, MouseEvent>;
      onDblClick?: EventHandlerUnion<T, MouseEvent>;
      onDrag?: EventHandlerUnion<T, DragEvent>;
      onDragEnd?: EventHandlerUnion<T, DragEvent>;
      onDragEnter?: EventHandlerUnion<T, DragEvent>;
      onDragExit?: EventHandlerUnion<T, DragEvent>;
      onDragLeave?: EventHandlerUnion<T, DragEvent>;
      onDragOver?: EventHandlerUnion<T, DragEvent>;
      onDragStart?: EventHandlerUnion<T, DragEvent>;
      onDrop?: EventHandlerUnion<T, DragEvent>;
      onMouseDown?: EventHandlerUnion<T, MouseEvent>;
      onMouseEnter?: EventHandlerUnion<T, MouseEvent>;
      onMouseLeave?: EventHandlerUnion<T, MouseEvent>;
      onMouseMove?: EventHandlerUnion<T, MouseEvent>;
      onMouseOut?: EventHandlerUnion<T, MouseEvent>;
      onMouseOver?: EventHandlerUnion<T, MouseEvent>;
      onMouseUp?: EventHandlerUnion<T, MouseEvent>;

      // Selection Events
      onSelect?: EventHandlerUnion<T, UIEvent>;

      // Touch Events
      onTouchCancel?: EventHandlerUnion<T, TouchEvent>;
      onTouchEnd?: EventHandlerUnion<T, TouchEvent>;
      onTouchMove?: EventHandlerUnion<T, TouchEvent>;
      onTouchStart?: EventHandlerUnion<T, TouchEvent>;

      // UI Events
      onScroll?: EventHandlerUnion<T, UIEvent>;

      // Wheel Events
      onWheel?: EventHandlerUnion<T, WheelEvent>;

      // Animation Events
      onAnimationStart?: EventHandlerUnion<T, AnimationEvent>;
      onAnimationEnd?: EventHandlerUnion<T, AnimationEvent>;
      onAnimationIteration?: EventHandlerUnion<T, AnimationEvent>;

      // Transition Events
      onTransitionEnd?: EventHandlerUnion<T, TransitionEvent>;
    }

    // See CSS 3 CSS-wide keywords https://www.w3.org/TR/css3-values/#common-keywords
    // See CSS 3 Explicit Defaulting https://www.w3.org/TR/css-cascade-3/#defaulting-keywords
    // "all CSS properties can accept these values"
    type CSSWideKeyword = "initial" | "inherit" | "unset";

    // See CSS 3 <percentage> type https://drafts.csswg.org/css-values-3/#percentages
    type CSSPercentage = string;

    // See CSS 3 <length> type https://drafts.csswg.org/css-values-3/#lengths
    type CSSLength = number | string;

    // This interface is not complete. Only properties accepting
    // unitless numbers are listed here (see CSSProperty.js in Inferno)
    interface CSSProperties {
      /**
       * Aligns a flex container's lines within the flex container when there is extra space in the cross-axis, similar to how justify-content aligns individual items within the main-axis.
       */
      "align-content"?:
        | CSSWideKeyword
        | "flex-start"
        | "flex-end"
        | "center"
        | "space-between"
        | "space-around"
        | "stretch";

      /**
       * Sets the default alignment in the cross axis for all of the flex container's items, including anonymous flex items, similarly to how justify-content aligns items along the main axis.
       */
      "align-items"?:
        | CSSWideKeyword
        | "flex-start"
        | "flex-end"
        | "center"
        | "baseline"
        | "stretch";

      /**
       * Allows the default alignment to be overridden for individual flex items.
       */
      "align-self"?:
        | CSSWideKeyword
        | "auto"
        | "flex-start"
        | "flex-end"
        | "center"
        | "baseline"
        | "stretch";

      /**
       * This property allows precise alignment of elements, such as graphics,
       * that do not have a baseline-table or lack the desired baseline in their baseline-table.
       * With the alignment-adjust property, the position of the baseline identified by the alignment-baseline
       * can be explicitly determined. It also determines precisely the alignment point for each glyph within a textual element.
       */
      "alignment-adjust"?: CSSWideKeyword | any;

      "alignment-baseline"?: CSSWideKeyword | any;

      /**
       * Defines a length of time to elapse before an animation starts, allowing an animation to begin execution some time after it is applied.
       */
      "animation-delay"?: CSSWideKeyword | any;

      /**
       * Defines whether an animation should run in reverse on some or all cycles.
       */
      "animation-direction"?: CSSWideKeyword | any;

      /**
       * Specifies how many times an animation cycle should play.
       */
      "animation-iteration-count"?: CSSWideKeyword | any;

      /**
       * Defines the list of animations that apply to the element.
       */
      "animation-name"?: CSSWideKeyword | any;

      /**
       * Defines whether an animation is running or paused.
       */
      "animation-play-state"?: CSSWideKeyword | any;

      /**
       * Allows changing the style of any element to platform-based interface elements or vice versa.
       */
      appearance?: CSSWideKeyword | any;

      /**
       * Determines whether or not the “back” side of a transformed element is visible when facing the viewer.
       */
      "backface-visibility"?: CSSWideKeyword | any;

      /**
       * Shorthand property to set the values for one or more of:
       * background-clip, background-color, background-image,
       * background-origin, background-position, background-repeat,
       * background-size, and background-attachment.
       */
      background?: CSSWideKeyword | any;

      /**
       * If a background-image is specified, this property determines
       * whether that image's position is fixed within the viewport,
       * or scrolls along with its containing block.
       * See CSS 3 background-attachment property https://drafts.csswg.org/css-backgrounds-3/#the-background-attachment
       */
      "background-attachment"?: CSSWideKeyword | "scroll" | "fixed" | "local";

      /**
       * This property describes how the element's background images should blend with each other and the element's background color.
       * The value is a list of blend modes that corresponds to each background image. Each element in the list will apply to the
       * corresponding element of background-image. If a property doesn’t have enough comma-separated values to match the number of layers,
       * the UA must calculate its used value by repeating the list of values until there are enough.
       */
      "background-blend-mode"?: CSSWideKeyword | any;

      /**
       * Sets the background color of an element.
       */
      "background-color"?: CSSWideKeyword | any;

      "background-composite"?: CSSWideKeyword | any;

      /**
       * Applies one or more background images to an element. These can be any valid CSS image, including url() paths to image files or CSS gradients.
       */
      "background-image"?: CSSWideKeyword | any;

      /**
       * Specifies what the background-position property is relative to.
       */
      "background-origin"?: CSSWideKeyword | any;

      /**
       * Sets the position of a background image.
       */
      "background-position"?: CSSWideKeyword | any;

      /**
       * Background-repeat defines if and how background images will be repeated after they have been sized and positioned
       */
      "background-repeat"?: CSSWideKeyword | any;

      /**
       * Defines the size of the background images
       */
      "background-size"?: CSSWideKeyword | any;

      /**
       * Obsolete - spec retired, not implemented.
       */
      "baseline-shift"?: CSSWideKeyword | any;

      /**
       * Non standard. Sets or retrieves the location of the Dynamic HTML (DHTML) behavior.
       */
      behavior?: CSSWideKeyword | any;

      /**
       * Shorthand property that defines the different properties of all four sides of an element's border in a single declaration.
       * It can be used to set border-width, border-style and border-color, or a subset of these.
       */
      border?: CSSWideKeyword | any;

      /**
       * Shorthand that sets the values of border-bottom-color,
       * border-bottom-style, and border-bottom-width.
       */
      "border-bottom"?: CSSWideKeyword | any;

      /**
       * Sets the color of the bottom border of an element.
       */
      "border-bottom-color"?: CSSWideKeyword | any;

      /**
       * Defines the shape of the border of the bottom-left corner.
       */
      "border-bottom-left-radius"?: CSSWideKeyword | CSSLength;

      /**
       * Defines the shape of the border of the bottom-right corner.
       */
      "border-bottom-right-radius"?: CSSWideKeyword | CSSLength;

      /**
       * Sets the line style of the bottom border of a box.
       */
      "border-bottom-style"?: CSSWideKeyword | any;

      /**
       * Sets the width of an element's bottom border. To set all four borders,
       * use the border-width shorthand property which sets the values simultaneously for border-top-width,
       * border-right-width, border-bottom-width, and border-left-width.
       */
      "border-bottom-width"?: CSSWideKeyword | any;

      /**
       * Border-collapse can be used for collapsing the borders between table cells
       */
      "border-collapse"?: CSSWideKeyword | any;

      /**
       * The CSS border-color property sets the color of an element's four borders.
       * This property can have from one to four values, made up of the elementary properties:
       *      •       border-top-color
       *      •       border-right-color
       *      •       border-bottom-color
       *      •       border-left-color The default color is the currentColor of each of these values.
       * If you provide one value, it sets the color for the element. Two values set the horizontal and vertical values,
       * respectively. Providing three values sets the top, vertical, and bottom values, in that order.
       * Four values set all for sides: top, right, bottom, and left, in that order.
       */
      "border-color"?: CSSWideKeyword | any;

      /**
       * Specifies different corner clipping effects, such as scoop (inner curves), bevel (straight cuts) or notch (cut-off rectangles).
       * Works along with border-radius to specify the size of each corner effect.
       */
      "border-corner-shape"?: CSSWideKeyword | any;

      /**
       * The property border-image-source is used to set the image to be used instead of the border style.
       * If this is set to none the border-style is used instead.
       */
      "border-image-source"?: CSSWideKeyword | any;

      /**
       * The border-image-width CSS property defines the offset to use for dividing the border image in nine parts,
       * the top-left corner, central top edge, top-right-corner, central right edge, bottom-right corner, central bottom edge,
       * bottom-left corner, and central right edge. They represent inward distance from the top, right, bottom, and left edges.
       */
      "border-image-width"?: CSSWideKeyword | any;

      /**
       * Shorthand property that defines the border-width, border-style and border-color of an element's left border in a single declaration.
       * Note that you can use the corresponding longhand properties to set specific individual properties of the left border — border-left-width,
       * border-left-style and border-left-color.
       */
      "border-left"?: CSSWideKeyword | any;

      /**
       * The CSS border-left-color property sets the color of an element's left border. This page explains the border-left-color value,
       * but often you will find it more convenient to fix the border's left color as part of a shorthand set, either border-left or border-color.
       * Colors can be defined several ways. For more information, see Usage.
       */
      "border-left-color"?: CSSWideKeyword | any;

      /**
       * Sets the style of an element's left border. To set all four borders, use the shorthand property, border-style.
       * Otherwise, you can set the borders individually with border-top-style, border-right-style, border-bottom-style, border-left-style.
       */
      "border-left-style"?: CSSWideKeyword | any;

      /**
       * Sets the width of an element's left border. To set all four borders,
       * use the border-width shorthand property which sets the values simultaneously for border-top-width,
       * border-right-width, border-bottom-width, and border-left-width.
       */
      "border-left-width"?: CSSWideKeyword | any;

      /**
       * Shorthand property that sets the rounding of all four corners.
       */
      "border-radius"?: CSSWideKeyword | CSSLength;

      /**
       * Shorthand property that defines the border-width, border-style and border-color of an element's right border
       * in a single declaration. Note that you can use the corresponding longhand properties to set specific
       * individual properties of the right border — border-right-width, border-right-style and border-right-color.
       */
      "border-right"?: CSSWideKeyword | any;

      /**
       * Sets the color of an element's right border. This page explains the border-right-color value,
       * but often you will find it more convenient to fix the border's right color as part of a shorthand set,
       * either border-right or border-color.
       * Colors can be defined several ways. For more information, see Usage.
       */
      "border-right-color"?: CSSWideKeyword | any;

      /**
       * Sets the style of an element's right border. To set all four borders, use the shorthand property,
       * border-style. Otherwise, you can set the borders individually with border-top-style, border-right-style,
       * border-bottom-style, border-left-style.
       */
      "border-right-style"?: CSSWideKeyword | any;

      /**
       * Sets the width of an element's right border. To set all four borders,
       * use the border-width shorthand property which sets the values simultaneously for border-top-width,
       * border-right-width, border-bottom-width, and border-left-width.
       */
      "border-right-width"?: CSSWideKeyword | any;

      /**
       * Specifies the distance between the borders of adjacent cells.
       */
      "border-spacing"?: CSSWideKeyword | any;

      /**
       * Sets the style of an element's four borders. This property can have from one to four values.
       * With only one value, the value will be applied to all four borders;
       * otherwise, this works as a shorthand property for each of border-top-style, border-right-style,
       * border-bottom-style, border-left-style, where each border style may be assigned a separate value.
       */
      "border-style"?: CSSWideKeyword | any;

      /**
       * Shorthand property that defines the border-width, border-style and border-color of an element's top border
       * in a single declaration. Note that you can use the corresponding longhand properties to set specific
       * individual properties of the top border — border-top-width, border-top-style and border-top-color.
       */
      "border-top"?: CSSWideKeyword | any;

      /**
       * Sets the color of an element's top border. This page explains the border-top-color value,
       * but often you will find it more convenient to fix the border's top color as part of a shorthand set,
       * either border-top or border-color.
       * Colors can be defined several ways. For more information, see Usage.
       */
      "border-top-color"?: CSSWideKeyword | any;

      /**
       * Sets the rounding of the top-left corner of the element.
       */
      "border-top-left-radius"?: CSSWideKeyword | CSSLength;

      /**
       * Sets the rounding of the top-right corner of the element.
       */
      "border-top-right-radius"?: CSSWideKeyword | CSSLength;

      /**
       * Sets the style of an element's top border. To set all four borders, use the shorthand property, border-style.
       * Otherwise, you can set the borders individually with border-top-style, border-right-style, border-bottom-style, border-left-style.
       */
      "border-top-style"?: CSSWideKeyword | any;

      /**
       * Sets the width of an element's top border. To set all four borders,
       * use the border-width shorthand property which sets the values simultaneously for border-top-width,
       * border-right-width, border-bottom-width, and border-left-width.
       */
      "border-top-width"?: CSSWideKeyword | any;

      /**
       * Sets the width of an element's four borders. This property can have from one to four values.
       * This is a shorthand property for setting values simultaneously for border-top-width,
       * border-right-width, border-bottom-width, and border-left-width.
       */
      "border-width"?: CSSWideKeyword | any;

      /**
       * This property specifies how far an absolutely positioned box's bottom margin edge
       * is offset above the bottom edge of the box's containing block. For relatively positioned boxes,
       * the offset is with respect to the bottom edges of the box itself
       * (i.e., the box is given a position in the normal flow, then offset from that position according to these properties).
       */
      bottom?: CSSWideKeyword | any;

      /**
       * Obsolete.
       */
      "box-align"?: CSSWideKeyword | any;

      /**
       * Breaks a box into fragments creating new borders,
       * padding and repeating backgrounds or lets it stay as a continuous box on a page break,
       * column break, or, for inline elements, at a line break.
       */
      "box-decoration-break"?: CSSWideKeyword | any;

      /**
       * Deprecated
       */
      "box-direction"?: CSSWideKeyword | any;

      /**
       * Do not use. This property has been replaced by the flex-wrap property.
       * Gets or sets a value that specifies the direction to add successive rows or columns when the value of box-lines is set to multiple.
       */
      "box-line-progression"?: CSSWideKeyword | any;

      /**
       * Do not use. This property has been replaced by the flex-wrap property.
       * Gets or sets a value that specifies whether child elements wrap onto multiple lines or columns based on the space available in the object.
       */
      "box-lines"?: CSSWideKeyword | any;

      /**
       * Do not use. This property has been replaced by flex-order.
       * Specifies the ordinal group that a child element of the object belongs to.
       * This ordinal value identifies the display order (along the axis defined by the box-orient property) for the group.
       */
      "box-ordinal-group"?: CSSWideKeyword | any;

      /**
       * Deprecated.
       */
      "box-flex"?: CSSWideKeyword | number;

      /**
       * Deprecated.
       */
      "box-flex-group"?: CSSWideKeyword | number;

      /**
       * Cast a drop shadow from the frame of almost any element.
       * MDN: https://developer.mozilla.org/en-US/docs/Web/CSS/box-shadow
       */
      "box-shadow"?: CSSWideKeyword | any;

      /**
       * The CSS break-after property allows you to force a break on multi-column layouts.
       * More specifically, it allows you to force a break after an element.
       * It allows you to determine if a break should occur, and what type of break it should be.
       * The break-after CSS property describes how the page, column or region break behaves after the generated box.
       * If there is no generated box, the property is ignored.
       */
      "break-after"?: CSSWideKeyword | any;

      /**
       * Control page/column/region breaks that fall above a block of content
       */
      "break-before"?: CSSWideKeyword | any;

      /**
       * Control page/column/region breaks that fall within a block of content
       */
      "break-inside"?: CSSWideKeyword | any;

      /**
       * The clear CSS property specifies if an element can be positioned next to
       * or must be positioned below the floating elements that precede it in the markup.
       */
      clear?: CSSWideKeyword | any;

      /**
       * Deprecated; see clip-path.
       * Lets you specify the dimensions of an absolutely positioned element that should be visible,
       * and the element is clipped into this shape, and displayed.
       */
      clip?: CSSWideKeyword | any;

      /**
       * Clipping crops an graphic, so that only a portion of the graphic is rendered, or filled.
       * This clip-rule property, when used with the clip-path property, defines which clip rule, or algorithm,
       * to use when filling the different parts of a graphics.
       */
      "clip-rule"?: CSSWideKeyword | any;

      /**
       * The color property sets the color of an element's foreground content (usually text),
       * accepting any standard CSS color from keywords and hex values to RGB(a) and HSL(a).
       */
      color?: CSSWideKeyword | any;

      /**
       * Describes the number of columns of the element.
       * See CSS 3 column-count property https://www.w3.org/TR/css3-multicol/#cc
       */
      "column-count"?: CSSWideKeyword | number | "auto";

      /**
       * Specifies how to fill columns (balanced or sequential).
       */
      "column-fill"?: CSSWideKeyword | any;

      /**
       * The column-gap property controls the width of the gap between columns in multi-column elements.
       */
      "column-gap"?: CSSWideKeyword | any;

      /**
       * Sets the width, style, and color of the rule between columns.
       */
      "column-rule"?: CSSWideKeyword | any;

      /**
       * Specifies the color of the rule between columns.
       */
      "column-rule-color"?: CSSWideKeyword | any;

      /**
       * Specifies the width of the rule between columns.
       */
      "column-rule-width"?: CSSWideKeyword | any;

      /**
       * The column-span CSS property makes it possible for an element to span across all columns when its value is set to all.
       * An element that spans more than one column is called a spanning element.
       */
      "column-span"?: CSSWideKeyword | any;

      /**
       * Specifies the width of columns in multi-column elements.
       */
      "column-width"?: CSSWideKeyword | any;

      /**
       * This property is a shorthand property for setting column-width and/or column-count.
       */
      columns?: CSSWideKeyword | any;

      /**
       * The counter-increment property accepts one or more names of counters (identifiers),
       * each one optionally followed by an integer which specifies the value by which the counter should be incremented
       * (e.g. if the value is 2, the counter increases by 2 each time it is invoked).
       */
      "counter-increment"?: CSSWideKeyword | any;

      /**
       * The counter-reset property contains a list of one or more names of counters,
       * each one optionally followed by an integer (otherwise, the integer defaults to 0.).
       * Each time the given element is invoked, the counters specified by the property are set to the given integer.
       */
      "counter-reset"?: CSSWideKeyword | any;

      /**
       * The cue property specifies sound files (known as an "auditory icon") to be played by speech media agents
       * before and after presenting an element's content; if only one file is specified, it is played both before and after.
       * The volume at which the file(s) should be played, relative to the volume of the main element, may also be specified.
       * The icon files may also be set separately with the cue-before and cue-after properties.
       */
      cue?: CSSWideKeyword | any;

      /**
       * The cue-after property specifies a sound file (known as an "auditory icon") to be played by speech media agents
       * after presenting an element's content; the volume at which the file should be played may also be specified.
       * The shorthand property cue sets cue sounds for both before and after the element is presented.
       */
      "cue-after"?: CSSWideKeyword | any;

      /**
       * Specifies the mouse cursor displayed when the mouse pointer is over an element.
       */
      cursor?: CSSWideKeyword | any;

      /**
       * The direction CSS property specifies the text direction/writing direction. The rtl is used for Hebrew or Arabic text, the ltr is for other languages.
       */
      direction?: CSSWideKeyword | any;

      /**
       * This property specifies the type of rendering box used for an element. It is a shorthand property for many other display properties.
       */
      display?: CSSWideKeyword | any;

      /**
       * The ‘fill’ property paints the interior of the given graphical element.
       * The area to be painted consists of any areas inside the outline of the shape.
       * To determine the inside of the shape, all subpaths are considered,
       * and the interior is determined according to the rules associated with the current value of the ‘fill-rule’ property.
       * The zero-width geometric outline of a shape is included in the area to be painted.
       */
      fill?: CSSWideKeyword | any;

      /**
       * SVG: Specifies the opacity of the color or the content the current object is filled with.
       * See SVG 1.1 https://www.w3.org/TR/SVG/painting.html#FillOpacityProperty
       */
      "fill-opacity"?: CSSWideKeyword | number;

      /**
       * The ‘fill-rule’ property indicates the algorithm which is to be used to determine what parts of the canvas are included inside the shape.
       * For a simple, non-intersecting path, it is intuitively clear what region lies "inside";
       * however, for a more complex path, such as a path that intersects itself or where one subpath encloses another,
       * the interpretation of "inside" is not so obvious.
       * The ‘fill-rule’ property provides two options for how the inside of a shape is determined:
       */
      "fill-rule"?: CSSWideKeyword | any;

      /**
       * Applies various image processing effects. This property is largely unsupported. See Compatibility section for more information.
       */
      filter?: CSSWideKeyword | any;

      /**
       * Shorthand for `flex-grow`, `flex-shrink`, and `flex-basis`.
       */
      flex?: CSSWideKeyword | number | string;

      /**
       * Obsolete, do not use. This property has been renamed to align-items.
       * Specifies the alignment (perpendicular to the layout axis defined by the flex-direction property) of child elements of the object.
       */
      "flex-align"?: CSSWideKeyword | any;

      /**
       * The flex-basis CSS property describes the initial main size of the flex item
       * before any free space is distributed according to the flex factors described in the flex property (flex-grow and flex-shrink).
       */
      "flex-basis"?: CSSWideKeyword | any;

      /**
       * The flex-direction CSS property describes how flex items are placed in the flex container, by setting the direction of the flex container's main axis.
       */
      "flex-direction"?: CSSWideKeyword | "row" | "row-reverse" | "column" | "column-reverse";

      /**
       * The flex-flow CSS property defines the flex container's main and cross axis. It is a shorthand property for the flex-direction and flex-wrap properties.
       */
      "flex-flow"?: CSSWideKeyword | string;

      /**
       * Specifies the flex grow factor of a flex item.
       * See CSS flex-grow property https://drafts.csswg.org/css-flexbox-1/#flex-grow-property
       */
      "flex-grow"?: CSSWideKeyword | number;

      /**
       * Do not use. This property has been renamed to align-self
       * Specifies the alignment (perpendicular to the layout axis defined by flex-direction) of child elements of the object.
       */
      "flex-item-align"?: CSSWideKeyword | any;

      /**
       * Do not use. This property has been renamed to align-content.
       * Specifies how a flexbox's lines align within the flexbox when there is extra space along the axis that is perpendicular to the axis defined by the flex-direction property.
       */
      "flex-line-pack"?: CSSWideKeyword | any;

      /**
       * Gets or sets a value that specifies the ordinal group that a flexbox element belongs to. This ordinal value identifies the display order for the group.
       */
      "flex-order"?: CSSWideKeyword | any;

      /**
       * Specifies the flex shrink factor of a flex item.
       * See CSS flex-shrink property https://drafts.csswg.org/css-flexbox-1/#flex-shrink-property
       */
      "flex-shrink"?: CSSWideKeyword | number;

      /**
       * Specifies whether flex items are forced into a single line or can be wrapped onto multiple lines.
       * If wrapping is allowed, this property also enables you to control the direction in which lines are stacked.
       * See CSS flex-wrap property https://drafts.csswg.org/css-flexbox-1/#flex-wrap-property
       */
      "flex-wrap"?: CSSWideKeyword | "nowrap" | "wrap" | "wrap-reverse";

      /**
       * Elements which have the style float are floated horizontally.
       * These elements can move as far to the left or right of the containing element.
       * All elements after the floating element will flow around it, but elements before the floating element are not impacted.
       * If several floating elements are placed after each other, they will float next to each other as long as there is room.
       */
      float?: CSSWideKeyword | any;

      /**
       * Flows content from a named flow (specified by a corresponding flow-into) through selected elements to form a dynamic chain of layout regions.
       */
      "flow-from"?: CSSWideKeyword | any;

      /**
       * The font property is shorthand that allows you to do one of two things: you can either set up six of the most mature font properties in one line,
       * or you can set one of a choice of keywords to adopt a system font setting.
       */
      font?: CSSWideKeyword | any;

      /**
       * The font-family property allows one or more font family names and/or generic family names to be specified for usage on the selected element(s)' text.
       * The browser then goes through the list; for each character in the selection it applies the first font family that has an available glyph for that character.
       */
      "font-family"?: CSSWideKeyword | any;

      /**
       * The font-kerning property allows contextual adjustment of inter-glyph spacing, i.e. the spaces between the characters in text.
       * This property controls <bold>metric kerning</bold> - that utilizes adjustment data contained in the font. Optical Kerning is not supported as yet.
       */
      "font-kerning"?: CSSWideKeyword | any;

      /**
       * Specifies the size of the font. Used to compute em and ex units.
       * See CSS 3 font-size property https://www.w3.org/TR/css-fonts-3/#propdef-font-size
       */
      "font-size"?:
        | CSSWideKeyword
        | "xx-small"
        | "x-small"
        | "small"
        | "medium"
        | "large"
        | "x-large"
        | "xx-large"
        | "larger"
        | "smaller"
        | CSSLength
        | CSSPercentage;

      /**
       * The font-size-adjust property adjusts the font-size of the fallback fonts defined with font-family,
       * so that the x-height is the same no matter what font is used.
       * This preserves the readability of the text when fallback happens.
       * See CSS 3 font-size-adjust property https://www.w3.org/TR/css-fonts-3/#propdef-font-size-adjust
       */
      "font-size-adjust"?: CSSWideKeyword | "none" | number;

      /**
       * Allows you to expand or condense the widths for a normal, condensed, or expanded font face.
       * See CSS 3 font-stretch property https://drafts.csswg.org/css-fonts-3/#propdef-font-stretch
       */
      "font-stretch"?:
        | CSSWideKeyword
        | "normal"
        | "ultra-condensed"
        | "extra-condensed"
        | "condensed"
        | "semi-condensed"
        | "semi-expanded"
        | "expanded"
        | "extra-expanded"
        | "ultra-expanded";

      /**
       * The font-style property allows normal, italic, or oblique faces to be selected.
       * Italic forms are generally cursive in nature while oblique faces are typically sloped versions of the regular face.
       * Oblique faces can be simulated by artificially sloping the glyphs of the regular face.
       * See CSS 3 font-style property https://www.w3.org/TR/css-fonts-3/#propdef-font-style
       */
      "font-style"?: CSSWideKeyword | "normal" | "italic" | "oblique";

      /**
       * This value specifies whether the user agent is allowed to synthesize bold or oblique font faces when a font family lacks bold or italic faces.
       */
      "font-synthesis"?: CSSWideKeyword | any;

      /**
       * The font-variant property enables you to select the small-caps font within a font family.
       */
      "font-variant"?: CSSWideKeyword | any;

      /**
       * Fonts can provide alternate glyphs in addition to default glyph for a character. This property provides control over the selection of these alternate glyphs.
       */
      "font-variant-alternates"?: CSSWideKeyword | any;

      /**
       * Specifies the weight or boldness of the font.
       * See CSS 3 'font-weight' property https://www.w3.org/TR/css-fonts-3/#propdef-font-weight
       */
      "font-weight"?:
        | CSSWideKeyword
        | "normal"
        | "bold"
        | "bolder"
        | "lighter"
        | 100
        | 200
        | 300
        | 400
        | 500
        | 600
        | 700
        | 800
        | 900;

      /**
       * Lays out one or more grid items bound by 4 grid lines. Shorthand for setting grid-column-start, grid-column-end, grid-row-start, and grid-row-end in a single declaration.
       */
      "grid-area"?: CSSWideKeyword | any;

      /**
       * Controls a grid item's placement in a grid area, particularly grid position and a grid span. Shorthand for setting grid-column-start and grid-column-end in a single declaration.
       */
      "grid-column"?: CSSWideKeyword | any;

      /**
       * Controls a grid item's placement in a grid area as well as grid position and a grid span.
       * The grid-column-end property (with grid-row-start, grid-row-end, and grid-column-start) determines a grid item's placement by specifying the grid lines of a grid item's grid area.
       */
      "grid-column-end"?: CSSWideKeyword | any;

      /**
       * Determines a grid item's placement by specifying the starting grid lines of a grid item's grid area.
       * A grid item's placement in a grid area consists of a grid position and a grid span.
       * See also ( grid-row-start, grid-row-end, and grid-column-end)
       */
      "grid-column-start"?: CSSWideKeyword | any;

      /**
       * Gets or sets a value that indicates which row an element within a Grid should appear in. Shorthand for setting grid-row-start and grid-row-end in a single declaration.
       */
      "grid-row"?: CSSWideKeyword | any;

      /**
       * Determines a grid item’s placement by specifying the block-end. A grid item's placement in a grid area consists of a grid position and a grid span.
       * The grid-row-end property (with grid-row-start, grid-column-start, and grid-column-end) determines a grid item's placement by specifying the grid lines of a grid item's grid area.
       */
      "grid-row-end"?: CSSWideKeyword | any;

      /**
       * Specifies a row position based upon an integer location, string value, or desired row size.
       * css/properties/grid-row is used as short-hand for grid-row-position and grid-row-position
       */
      "grid-row-position"?: CSSWideKeyword | any;

      "grid-row-span"?: CSSWideKeyword | any;

      /**
       * Specifies named grid areas which are not associated with any particular grid item, but can be referenced from the grid-placement properties.
       * The syntax of the grid-template-areas property also provides a visualization of the structure of the grid, making the overall layout of the grid container easier to understand.
       */
      "grid-template-areas"?: CSSWideKeyword | any;

      /**
       * Specifies (with grid-template-rows) the line names and track sizing functions of the grid.
       * Each sizing function can be specified as a length, a percentage of the grid container’s size,
       * a measurement of the contents occupying the column or row, or a fraction of the free space in the grid.
       */
      "grid-template-columns"?: CSSWideKeyword | any;

      /**
       * Specifies (with grid-template-columns) the line names and track sizing functions of the grid.
       * Each sizing function can be specified as a length, a percentage of the grid container’s size,
       * a measurement of the contents occupying the column or row, or a fraction of the free space in the grid.
       */
      "grid-template-rows"?: CSSWideKeyword | any;

      /**
       * Sets the height of an element. The content area of the element height does not include the padding, border, and margin of the element.
       */
      height?: CSSWideKeyword | any;

      /**
       * Specifies the minimum number of characters in a hyphenated word
       */
      "hyphenate-limit-chars"?: CSSWideKeyword | any;

      /**
       * Indicates the maximum number of successive hyphenated lines in an element. The ‘no-limit’ value means that there is no limit.
       */
      "hyphenate-limit-lines"?: CSSWideKeyword | any;

      /**
       * Specifies the maximum amount of trailing whitespace (before justification) that may be left in a line before hyphenation is triggered
       * to pull part of a word from the next line back up into the current one.
       */
      "hyphenate-limit-zone"?: CSSWideKeyword | any;

      /**
       * Specifies whether or not words in a sentence can be split by the use of a manual or automatic hyphenation mechanism.
       */
      hyphens?: CSSWideKeyword | any;

      imeMode?: CSSWideKeyword | any;

      /**
       * Defines how the browser distributes space between and around flex items
       * along the main-axis of their container.
       * See CSS justify-content property https://www.w3.org/TR/css-flexbox-1/#justify-content-property
       */
      "justify-content"?:
        | CSSWideKeyword
        | "flex-start"
        | "flex-end"
        | "center"
        | "space-between"
        | "space-around"
        | "space-evenly"
        | "stretch";

      "layout-grid"?: CSSWideKeyword | any;

      "layout-grid-char"?: CSSWideKeyword | any;

      "layout-grid-line"?: CSSWideKeyword | any;

      "layout-grid-mode"?: CSSWideKeyword | any;

      "layout-grid-type"?: CSSWideKeyword | any;

      /**
       * Sets the left edge of an element
       */
      left?: CSSWideKeyword | any;

      /**
       * The letter-spacing CSS property specifies the spacing behavior between text characters.
       */
      "letter-spacing"?: CSSWideKeyword | any;

      /**
       * Deprecated. Gets or sets line-breaking rules for text in selected languages such as Japanese, Chinese, and Korean.
       */
      "line-break"?: CSSWideKeyword | any;

      "line-clamp"?: CSSWideKeyword | number;

      /**
       * Specifies the height of an inline block level element.
       * See CSS 2.1 line-height property https://www.w3.org/TR/CSS21/visudet.html#propdef-line-height
       */
      "line-height"?: CSSWideKeyword | "normal" | number | CSSLength | CSSPercentage;

      /**
       * Shorthand property that sets the list-style-type, list-style-position and list-style-image properties in one declaration.
       */
      "list-style"?: CSSWideKeyword | any;

      /**
       * This property sets the image that will be used as the list item marker. When the image is available,
       * it will replace the marker set with the 'list-style-type' marker. That also means that if the image is not available,
       * it will show the style specified by list-style-property
       */
      "list-style-image"?: CSSWideKeyword | any;

      /**
       * Specifies if the list-item markers should appear inside or outside the content flow.
       */
      "list-style-position"?: CSSWideKeyword | any;

      /**
       * Specifies the type of list-item marker in a list.
       */
      "list-style-type"?: CSSWideKeyword | any;

      /**
       * The margin property is shorthand to allow you to set all four margins of an element at once.
       * Its equivalent longhand properties are margin-top, margin-right, margin-bottom and margin-left.
       * Negative values are also allowed.
       */
      margin?: CSSWideKeyword | any;

      /**
       * margin-bottom sets the bottom margin of an element.
       */
      "margin-bottom"?: CSSWideKeyword | any;

      /**
       * margin-left sets the left margin of an element.
       */
      "margin-left"?: CSSWideKeyword | any;

      /**
       * margin-right sets the right margin of an element.
       */
      "margin-right"?: CSSWideKeyword | any;

      /**
       * margin-top sets the top margin of an element.
       */
      "margin-top"?: CSSWideKeyword | any;

      /**
       * The marquee-direction determines the initial direction in which the marquee content moves.
       */
      "marquee-direction"?: CSSWideKeyword | any;

      /**
       * The 'marquee-style' property determines a marquee's scrolling behavior.
       */
      "marquee-style"?: CSSWideKeyword | any;

      /**
       * This property is shorthand for setting mask-image, mask-mode, mask-repeat, mask-position, mask-clip, mask-origin, mask-composite and mask-size.
       * Omitted values are set to their original properties' initial values.
       */
      mask?: CSSWideKeyword | any;

      /**
       * This property is shorthand for setting mask-border-source, mask-border-slice, mask-border-width, mask-border-outset, and mask-border-repeat.
       * Omitted values are set to their original properties' initial values.
       */
      "mask-border"?: CSSWideKeyword | any;

      /**
       * This property specifies how the images for the sides and the middle part of the mask image are scaled and tiled.
       * The first keyword applies to the horizontal sides, the second one applies to the vertical ones.
       * If the second keyword is absent, it is assumed to be the same as the first, similar to the CSS border-image-repeat property.
       */
      "mask-border-repeat"?: CSSWideKeyword | any;

      /**
       * This property specifies inward offsets from the top, right, bottom, and left edges of the mask image,
       * dividing it into nine regions: four corners, four edges, and a middle.
       * The middle image part is discarded and treated as fully transparent black unless the fill keyword is present.
       * The four values set the top, right, bottom and left offsets in that order, similar to the CSS border-image-slice property.
       */
      "mask-border-slice"?: CSSWideKeyword | any;

      /**
       * Specifies an image to be used as a mask. An image that is empty, fails to download, is non-existent, or cannot be displayed is ignored and does not mask the element.
       */
      "mask-border-source"?: CSSWideKeyword | any;

      /**
       * This property sets the width of the mask box image, similar to the CSS border-image-width property.
       */
      "mask-border-width"?: CSSWideKeyword | any;

      /**
       * Determines the mask painting area, which defines the area that is affected by the mask.
       * The painted content of an element may be restricted to this area.
       */
      "mask-clip"?: CSSWideKeyword | any;

      /**
       * For elements rendered as a single box, specifies the mask positioning area.
       * For elements rendered as multiple boxes (e.g., inline boxes on several lines, boxes on several pages)
       * specifies which boxes box-decoration-break operates on to determine the mask positioning area(s).
       */
      "mask-origin"?: CSSWideKeyword | any;

      /**
       * This property must not be used. It is no longer included in any standard or standard track specification,
       * nor is it implemented in any browser. It is only used when the text-align-last property is set to size.
       * It controls allowed adjustments of font-size to fit line content.
       */
      "max-font-size"?: CSSWideKeyword | any;

      /**
       * Sets the maximum height for an element. It prevents the height of the element to exceed the specified value.
       * If min-height is specified and is greater than max-height, max-height is overridden.
       */
      "max-height"?: CSSWideKeyword | any;

      /**
       * Sets the maximum width for an element. It limits the width property to be larger than the value specified in max-width.
       */
      "max-width"?: CSSWideKeyword | any;

      /**
       * Sets the minimum height for an element. It prevents the height of the element to be smaller than the specified value.
       * The value of min-height overrides both max-height and height.
       */
      "min-height"?: CSSWideKeyword | any;

      /**
       * Sets the minimum width of an element. It limits the width property to be not smaller than the value specified in min-width.
       */
      "min-width"?: CSSWideKeyword | any;

      /**
       * Specifies the transparency of an element.
       * See CSS 3 opacity property https://drafts.csswg.org/css-color-3/#opacity
       */
      opacity?: CSSWideKeyword | number;

      /**
       * Specifies the order used to lay out flex items in their flex container.
       * Elements are laid out in the ascending order of the order value.
       * See CSS order property https://drafts.csswg.org/css-flexbox-1/#order-property
       */
      order?: CSSWideKeyword | number;

      /**
       * In paged media, this property defines the minimum number of lines in
       * a block container that must be left at the bottom of the page.
       * See CSS 3 orphans, widows properties https://drafts.csswg.org/css-break-3/#widows-orphans
       */
      orphans?: CSSWideKeyword | number;

      /**
       * The CSS outline property is a shorthand property for setting one or more of the individual outline properties outline-style,
       * outline-width and outline-color in a single rule. In most cases the use of this shortcut is preferable and more convenient.
       * Outlines differ from borders in the following ways:
       *      •       Outlines do not take up space, they are drawn above the content.
       *      •       Outlines may be non-rectangular. They are rectangular in Gecko/Firefox.
       *              Internet Explorer attempts to place the smallest contiguous outline around all elements or shapes that are indicated to have an outline.
       *              Opera draws a non-rectangular shape around a construct.
       */
      outline?: CSSWideKeyword | any;

      /**
       * The outline-color property sets the color of the outline of an element. An outline is a line that is drawn around elements, outside the border edge, to make the element stand out.
       */
      "outline-color"?: CSSWideKeyword | any;

      /**
       * The outline-offset property offsets the outline and draw it beyond the border edge.
       */
      "outline-offset"?: CSSWideKeyword | any;

      /**
       * The overflow property controls how extra content exceeding the bounding box of an element is rendered.
       * It can be used in conjunction with an element that has a fixed width and height, to eliminate text-induced page distortion.
       */
      overflow?: CSSWideKeyword | "auto" | "hidden" | "scroll" | "visible";

      /**
       * Specifies the preferred scrolling methods for elements that overflow.
       */
      "overflow-style"?: CSSWideKeyword | any;

      /**
       * Controls how extra content exceeding the x-axis of the bounding box of an element is rendered.
       */
      overflowX?: CSSWideKeyword | "auto" | "hidden" | "scroll" | "visible";

      /**
       * Controls how extra content exceeding the y-axis of the bounding box of an element is rendered.
       */
      overflowY?: CSSWideKeyword | "auto" | "hidden" | "scroll" | "visible";

      /**
       * The padding optional CSS property sets the required padding space on one to four sides of an element.
       * The padding area is the space between an element and its border. Negative values are not allowed but decimal values are permitted.
       * The element size is treated as fixed, and the content of the element shifts toward the center as padding is increased.
       * The padding property is a shorthand to avoid setting each side separately (padding-top, padding-right, padding-bottom, padding-left).
       */
      padding?: CSSWideKeyword | any;

      /**
       * The padding-bottom CSS property of an element sets the padding space required on the bottom of an element.
       * The padding area is the space between the content of the element and its border.
       * Contrary to margin-bottom values, negative values of padding-bottom are invalid.
       */
      "padding-bottom"?: CSSWideKeyword | any;

      /**
       * The padding-left CSS property of an element sets the padding space required on the left side of an element.
       * The padding area is the space between the content of the element and its border.
       * Contrary to margin-left values, negative values of padding-left are invalid.
       */
      "padding-left"?: CSSWideKeyword | any;

      /**
       * The padding-right CSS property of an element sets the padding space required on the right side of an element.
       * The padding area is the space between the content of the element and its border.
       * Contrary to margin-right values, negative values of padding-right are invalid.
       */
      "padding-right"?: CSSWideKeyword | any;

      /**
       * The padding-top CSS property of an element sets the padding space required on the top of an element.
       * The padding area is the space between the content of the element and its border.
       * Contrary to margin-top values, negative values of padding-top are invalid.
       */
      "padding-top"?: CSSWideKeyword | any;

      /**
       * The page-break-after property is supported in all major browsers. With CSS3, page-break-* properties are only aliases of the break-* properties.
       * The CSS3 Fragmentation spec defines breaks for all CSS box fragmentation.
       */
      "page-break-after"?: CSSWideKeyword | any;

      /**
       * The page-break-before property sets the page-breaking behavior before an element.
       * With CSS3, page-break-* properties are only aliases of the break-* properties.
       * The CSS3 Fragmentation spec defines breaks for all CSS box fragmentation.
       */
      "page-break-before"?: CSSWideKeyword | any;

      /**
       * Sets the page-breaking behavior inside an element. With CSS3, page-break-* properties are only aliases of the break-* properties.
       * The CSS3 Fragmentation spec defines breaks for all CSS box fragmentation.
       */
      "page-break-inside"?: CSSWideKeyword | any;

      /**
       * The pause property determines how long a speech media agent should pause before and after presenting an element.
       * It is a shorthand for the pause-before and pause-after properties.
       */
      pause?: CSSWideKeyword | any;

      /**
       * The pause-after property determines how long a speech media agent should pause after presenting an element.
       * It may be replaced by the shorthand property pause, which sets pause time before and after.
       */
      "pause-after"?: CSSWideKeyword | any;

      /**
       * The pause-before property determines how long a speech media agent should pause before presenting an element.
       * It may be replaced by the shorthand property pause, which sets pause time before and after.
       */
      "pause-before"?: CSSWideKeyword | any;

      /**
       * The perspective property defines how far an element is placed from the view on the z-axis, from the screen to the viewer.
       * Perspective defines how an object is viewed. In graphic arts, perspective is the representation on a flat surface of what the viewer's eye would see in a 3D space.
       * (See Wikipedia for more information about graphical perspective and for related illustrations.)
       * The illusion of perspective on a flat surface, such as a computer screen,
       * is created by projecting points on the flat surface as they would appear if the flat surface were a window
       * through which the viewer was looking at the object. In discussion of virtual environments, this flat surface is called a projection plane.
       */
      perspective?: CSSWideKeyword | any;

      /**
       * The perspective-origin property establishes the origin for the perspective property.
       * It effectively sets the X and Y position at which the viewer appears to be looking at the children of the element.
       * When used with perspective, perspective-origin changes the appearance of an object,
       * as if a viewer were looking at it from a different origin.
       * An object appears differently if a viewer is looking directly at it versus looking at it from below, above, or from the side.
       * Thus, the perspective-origin is like a vanishing point.
       * The default value of perspective-origin is 50% 50%.
       * This displays an object as if the viewer's eye were positioned directly at the center of the screen, both top-to-bottom and left-to-right.
       * A value of 0% 0% changes the object as if the viewer was looking toward the top left angle.
       * A value of 100% 100% changes the appearance as if viewed toward the bottom right angle.
       */
      "perspective-origin"?: CSSWideKeyword | any;

      /**
       * The pointer-events property allows you to control whether an element can be the target for the pointing device (e.g, mouse, pen) events.
       */
      "pointer-events"?: CSSWideKeyword | any;

      /**
       * The position property controls the type of positioning used by an element within its parent elements.
       * The effect of the position property depends on a lot of factors, for example the position property of parent elements.
       */
      position?: CSSWideKeyword | "static" | "relative" | "absolute" | "fixed" | "sticky";

      /**
       * Obsolete: unsupported.
       * This property determines whether or not a full-width punctuation mark character should be trimmed if it appears at the beginning of a line,
       * so that its "ink" lines up with the first glyph in the line above and below.
       */
      "punctuation-trim"?: CSSWideKeyword | any;

      /**
       * Sets the type of quotation marks for embedded quotations.
       */
      quotes?: CSSWideKeyword | any;

      /**
       * Controls whether the last region in a chain displays additional 'overset' content according its default overflow property,
       * or if it displays a fragment of content as if it were flowing into a subsequent region.
       */
      "region-fragment"?: CSSWideKeyword | any;

      /**
       * The rest-after property determines how long a speech media agent should pause after presenting an element's main content,
       * before presenting that element's exit cue sound. It may be replaced by the shorthand property rest, which sets rest time before and after.
       */
      "rest-after"?: CSSWideKeyword | any;

      /**
       * The rest-before property determines how long a speech media agent should pause after presenting an intro cue sound for an element,
       * before presenting that element's main content. It may be replaced by the shorthand property rest, which sets rest time before and after.
       */
      "rest-before"?: CSSWideKeyword | any;

      /**
       * Specifies the position an element in relation to the right side of the containing element.
       */
      right?: CSSWideKeyword | any;

      "ruby-align"?: CSSWideKeyword | any;

      "ruby-position"?: CSSWideKeyword | any;

      /**
       * Defines the alpha channel threshold used to extract a shape from an image. Can be thought of as a "minimum opacity" threshold;
       * that is, a value of 0.5 means that the shape will enclose all the pixels that are more than 50% opaque.
       */
      "shape-image-threshold"?: CSSWideKeyword | any;

      /**
       * A future level of CSS Shapes will define a shape-inside property, which will define a shape to wrap content within the element.
       * See Editor's Draft <http://dev.w3.org/csswg/css-shapes/> and CSSWG wiki page on next-level plans <http://wiki.csswg.org/spec/css-shapes>
       */
      "shape-inside"?: CSSWideKeyword | any;

      /**
       * Adds a margin to a shape-outside. In effect, defines a new shape that is the smallest contour around all the points
       * that are the shape-margin distance outward perpendicular to each point on the underlying shape.
       * For points where a perpendicular direction is not defined (e.g., a triangle corner),
       * takes all points on a circle centered at the point and with a radius of the shape-margin distance.
       * This property accepts only non-negative values.
       */
      "shape-margin"?: CSSWideKeyword | any;

      /**
       * Declares a shape around which text should be wrapped, with possible modifications from the shape-margin property.
       * The shape defined by shape-outside and shape-margin changes the geometry of a float element's float area.
       */
      "shape-outside"?: CSSWideKeyword | any;

      /**
       * The speak property determines whether or not a speech synthesizer will read aloud the contents of an element.
       */
      speak?: CSSWideKeyword | any;

      /**
       * The speak-as property determines how the speech synthesizer interprets the content: words as whole words or as a sequence of letters,
       * numbers as a numerical value or a sequence of digits, punctuation as pauses in speech or named punctuation characters.
       */
      "speak-as"?: CSSWideKeyword | any;

      /**
       * SVG: Specifies the opacity of the outline on the current object.
       * See SVG 1.1 https://www.w3.org/TR/SVG/painting.html#StrokeOpacityProperty
       */
      "stroke-opacity"?: CSSWideKeyword | number;

      /**
       * SVG: Specifies the width of the outline on the current object.
       * See SVG 1.1 https://www.w3.org/TR/SVG/painting.html#StrokeWidthProperty
       */
      "stroke-width"?: CSSWideKeyword | CSSPercentage | CSSLength;

      /**
       * The tab-size CSS property is used to customise the width of a tab (U+0009) character.
       */
      "tab-size"?: CSSWideKeyword | any;

      /**
       * The 'table-layout' property controls the algorithm used to lay out the table cells, rows, and columns.
       */
      "table-layout"?: CSSWideKeyword | any;

      /**
       * The text-align CSS property describes how inline content like text is aligned in its parent block element.
       * text-align does not control the alignment of block elements itself, only their inline content.
       */
      "text-align"?: CSSWideKeyword | any;

      /**
       * The text-align-last CSS property describes how the last line of a block element or a line before line break is aligned in its parent block element.
       */
      "text-align-last"?: CSSWideKeyword | any;

      /**
       * The text-decoration CSS property is used to set the text formatting to underline, overline, line-through or blink.
       * underline and overline decorations are positioned under the text, line-through over it.
       */
      "text-decoration"?: CSSWideKeyword | any;

      /**
       * Sets the color of any text decoration, such as underlines, overlines, and strike throughs.
       */
      "text-decoration-color"?: CSSWideKeyword | any;

      /**
       * Sets what kind of line decorations are added to an element, such as underlines, overlines, etc.
       */
      "text-decoration-line"?: CSSWideKeyword | any;

      "text-decoration-line-through"?: CSSWideKeyword | any;

      "text-decoration-none"?: CSSWideKeyword | any;

      "text-decoration-overline"?: CSSWideKeyword | any;

      /**
       * Specifies what parts of an element’s content are skipped over when applying any text decoration.
       */
      "text-decoration-skip"?: CSSWideKeyword | any;

      /**
       * This property specifies the style of the text decoration line drawn on the specified element.
       * The intended meaning for the values are the same as those of the border-style-properties.
       */
      "text-decoration-style"?: CSSWideKeyword | any;

      "text-decoration-underline"?: CSSWideKeyword | any;

      /**
       * The text-emphasis property will apply special emphasis marks to the elements text.
       * Slightly similar to the text-decoration property only that this property can have affect on the line-height.
       * It also is noted that this is shorthand for text-emphasis-style and for text-emphasis-color.
       */
      "text-emphasis"?: CSSWideKeyword | any;

      /**
       * The text-emphasis-color property specifies the foreground color of the emphasis marks.
       */
      "text-emphasis-color"?: CSSWideKeyword | any;

      /**
       * The text-emphasis-style property applies special emphasis marks to an element's text.
       */
      "text-emphasis-style"?: CSSWideKeyword | any;

      /**
       * This property helps determine an inline box's block-progression dimension,
       * derived from the text-height and font-size properties for non-replaced elements,
       * the height or the width for replaced elements, and the stacked block-progression dimension for inline-block elements.
       * The block-progression dimension determines the position of the padding, border and margin for the element.
       */
      "text-height"?: CSSWideKeyword | any;

      /**
       * Specifies the amount of space horizontally that should be left on the first line of the text of an element.
       * This horizontal spacing is at the beginning of the first line and is in respect to the left edge of the containing block box.
       */
      "text-indent"?: CSSWideKeyword | any;

      "text-justify-trim"?: CSSWideKeyword | any;

      "text-kashida-space"?: CSSWideKeyword | any;

      /**
       * The text-line-through property is a shorthand property for text-line-through-style, text-line-through-color and text-line-through-mode.
       * (Considered obsolete; use text-decoration instead.)
       */
      "text-line-through"?: CSSWideKeyword | any;

      /**
       * Specifies the line colors for the line-through text decoration.
       * (Considered obsolete; use text-decoration-color instead.)
       */
      "text-line-through-color"?: CSSWideKeyword | any;

      /**
       * Sets the mode for the line-through text decoration, determining whether the text decoration affects the space characters or not.
       * (Considered obsolete; use text-decoration-skip instead.)
       */
      "text-line-through-mode"?: CSSWideKeyword | any;

      /**
       * Specifies the line style for line-through text decoration.
       * (Considered obsolete; use text-decoration-style instead.)
       */
      "text-line-through-style"?: CSSWideKeyword | any;

      /**
       * Specifies the line width for the line-through text decoration.
       */
      "text-line-through-width"?: CSSWideKeyword | any;

      /**
       * The text-overflow shorthand CSS property determines how overflowed content that is not displayed is signaled to the users.
       * It can be clipped, display an ellipsis ('…', U+2026 HORIZONTAL ELLIPSIS) or a Web author-defined string.
       * It covers the two long-hand properties text-overflow-mode and text-overflow-ellipsis
       */
      "text-overflow"?: CSSWideKeyword | any;

      /**
       * The text-overline property is the shorthand for the text-overline-style, text-overline-width, text-overline-color, and text-overline-mode properties.
       */
      "text-overline"?: CSSWideKeyword | any;

      /**
       * Specifies the line color for the overline text decoration.
       */
      "text-overline-color"?: CSSWideKeyword | any;

      /**
       * Sets the mode for the overline text decoration, determining whether the text decoration affects the space characters or not.
       */
      "text-overline-mode"?: CSSWideKeyword | any;

      /**
       * Specifies the line style for overline text decoration.
       */
      "text-overline-style"?: CSSWideKeyword | any;

      /**
       * Specifies the line width for the overline text decoration.
       */
      "text-overline-width"?: CSSWideKeyword | any;

      /**
       * The text-rendering CSS property provides information to the browser about how to optimize when rendering text.
       * Options are: legibility, speed or geometric precision.
       */
      "text-rendering"?: CSSWideKeyword | any;

      /**
       * Obsolete: unsupported.
       */
      "text-script"?: CSSWideKeyword | any;

      /**
       * The CSS text-shadow property applies one or more drop shadows to the text and <text-decorations> of an element.
       * Each shadow is specified as an offset from the text, along with optional color and blur radius values.
       */
      "text-shadow"?: CSSWideKeyword | any;

      /**
       * This property transforms text for styling purposes. (It has no effect on the underlying content.)
       */
      "text-transform"?: CSSWideKeyword | any;

      /**
       * Unsupported.
       * This property will add a underline position value to the element that has an underline defined.
       */
      "text-underline-position"?: CSSWideKeyword | any;

      /**
       * After review this should be replaced by text-decoration should it not?
       * This property will set the underline style for text with a line value for underline, overline, and line-through.
       */
      "text-underline-style"?: CSSWideKeyword | any;

      /**
       * This property specifies how far an absolutely positioned box's top margin edge is offset below the top edge of the box's containing block.
       * For relatively positioned boxes, the offset is with respect to the top edges of the box itself (i.e., the box is given a position in the normal flow,
       * then offset from that position according to these properties).
       */
      top?: CSSWideKeyword | any;

      /**
       * Determines whether touch input may trigger default behavior supplied by the user agent, such as panning or zooming.
       */
      "touch-action"?: CSSWideKeyword | any;

      /**
       * CSS transforms allow elements styled with CSS to be transformed in two-dimensional or three-dimensional space.
       * Using this property, elements can be translated, rotated, scaled, and skewed. The value list may consist of 2D and/or 3D transform values.
       */
      transform?: CSSWideKeyword | any;

      /**
       * This property defines the origin of the transformation axes relative to the element to which the transformation is applied.
       */
      "transform-origin"?: CSSWideKeyword | any;

      /**
       * This property allows you to define the relative position of the origin of the transformation grid along the z-axis.
       */
      "transform-origin-z"?: CSSWideKeyword | any;

      /**
       * This property specifies how nested elements are rendered in 3D space relative to their parent.
       */
      "transform-style"?: CSSWideKeyword | any;

      /**
       * The transition CSS property is a shorthand property for transition-property, transition-duration, transition-timing-function,
       * and transition-delay. It allows to define the transition between two states of an element.
       */
      transition?: CSSWideKeyword | any;

      /**
       * Defines when the transition will start. A value of ‘0s’ means the transition will execute as soon as the property is changed.
       * Otherwise, the value specifies an offset from the moment the property is changed, and the transition will delay execution by that offset.
       */
      "transition-delay"?: CSSWideKeyword | any;

      /**
       * The 'transition-duration' property specifies the length of time a transition animation takes to complete.
       */
      "transition-duration"?: CSSWideKeyword | any;

      /**
       * The 'transition-property' property specifies the name of the CSS property to which the transition is applied.
       */
      "transition-property"?: CSSWideKeyword | any;

      /**
       * Sets the pace of action within a transition
       */
      "transition-timing-function"?: CSSWideKeyword | any;

      /**
       * The unicode-bidi CSS property specifies the level of embedding with respect to the bidirectional algorithm.
       */
      "unicode-bidi"?: CSSWideKeyword | any;

      /**
       * unicode-range allows you to set a specific range of characters to be downloaded from a font (embedded using @font-face) and made available for use on the current page.
       */
      "unicode-range"?: CSSWideKeyword | any;

      /**
       * This is for all the high level UX stuff.
       */
      "user-focus"?: CSSWideKeyword | any;

      /**
       * For inputing user content
       */
      "user-input"?: CSSWideKeyword | any;

      /**
       * The vertical-align property controls how inline elements or text are vertically aligned compared to the baseline.
       * If this property is used on table-cells it controls the vertical alignment of content of the table cell.
       */
      "vertical-align"?: CSSWideKeyword | any;

      /**
       * The visibility property specifies whether the boxes generated by an element are rendered.
       */
      visibility?: CSSWideKeyword | any;

      /**
       * The voice-balance property sets the apparent position (in stereo sound) of the synthesized voice for spoken media.
       */
      "voice-balance"?: CSSWideKeyword | any;

      /**
       * The voice-duration property allows the author to explicitly set the amount of time it should take a speech synthesizer to read an element's content,
       * for example to allow the speech to be synchronized with other media.
       * With a value of auto (the default) the length of time it takes to read the content is determined by the content itself and the voice-rate property.
       */
      "voice-duration"?: CSSWideKeyword | any;

      /**
       * The voice-family property sets the speaker's voice used by a speech media agent to read an element.
       * The speaker may be specified as a named character (to match a voice option in the speech reading software)
       * or as a generic description of the age and gender of the voice.
       * Similar to the font-family property for visual media,
       * a comma-separated list of fallback options may be given in case the speech reader does not recognize the character name
       * or cannot synthesize the requested combination of generic properties.
       */
      "voice-family"?: CSSWideKeyword | any;

      /**
       * The voice-pitch property sets pitch or tone (high or low) for the synthesized speech when reading an element;
       * the pitch may be specified absolutely or relative to the normal pitch for the voice-family used to read the text.
       */
      "voice-pitch"?: CSSWideKeyword | any;

      /**
       * The voice-range property determines how much variation in pitch or tone will be created by the speech synthesize when reading an element.
       * Emphasized text, grammatical structures and punctuation may all be rendered as changes in pitch,
       * this property determines how strong or obvious those changes are;
       * large ranges are associated with enthusiastic or emotional speech,
       * while small ranges are associated with flat or mechanical speech.
       */
      "voice-range"?: CSSWideKeyword | any;

      /**
       * The voice-rate property sets the speed at which the voice synthesized by a speech media agent will read content.
       */
      "voice-rate"?: CSSWideKeyword | any;

      /**
       * The voice-stress property sets the level of vocal emphasis to be used for synthesized speech reading the element.
       */
      "voice-stress"?: CSSWideKeyword | any;

      /**
       * The voice-volume property sets the volume for spoken content in speech media. It replaces the deprecated volume property.
       */
      "voice-volume"?: CSSWideKeyword | any;

      /**
       * The white-space property controls whether and how white space inside the element is collapsed, and whether lines may wrap at unforced "soft wrap" opportunities.
       */
      "white-space"?: CSSWideKeyword | any;

      /**
       * Obsolete: unsupported.
       */
      "white-space-treatment"?: CSSWideKeyword | any;

      /**
       * In paged media, this property defines the mimimum number of lines
       * that must be left at the top of the second page.
       * See CSS 3 orphans, widows properties https://drafts.csswg.org/css-break-3/#widows-orphans
       */
      widows?: CSSWideKeyword | number;

      /**
       * Specifies the width of the content area of an element. The content area of the element width does not include the padding, border, and margin of the element.
       */
      width?: CSSWideKeyword | any;

      /**
       * The word-break property is often used when there is long generated content that is strung together without and spaces or hyphens to beak apart.
       * A common case of this is when there is a long URL that does not have any hyphens. This case could potentially cause the breaking of the layout as it could extend past the parent element.
       */
      "word-break"?: CSSWideKeyword | any;

      /**
       * The word-spacing CSS property specifies the spacing behavior between "words".
       */
      "word-spacing"?: CSSWideKeyword | any;

      /**
       * An alias of css/properties/overflow-wrap, word-wrap defines whether to break words when the content exceeds the boundaries of its container.
       */
      "word-wrap"?: CSSWideKeyword | any;

      /**
       * Specifies how exclusions affect inline content within block-level elements. Elements lay out their inline content in their content area but wrap around exclusion areas.
       */
      "wrap-flow"?: CSSWideKeyword | any;

      /**
       * Set the value that is used to offset the inner wrap shape from other shapes. Inline content that intersects a shape with this property will be pushed by this shape's margin.
       */
      "wrap-margin"?: CSSWideKeyword | any;

      /**
       * Obsolete and unsupported. Do not use.
       * This CSS property controls the text when it reaches the end of the block in which it is enclosed.
       */
      "wrap-option"?: CSSWideKeyword | any;

      /**
       * writing-mode specifies if lines of text are laid out horizontally or vertically, and the direction which lines of text and blocks progress.
       */
      "writing-mode"?: CSSWideKeyword | any;

      /**
       * The z-index property specifies the z-order of an element and its descendants.
       * When elements overlap, z-order determines which one covers the other.
       * See CSS 2 z-index property https://www.w3.org/TR/CSS2/visuren.html#z-index
       */
      "z-index"?: CSSWideKeyword | "auto" | number;

      /**
       * Sets the initial zoom factor of a document defined by @viewport.
       * See CSS zoom descriptor https://drafts.csswg.org/css-device-adapt/#zoom-desc
       */
      zoom?: CSSWideKeyword | "auto" | number | CSSPercentage;

      [propertyName: string]: any;
    }

    type HTMLAutocapitalize = "off" | "none" | "on" | "sentences" | "words" | "characters";

    type HTMLDir = "ltr" | "rtl" | "auto";

    type HTMLFormEncType =
      | "application/x-www-form-urlencoded"
      | "multipart/form-data"
      | "text/plain";

    type HTMLFormMethod = "post" | "get" | "dialog";

    type HTMLCrossorigin = "anonymous" | "use-credentials" | "";

    type HTMLReferrerPolicy =
      | "no-referrer"
      | "no-referrer-when-downgrade"
      | "origin"
      | "origin-when-cross-origin"
      | "same-origin"
      | "strict-origin"
      | "strict-origin-when-cross-origin"
      | "unsafe-url";

    type HTMLIframeSandbox =
      | "allow-downloads-without-user-activation"
      | "allow-forms"
      | "allow-modals"
      | "allow-orientation-lock"
      | "allow-pointer-lock"
      | "allow-popups"
      | "allow-popups-to-escape-sandbox"
      | "allow-presentation"
      | "allow-same-origin"
      | "allow-scripts"
      | "allow-storage-access-by-user-activation"
      | "allow-top-navigation"
      | "allow-top-navigation-by-user-activation";

    type HTMLLinkAs =
      | "audio"
      | "document"
      | "embed"
      | "fetch"
      | "font"
      | "image"
      | "object"
      | "script"
      | "style"
      | "track"
      | "video"
      | "worker";

    interface HTMLAttributes<T> extends DOMAttributes<T> {
      // Standard HTML Attributes
      accessKey?: string;
      className?: string;
      class?: string;
      contentEditable?: boolean | "inherit";
      contextMenu?: string;
      dir?: HTMLDir;
      draggable?: boolean;
      hidden?: boolean;
      id?: string;
      lang?: string;
      spellcheck?: boolean;
      style?: CSSProperties | string;
      tabIndex?: number | string;
      tabindex?: number | string;
      title?: string;
      translate?: "yes" | "no";

      // RDFa Attributes
      about?: string;
      datatype?: string;
      inlist?: any;
      prefix?: string;
      property?: string;
      resource?: string;
      typeof?: string;
      vocab?: string;

      // Non-standard Attributes
      autoCapitalize?: HTMLAutocapitalize;
      color?: string;
      itemProp?: string;
      itemScope?: boolean;
      itemType?: string;
      itemId?: string;
      itemRef?: string;

      // others
      align?: "start" | "end" | "center" | "baseline" | "stretch" | "left" | "right";
      part?: string;
      exportparts?: string;
    }

    // HTML Elements

    interface AnchorHTMLAttributes<T> extends HTMLAttributes<T> {
      download?: any;
      href?: string;
      hreflang?: string;
      media?: string;
      ping?: string;
      referrerPolicy?: HTMLReferrerPolicy;
      rel?: string;
      target?: string;
      type?: string;
    }

    interface AudioHTMLAttributes<T> extends MediaHTMLAttributes<T> {}

    interface AreaHTMLAttributes<T> extends HTMLAttributes<T> {
      alt?: string;
      coords?: string;
      download?: any;
      href?: string;
      hreflang?: string;
      ping?: string;
      referrerPolicy?: HTMLReferrerPolicy;
      rel?: string;
      shape?: "rect" | "circle" | "poly" | "default";
      target?: string;
    }

    interface BaseHTMLAttributes<T> extends HTMLAttributes<T> {
      href?: string;
      target?: string;
    }

    interface BlockquoteHTMLAttributes<T> extends HTMLAttributes<T> {
      cite?: string;
    }

    interface ButtonHTMLAttributes<T> extends HTMLAttributes<T> {
      autofocus?: boolean;
      disabled?: boolean;
      form?: string;
      formAction?: string;
      formEnctype?: HTMLFormEncType;
      formMethod?: HTMLFormMethod;
      formNoValidate?: boolean;
      formTarget?: string;
      name?: string;
      type?: "submit" | "reset" | "button";
      value?: string;
    }

    interface CanvasHTMLAttributes<T> extends HTMLAttributes<T> {
      width?: number | string;
      height?: number | string;
    }

    interface ColHTMLAttributes<T> extends HTMLAttributes<T> {
      span?: number | string;
      width?: number | string;
    }

    interface ColgroupHTMLAttributes<T> extends HTMLAttributes<T> {
      span?: number | string;
    }

    interface DataHTMLAttributes<T> extends HTMLAttributes<T> {
      value?: string | string[] | number;
    }

    interface DetailsHtmlAttributes<T> extends HTMLAttributes<T> {
      open?: boolean;
    }

    interface DialogHtmlAttributes<T> extends HTMLAttributes<T> {
      open?: boolean;
    }

    interface EmbedHTMLAttributes<T> extends HTMLAttributes<T> {
      height?: number | string;
      src?: string;
      type?: string;
      width?: number | string;
    }

    interface FieldsetHTMLAttributes<T> extends HTMLAttributes<T> {
      disabled?: boolean;
      form?: string;
      name?: string;
    }

    interface FormHTMLAttributes<T> extends HTMLAttributes<T> {
      acceptCharset?: string;
      action?: string;
      autocomplete?: string;
      encoding?: HTMLFormEncType;
      enctype?: HTMLFormEncType;
      method?: HTMLFormMethod;
      name?: string;
      noValidate?: boolean;
      target?: string;
    }

    interface IframeHTMLAttributes<T> extends HTMLAttributes<T> {
      allow?: string;
      allowfullscreen?: boolean;
      height?: number | string;
      name?: string;
      referrerPolicy?: HTMLReferrerPolicy;
      sandbox?: HTMLIframeSandbox;
      src?: string;
      srcdoc?: string;
      width?: number | string;
    }

    interface ImgHTMLAttributes<T> extends HTMLAttributes<T> {
      alt?: string;
      crossOrigin?: HTMLCrossorigin;
      decoding?: "sync" | "async" | "auto";
      height?: number | string;
      referrerPolicy?: HTMLReferrerPolicy;
      sizes?: string;
      src?: string;
      srcset?: string;
      width?: number | string;
    }

    interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
      accept?: string;
      alt?: string;
      autocomplete?: string;
      autofocus?: boolean;
      capture?: boolean | string;
      checked?: boolean;
      crossOrigin?: HTMLCrossorigin;
      disabled?: boolean;
      form?: string;
      formAction?: string;
      formEnctype?: HTMLFormEncType;
      formMethod?: HTMLFormMethod;
      formNoValidate?: boolean;
      formTarget?: string;
      height?: number | string;
      list?: string;
      max?: number | string;
      maxLength?: number | string;
      min?: number | string;
      minLength?: number | string;
      multiple?: boolean;
      name?: string;
      pattern?: string;
      placeholder?: string;
      readOnly?: boolean;
      required?: boolean;
      size?: number | string;
      src?: string;
      step?: number | string;
      type?: string;
      value?: string | string[] | number;
      width?: number | string;
    }

    interface InsHTMLAttributes<T> extends HTMLAttributes<T> {
      cite?: string;
      dateTime?: string;
    }

    interface KeygenHTMLAttributes<T> extends HTMLAttributes<T> {
      autofocus?: boolean;
      challenge?: string;
      disabled?: boolean;
      form?: string;
      keytype?: string;
      keyparams?: string;
      name?: string;
    }

    interface LabelHTMLAttributes<T> extends HTMLAttributes<T> {
      htmlFor?: string;
      for?: string;
      form?: string;
    }

    interface LiHTMLAttributes<T> extends HTMLAttributes<T> {
      value?: number | string;
    }

    interface LinkHTMLAttributes<T> extends HTMLAttributes<T> {
      as?: HTMLLinkAs;
      crossOrigin?: HTMLCrossorigin;
      disabled?: boolean;
      href?: string;
      hreflang?: string;
      integrity?: string;
      media?: string;
      referrerPolicy?: HTMLReferrerPolicy;
      rel?: string;
      sizes?: string;
      type?: string;
    }

    interface MapHTMLAttributes<T> extends HTMLAttributes<T> {
      name?: string;
    }

    interface MediaHTMLAttributes<T> extends HTMLAttributes<T> {
      autoplay?: boolean;
      controls?: boolean;
      crossOrigin?: HTMLCrossorigin;
      loop?: boolean;
      mediaGroup?: string;
      muted?: boolean;
      preload?: "none" | "metadata" | "auto" | "";
      src?: string;
    }

    interface MenuHTMLAttributes<T> extends HTMLAttributes<T> {
      label?: string;
      type?: "context" | "toolbar";
    }

    interface MetaHTMLAttributes<T> extends HTMLAttributes<T> {
      charset?: string;
      content?: string;
      httpEquiv?: string;
      name?: string;
    }

    interface MeterHTMLAttributes<T> extends HTMLAttributes<T> {
      form?: string;
      high?: number | string;
      low?: number | string;
      max?: number | string;
      min?: number | string;
      optimum?: number | string;
      value?: string | string[] | number;
    }

    interface QuoteHTMLAttributes<T> extends HTMLAttributes<T> {
      cite?: string;
    }

    interface ObjectHTMLAttributes<T> extends HTMLAttributes<T> {
      data?: string;
      form?: string;
      height?: number | string;
      name?: string;
      type?: string;
      useMap?: string;
      width?: number | string;
    }

    interface OlHTMLAttributes<T> extends HTMLAttributes<T> {
      reversed?: boolean;
      start?: number | string;
      type?: "1" | "a" | "A" | "i" | "I";
    }

    interface OptgroupHTMLAttributes<T> extends HTMLAttributes<T> {
      disabled?: boolean;
      label?: string;
    }

    interface OptionHTMLAttributes<T> extends HTMLAttributes<T> {
      disabled?: boolean;
      label?: string;
      selected?: boolean;
      value?: string | string[] | number;
    }

    interface OutputHTMLAttributes<T> extends HTMLAttributes<T> {
      form?: string;
      htmlFor?: string;
      name?: string;
    }

    interface ParamHTMLAttributes<T> extends HTMLAttributes<T> {
      name?: string;
      value?: string | string[] | number;
    }

    interface ProgressHTMLAttributes<T> extends HTMLAttributes<T> {
      max?: number | string;
      value?: string | string[] | number;
    }

    interface ScriptHTMLAttributes<T> extends HTMLAttributes<T> {
      async?: boolean;
      charset?: string;
      crossOrigin?: HTMLCrossorigin;
      defer?: boolean;
      integrity?: string;
      noModule?: boolean;
      nonce?: string;
      referrerPolicy?: HTMLReferrerPolicy;
      src?: string;
      type?: string;
    }

    interface SelectHTMLAttributes<T> extends HTMLAttributes<T> {
      autocomplete?: string;
      autofocus?: boolean;
      disabled?: boolean;
      form?: string;
      multiple?: boolean;
      name?: string;
      required?: boolean;
      size?: number | string;
      value?: string | string[] | number;
    }

    interface HTMLSlotElementAttributes<T = HTMLSlotElement> extends HTMLAttributes<T> {
      name?: string;
    }

    interface SourceHTMLAttributes<T> extends HTMLAttributes<T> {
      media?: string;
      sizes?: string;
      src?: string;
      srcset?: string;
      type?: string;
    }

    interface StyleHTMLAttributes<T> extends HTMLAttributes<T> {
      media?: string;
      nonce?: string;
      scoped?: boolean;
      type?: string;
    }

    interface TdHTMLAttributes<T> extends HTMLAttributes<T> {
      colSpan?: number | string;
      headers?: string;
      rowSpan?: number | string;
    }

    interface TextareaHTMLAttributes<T> extends HTMLAttributes<T> {
      autocomplete?: string;
      autofocus?: boolean;
      cols?: number | string;
      dirname?: string;
      disabled?: boolean;
      form?: string;
      maxLength?: number | string;
      minLength?: number | string;
      name?: string;
      placeholder?: string;
      readOnly?: boolean;
      required?: boolean;
      rows?: number | string;
      value?: string | string[] | number;
      wrap?: "hard" | "soft" | "off";
    }

    interface ThHTMLAttributes<T> extends HTMLAttributes<T> {
      colSpan?: number | string;
      headers?: string;
      rowSpan?: number | string;
    }

    interface TimeHTMLAttributes<T> extends HTMLAttributes<T> {
      dateTime?: string;
    }

    interface TrackHTMLAttributes<T> extends HTMLAttributes<T> {
      default?: boolean;
      kind?: "subtitles" | "captions" | "descriptions" | "chapters" | "metadata";
      label?: string;
      src?: string;
      srclang?: string;
    }

    interface VideoHTMLAttributes<T> extends MediaHTMLAttributes<T> {
      height?: number | string;
      playsinline?: boolean;
      poster?: string;
      width?: number | string;
    }

    // SVG Elements

    type SVGPreserveAspectRatio =
      | "none"
      | "xMinYMin"
      | "xMidYMin"
      | "xMaxYMin"
      | "xMinYMid"
      | "xMidYMid"
      | "xMaxYMid"
      | "xMinYMax"
      | "xMidYMax"
      | "xMaxYMax"
      | "xMinYMin meet"
      | "xMidYMin meet"
      | "xMaxYMin meet"
      | "xMinYMid meet"
      | "xMidYMid meet"
      | "xMaxYMid meet"
      | "xMinYMax meet"
      | "xMidYMax meet"
      | "xMaxYMax meet"
      | "xMinYMin slice"
      | "xMidYMin slice"
      | "xMaxYMin slice"
      | "xMinYMid slice"
      | "xMidYMid slice"
      | "xMaxYMid slice"
      | "xMinYMax slice"
      | "xMidYMax slice"
      | "xMaxYMax slice";

    type ImagePreserveAspectRatio =
      | SVGPreserveAspectRatio
      | "defer none"
      | "defer xMinYMin"
      | "defer xMidYMin"
      | "defer xMaxYMin"
      | "defer xMinYMid"
      | "defer xMidYMid"
      | "defer xMaxYMid"
      | "defer xMinYMax"
      | "defer xMidYMax"
      | "defer xMaxYMax"
      | "defer xMinYMin meet"
      | "defer xMidYMin meet"
      | "defer xMaxYMin meet"
      | "defer xMinYMid meet"
      | "defer xMidYMid meet"
      | "defer xMaxYMid meet"
      | "defer xMinYMax meet"
      | "defer xMidYMax meet"
      | "defer xMaxYMax meet"
      | "defer xMinYMin slice"
      | "defer xMidYMin slice"
      | "defer xMaxYMin slice"
      | "defer xMinYMid slice"
      | "defer xMidYMid slice"
      | "defer xMaxYMid slice"
      | "defer xMinYMax slice"
      | "defer xMidYMax slice"
      | "defer xMaxYMax slice";

    type SVGUnits = "userSpaceOnUse" | "objectBoundingBox";

    interface CoreSVGAttributes<T> extends DOMAttributes<T> {
      id?: string;
      lang?: string;
      tabIndex?: number | string;
      tabindex?: number | string;
    }

    interface StylableSVGAttributes {
      class?: string;
      className?: string;
      style?: CSSProperties | string;
    }

    interface TransformableSVGAttributes {
      transform?: string;
    }

    interface XLinkSVGAttributes {
      xlinkActuate?: string;
      xlinkArcrole?: string;
      xlinkHref?: string;
      xlinkRole?: string;
      xlinkShow?: string;
      xlinkTitle?: string;
      xlinkType?: string;
    }

    interface ConditionalProcessingSVGAttributes {
      requiredExtensions?: string;
      requiredFeatures?: string;
      systemLanguage?: string;
    }

    interface ExternalResourceSVGAttributes {
      externalResourcesRequired?: "true" | "false";
    }

    interface AnimationTimingSVGAttributes {
      begin?: string;
      dur?: string;
      end?: string;
      min?: string;
      max?: string;
      restart?: "always" | "whenNotActive" | "never";
      repeatCount?: number | "indefinite";
      repeatDur?: string;
      fill?: "freeze" | "remove";
    }

    interface AnimationValueSVGAttributes {
      calcMode?: "discrete" | "linear" | "paced" | "spline";
      values?: string;
      keyTimes?: string;
      keySplines?: string;
      from?: number | string;
      to?: number | string;
      by?: number | string;
    }

    interface AnimationAdditionSVGAttributes {
      attributeName?: string;
      additive?: "replace" | "sum";
      accumulate?: "none" | "sum";
    }

    interface AnimationAttributeTargetSVGAttributes {
      attributeName?: string;
      attributeType?: "CSS" | "XML" | "auto";
    }

    interface PresentationSVGAttributes {
      alignmentBaseline?:
        | "auto"
        | "baseline"
        | "before-edge"
        | "text-before-edge"
        | "middle"
        | "central"
        | "after-edge"
        | "text-after-edge"
        | "ideographic"
        | "alphabetic"
        | "hanging"
        | "mathematical"
        | "inherit";
      baselineShift?: number | string;
      clip?: string;
      clipPath?: string;
      clipRule?: "nonzero" | "evenodd" | "inherit";
      color?: string;
      colorInterpolation?: "auto" | "sRGB" | "linearRGB" | "inherit";
      colorInterpolationFilters?: "auto" | "sRGB" | "linearRGB" | "inherit";
      colorProfile?: string;
      colorRendering?: "auto" | "optimizeSpeed" | "optimizeQuality" | "inherit";
      cursor?: string;
      direction?: "ltr" | "rtl" | "inherit";
      display?: string;
      dominantBaseline?:
        | "auto"
        | "text-bottom"
        | "alphabetic"
        | "ideographic"
        | "middle"
        | "central"
        | "mathematical"
        | "hanging"
        | "text-top"
        | "inherit";
      enableBackground?: string;
      fill?: string;
      fillOpacity?: number | string | "inherit";
      fillRule?: "nonzero" | "evenodd" | "inherit";
      filter?: string;
      floodColor?: string;
      floodOpacity?: number | string | "inherit";
      fontFamily?: string;
      fontSize?: string;
      fontSizeAdjust?: number | string;
      fontStretch?: string;
      fontStyle?: "normal" | "italic" | "oblique" | "inherit";
      fontVariant?: string;
      fontWeight?: number | string;
      glyphOrientationHorizontal?: string;
      glyphOrientationVertical?: string;
      imageRendering?: "auto" | "optimizeQuality" | "optimizeSpeed" | "inherit";
      kerning?: string;
      letterSpacing?: number | string;
      lightingColor?: string;
      markerEnd?: string;
      markerMid?: string;
      markerStart?: string;
      mask?: string;
      opacity?: number | string | "inherit";
      overflow?: "visible" | "hidden" | "scroll" | "auto" | "inherit";
      pointerEvents?:
        | "bounding-box"
        | "visiblePainted"
        | "visibleFill"
        | "visibleStroke"
        | "visible"
        | "painted"
        | "color"
        | "fill"
        | "stroke"
        | "all"
        | "none"
        | "inherit";
      shapeRendering?: "auto" | "optimizeSpeed" | "crispEdges" | "geometricPrecision" | "inherit";
      stopColor?: string;
      stopOpacity?: number | string | "inherit";
      stroke?: string;
      strokeDasharray?: string;
      strokeDashoffset?: number | string;
      strokeLinecap?: "butt" | "round" | "square" | "inherit";
      strokeLinejoin?: "arcs" | "bevel" | "miter" | "miter-clip" | "round" | "inherit";
      strokeMiterlimit?: number | string | "inherit";
      strokeOpacity?: number | string | "inherit";
      strokeWidth?: number | string;
      textAnchor?: "start" | "middle" | "end" | "inherit";
      textDecoration?: "none" | "underline" | "overline" | "line-through" | "blink" | "inherit";
      textRendering?:
        | "auto"
        | "optimizeSpeed"
        | "optimizeLegibility"
        | "geometricPrecision"
        | "inherit";
      unicodeBidi?: string;
      visibility?: "visible" | "hidden" | "collapse" | "inherit";
      wordSpacing?: number | string;
      writingMode?: "lr-tb" | "rl-tb" | "tb-rl" | "lr" | "rl" | "tb" | "inherit";
    }

    interface AnimationElementSVGAttributes<T>
      extends CoreSVGAttributes<T>,
        ExternalResourceSVGAttributes,
        ConditionalProcessingSVGAttributes {}

    interface ContainerElementSVGAttributes<T>
      extends CoreSVGAttributes<T>,
        Pick<
          PresentationSVGAttributes,
          | "clipPath"
          | "mask"
          | "cursor"
          | "opacity"
          | "filter"
          | "enableBackground"
          | "colorInterpolation"
          | "colorRendering"
        > {}

    interface FilterPrimitiveElementSVGAttributes<T>
      extends CoreSVGAttributes<T>,
        Pick<PresentationSVGAttributes, "colorInterpolationFilters"> {
      x?: number | string;
      y?: number | string;
      width?: number | string;
      height?: number | string;
      result?: string;
    }

    interface SingleInputFilterSVGAttributes {
      in?: string;
    }

    interface DoubleInputFilterSVGAttributes {
      in?: string;
      in2?: string;
    }

    interface FitToViewBoxSVGAttributes {
      viewBox?: string;
      preserveAspectRatio?: SVGPreserveAspectRatio;
    }

    interface GradientElementSVGAttributes<T>
      extends CoreSVGAttributes<T>,
        XLinkSVGAttributes,
        ExternalResourceSVGAttributes,
        StylableSVGAttributes {
      gradientUnits?: SVGUnits;
      gradientTransform?: string;
      spreadMethod?: "pad" | "reflect" | "repeat";
    }

    interface GraphicsElementSVGAttributes<T>
      extends CoreSVGAttributes<T>,
        Pick<
          PresentationSVGAttributes,
          | "clipRule"
          | "mask"
          | "pointerEvents"
          | "cursor"
          | "opacity"
          | "filter"
          | "display"
          | "visibility"
          | "colorInterpolation"
          | "colorRendering"
        > {}

    interface LightSourceElementSVGAttributes<T> extends CoreSVGAttributes<T> {}

    interface NewViewportSVGAttributes<T>
      extends CoreSVGAttributes<T>,
        Pick<PresentationSVGAttributes, "overflow" | "clip"> {
      viewBox?: string;
    }

    interface ShapeElementSVGAttributes<T>
      extends CoreSVGAttributes<T>,
        Pick<
          PresentationSVGAttributes,
          | "color"
          | "fill"
          | "fillRule"
          | "fillOpacity"
          | "stroke"
          | "strokeWidth"
          | "strokeLinecap"
          | "strokeLinejoin"
          | "strokeMiterlimit"
          | "strokeDasharray"
          | "strokeDashoffset"
          | "strokeOpacity"
          | "shapeRendering"
        > {}

    interface TextContentElementSVGAttributes<T>
      extends CoreSVGAttributes<T>,
        Pick<
          PresentationSVGAttributes,
          | "fontFamily"
          | "fontStyle"
          | "fontVariant"
          | "fontWeight"
          | "fontStretch"
          | "fontSize"
          | "fontSizeAdjust"
          | "kerning"
          | "letterSpacing"
          | "wordSpacing"
          | "textDecoration"
          | "glyphOrientationHorizontal"
          | "glyphOrientationVertical"
          | "direction"
          | "unicodeBidi"
          | "textAnchor"
          | "dominantBaseline"
          | "color"
          | "fill"
          | "fillRule"
          | "fillOpacity"
          | "stroke"
          | "strokeWidth"
          | "strokeLinecap"
          | "strokeLinejoin"
          | "strokeMiterlimit"
          | "strokeDasharray"
          | "strokeDashoffset"
          | "strokeOpacity"
        > {}

    interface ZoomAndPanSVGAttributes {
      zoomAndPan?: "disable" | "magnify";
    }

    interface AnimateSVGAttributes<T>
      extends AnimationElementSVGAttributes<T>,
        XLinkSVGAttributes,
        AnimationAttributeTargetSVGAttributes,
        AnimationTimingSVGAttributes,
        AnimationValueSVGAttributes,
        AnimationAdditionSVGAttributes,
        Pick<PresentationSVGAttributes, "colorInterpolation" | "colorRendering"> {}

    interface AnimateMotionSVGAttributes<T>
      extends AnimationElementSVGAttributes<T>,
        XLinkSVGAttributes,
        AnimationTimingSVGAttributes,
        AnimationValueSVGAttributes,
        AnimationAdditionSVGAttributes {
      path?: string;
      keyPoints?: string;
      rotate?: number | string | "auto" | "auto-reverse";
      origin?: "default";
    }

    interface AnimateTransformSVGAttributes<T>
      extends AnimationElementSVGAttributes<T>,
        XLinkSVGAttributes,
        AnimationAttributeTargetSVGAttributes,
        AnimationTimingSVGAttributes,
        AnimationValueSVGAttributes,
        AnimationAdditionSVGAttributes {
      type?: "translate" | "scale" | "rotate" | "skewX" | "skewY";
    }

    interface CircleSVGAttributes<T>
      extends GraphicsElementSVGAttributes<T>,
        ShapeElementSVGAttributes<T>,
        ConditionalProcessingSVGAttributes,
        StylableSVGAttributes,
        TransformableSVGAttributes {
      cx?: number | string;
      cy?: number | string;
      r?: number | string;
    }

    interface ClipPathSVGAttributes<T>
      extends CoreSVGAttributes<T>,
        ConditionalProcessingSVGAttributes,
        ExternalResourceSVGAttributes,
        StylableSVGAttributes,
        TransformableSVGAttributes,
        Pick<PresentationSVGAttributes, "clipPath"> {
      clipPathUnits?: SVGUnits;
    }

    interface DefsSVGAttributes<T>
      extends ContainerElementSVGAttributes<T>,
        ConditionalProcessingSVGAttributes,
        ExternalResourceSVGAttributes,
        StylableSVGAttributes,
        TransformableSVGAttributes {}

    interface DescSVGAttributes<T> extends CoreSVGAttributes<T>, StylableSVGAttributes {}

    interface EllipseSVGAttributes<T>
      extends GraphicsElementSVGAttributes<T>,
        ShapeElementSVGAttributes<T>,
        ConditionalProcessingSVGAttributes,
        ExternalResourceSVGAttributes,
        StylableSVGAttributes,
        TransformableSVGAttributes {
      cx?: number | string;
      cy?: number | string;
      rx?: number | string;
      ry?: number | string;
    }

    interface FeBlendSVGAttributes<T>
      extends FilterPrimitiveElementSVGAttributes<T>,
        DoubleInputFilterSVGAttributes,
        StylableSVGAttributes {
      mode?: "normal" | "multiply" | "screen" | "darken" | "lighten";
    }

    interface FeColorMatrixSVGAttributes<T>
      extends FilterPrimitiveElementSVGAttributes<T>,
        SingleInputFilterSVGAttributes,
        StylableSVGAttributes {
      type?: "matrix" | "saturate" | "hueRotate" | "luminanceToAlpha";
      values?: string;
    }

    interface FeComponentTransferSVGAttributes<T>
      extends FilterPrimitiveElementSVGAttributes<T>,
        SingleInputFilterSVGAttributes,
        StylableSVGAttributes {}

    interface FeCompositeSVGAttributes<T>
      extends FilterPrimitiveElementSVGAttributes<T>,
        DoubleInputFilterSVGAttributes,
        StylableSVGAttributes {
      operator?: "over" | "in" | "out" | "atop" | "xor" | "arithmetic";
      k1?: number | string;
      k2?: number | string;
      k3?: number | string;
      k4?: number | string;
    }

    interface FeConvolveMatrixSVGAttributes<T>
      extends FilterPrimitiveElementSVGAttributes<T>,
        SingleInputFilterSVGAttributes,
        StylableSVGAttributes {
      order?: number | string;
      kernelMatrix?: string;
      divisor?: number | string;
      bias?: number | string;
      targetX?: number | string;
      targetY?: number | string;
      edgeMode?: "duplicate" | "wrap" | "none";
      kernelUnitLength?: number | string;
      preserveAlpha?: "true" | "false";
    }

    interface FeDiffuseLightingSVGAttributes<T>
      extends FilterPrimitiveElementSVGAttributes<T>,
        SingleInputFilterSVGAttributes,
        StylableSVGAttributes,
        Pick<PresentationSVGAttributes, "color" | "lightingColor"> {
      surfaceScale?: number | string;
      diffuseConstant?: number | string;
      kernelUnitLength?: number | string;
    }

    interface FeDisplacementMapSVGAttributes<T>
      extends FilterPrimitiveElementSVGAttributes<T>,
        DoubleInputFilterSVGAttributes,
        StylableSVGAttributes {
      scale?: number | string;
      xChannelSelector?: "R" | "G" | "B" | "A";
      yChannelSelector?: "R" | "G" | "B" | "A";
    }

    interface FeDistantLightSVGAttributes<T> extends LightSourceElementSVGAttributes<T> {
      azimuth?: number | string;
      elevation?: number | string;
    }

    interface FeFloodSVGAttributes<T>
      extends FilterPrimitiveElementSVGAttributes<T>,
        StylableSVGAttributes,
        Pick<PresentationSVGAttributes, "color" | "floodColor" | "floodOpacity"> {}

    interface FeFuncSVGAttributes<T> extends CoreSVGAttributes<T> {
      type?: "identity" | "table" | "discrete" | "linear" | "gamma";
      tableValues?: string;
      slope?: number | string;
      intercept?: number | string;
      amplitude?: number | string;
      exponent?: number | string;
      offset?: number | string;
    }

    interface FeGaussianBlurSVGAttributes<T>
      extends FilterPrimitiveElementSVGAttributes<T>,
        SingleInputFilterSVGAttributes,
        StylableSVGAttributes {
      stdDeviation?: number | string;
    }

    interface FeImageSVGAttributes<T>
      extends FilterPrimitiveElementSVGAttributes<T>,
        XLinkSVGAttributes,
        ExternalResourceSVGAttributes,
        StylableSVGAttributes {
      preserveAspectRatio: SVGPreserveAspectRatio;
    }

    interface FeMergeSVGAttributes<T>
      extends FilterPrimitiveElementSVGAttributes<T>,
        StylableSVGAttributes {}

    interface FeMergeNodeSVGAttributes<T>
      extends CoreSVGAttributes<T>,
        SingleInputFilterSVGAttributes {}

    interface FeMorphologySVGAttributes<T>
      extends FilterPrimitiveElementSVGAttributes<T>,
        SingleInputFilterSVGAttributes,
        StylableSVGAttributes {
      operator?: "erode" | "dilate";
      radius?: number | string;
    }

    interface FeOffsetSVGAttributes<T>
      extends FilterPrimitiveElementSVGAttributes<T>,
        SingleInputFilterSVGAttributes,
        StylableSVGAttributes {
      dx?: number | string;
      dy?: number | string;
    }

    interface FePointLightSVGAttributes<T> extends LightSourceElementSVGAttributes<T> {
      x?: number | string;
      y?: number | string;
      z?: number | string;
    }

    interface FeSpecularLightingSVGAttributes<T>
      extends FilterPrimitiveElementSVGAttributes<T>,
        SingleInputFilterSVGAttributes,
        StylableSVGAttributes,
        Pick<PresentationSVGAttributes, "color" | "lightingColor"> {
      surfaceScale?: string;
      specularConstant?: string;
      specularExponent?: string;
      kernelUnitLength?: number | string;
    }

    interface FeSpotLightSVGAttributes<T> extends LightSourceElementSVGAttributes<T> {
      x?: number | string;
      y?: number | string;
      z?: number | string;
      pointsAtX?: number | string;
      pointsAtY?: number | string;
      pointsAtZ?: number | string;
      specularExponent?: number | string;
      limitingConeAngle?: number | string;
    }

    interface FeTileSVGAttributes<T>
      extends FilterPrimitiveElementSVGAttributes<T>,
        SingleInputFilterSVGAttributes,
        StylableSVGAttributes {}

    interface FeTurbulanceSVGAttributes<T>
      extends FilterPrimitiveElementSVGAttributes<T>,
        StylableSVGAttributes {
      baseFrequency?: number | string;
      numOctaves?: number | string;
      seed?: number | string;
      stitchTiles?: "stitch" | "noStitch";
      type?: "fractalNoise" | "turbulence";
    }

    interface FilterSVGAttributes<T>
      extends CoreSVGAttributes<T>,
        XLinkSVGAttributes,
        ExternalResourceSVGAttributes,
        StylableSVGAttributes {
      filterUnits?: SVGUnits;
      primitiveUnits?: SVGUnits;
      x?: number | string;
      y?: number | string;
      width?: number | string;
      height?: number | string;
      filterRes?: number | string;
    }

    interface ForeignObjectSVGAttributes<T>
      extends NewViewportSVGAttributes<T>,
        ConditionalProcessingSVGAttributes,
        ExternalResourceSVGAttributes,
        StylableSVGAttributes,
        TransformableSVGAttributes,
        Pick<PresentationSVGAttributes, "display" | "visibility"> {
      x?: number | string;
      y?: number | string;
      width?: number | string;
      height?: number | string;
    }

    interface GSVGAttributes<T>
      extends ContainerElementSVGAttributes<T>,
        ConditionalProcessingSVGAttributes,
        ExternalResourceSVGAttributes,
        StylableSVGAttributes,
        TransformableSVGAttributes,
        Pick<PresentationSVGAttributes, "display" | "visibility"> {}

    interface ImageSVGAttributes<T>
      extends NewViewportSVGAttributes<T>,
        GraphicsElementSVGAttributes<T>,
        ConditionalProcessingSVGAttributes,
        XLinkSVGAttributes,
        StylableSVGAttributes,
        TransformableSVGAttributes,
        Pick<PresentationSVGAttributes, "colorProfile" | "imageRendering"> {
      x?: number | string;
      y?: number | string;
      width?: number | string;
      height?: number | string;
      preserveAspectRatio?: ImagePreserveAspectRatio;
    }

    interface LineSVGAttributes<T>
      extends GraphicsElementSVGAttributes<T>,
        ShapeElementSVGAttributes<T>,
        ConditionalProcessingSVGAttributes,
        ExternalResourceSVGAttributes,
        StylableSVGAttributes,
        TransformableSVGAttributes,
        Pick<PresentationSVGAttributes, "markerStart" | "markerMid" | "markerEnd"> {
      x1?: number | string;
      y1?: number | string;
      x2?: number | string;
      y2?: number | string;
    }

    interface LinearGradientSVGAttributes<T> extends GradientElementSVGAttributes<T> {
      x1?: number | string;
      x2?: number | string;
      y1?: number | string;
      y2?: number | string;
    }

    interface MarkerSVGAttributes<T>
      extends ContainerElementSVGAttributes<T>,
        ExternalResourceSVGAttributes,
        StylableSVGAttributes,
        FitToViewBoxSVGAttributes,
        Pick<PresentationSVGAttributes, "overflow" | "clip"> {
      markerUnits?: "strokeWidth" | "userSpaceOnUse";
      refX?: number | string;
      refY?: number | string;
      markerWidth?: number | string;
      markerHeight?: number | string;
      orient?: string;
    }

    interface MaskSVGAttributes<T>
      extends Omit<ContainerElementSVGAttributes<T>, "opacity" | "filter">,
        ConditionalProcessingSVGAttributes,
        ExternalResourceSVGAttributes,
        StylableSVGAttributes {
      maskUnits?: SVGUnits;
      maskContentUnits?: SVGUnits;
      x?: number | string;
      y?: number | string;
      width?: number | string;
      height?: number | string;
    }

    interface MetadataSVGAttributes<T> extends CoreSVGAttributes<T> {}

    interface PathSVGAttributes<T>
      extends GraphicsElementSVGAttributes<T>,
        ShapeElementSVGAttributes<T>,
        ConditionalProcessingSVGAttributes,
        ExternalResourceSVGAttributes,
        StylableSVGAttributes,
        TransformableSVGAttributes,
        Pick<PresentationSVGAttributes, "markerStart" | "markerMid" | "markerEnd"> {
      d?: string;
      pathLength?: number | string;
    }

    interface PatternSVGAttributes<T>
      extends ContainerElementSVGAttributes<T>,
        ConditionalProcessingSVGAttributes,
        XLinkSVGAttributes,
        ExternalResourceSVGAttributes,
        StylableSVGAttributes,
        FitToViewBoxSVGAttributes,
        Pick<PresentationSVGAttributes, "overflow" | "clip"> {
      x?: number | string;
      y?: number | string;
      width?: number | string;
      height?: number | string;
      patternUnits?: SVGUnits;
      patternContentUnits?: SVGUnits;
      patternTransform?: string;
    }

    interface PolygonSVGAttributes<T>
      extends GraphicsElementSVGAttributes<T>,
        ShapeElementSVGAttributes<T>,
        ConditionalProcessingSVGAttributes,
        ExternalResourceSVGAttributes,
        StylableSVGAttributes,
        TransformableSVGAttributes,
        Pick<PresentationSVGAttributes, "markerStart" | "markerMid" | "markerEnd"> {
      points?: string;
    }

    interface PolylineSVGAttributes<T>
      extends GraphicsElementSVGAttributes<T>,
        ShapeElementSVGAttributes<T>,
        ConditionalProcessingSVGAttributes,
        ExternalResourceSVGAttributes,
        StylableSVGAttributes,
        TransformableSVGAttributes,
        Pick<PresentationSVGAttributes, "markerStart" | "markerMid" | "markerEnd"> {
      points?: string;
    }

    interface RadialGradientSVGAttributes<T> extends GradientElementSVGAttributes<T> {
      cx?: number | string;
      cy?: number | string;
      r?: number | string;
      fx?: number | string;
      fy?: number | string;
    }

    interface RectSVGAttributes<T>
      extends GraphicsElementSVGAttributes<T>,
        ShapeElementSVGAttributes<T>,
        ConditionalProcessingSVGAttributes,
        ExternalResourceSVGAttributes,
        StylableSVGAttributes,
        TransformableSVGAttributes {
      x?: number | string;
      y?: number | string;
      width?: number | string;
      height?: number | string;
      rx?: number | string;
      ry?: number | string;
    }

    interface StopSVGAttributes<T>
      extends CoreSVGAttributes<T>,
        StylableSVGAttributes,
        Pick<PresentationSVGAttributes, "color" | "stopColor" | "stopOpacity"> {
      offset?: number | string;
    }

    interface SvgSVGAttributes<T>
      extends ContainerElementSVGAttributes<T>,
        NewViewportSVGAttributes<T>,
        ConditionalProcessingSVGAttributes,
        ExternalResourceSVGAttributes,
        StylableSVGAttributes,
        FitToViewBoxSVGAttributes,
        ZoomAndPanSVGAttributes,
        Pick<PresentationSVGAttributes, "display" | "visibility"> {
      version?: string;
      baseProfile?: string;
      x?: number | string;
      y?: number | string;
      width?: number | string;
      height?: number | string;
      contentScriptType?: string;
      contentStyleType?: string;
    }

    interface SwitchSVGAttributes<T>
      extends ContainerElementSVGAttributes<T>,
        ConditionalProcessingSVGAttributes,
        ExternalResourceSVGAttributes,
        StylableSVGAttributes,
        TransformableSVGAttributes,
        Pick<PresentationSVGAttributes, "display" | "visibility"> {}

    interface SymbolSVGAttributes<T>
      extends ContainerElementSVGAttributes<T>,
        NewViewportSVGAttributes<T>,
        ExternalResourceSVGAttributes,
        StylableSVGAttributes,
        FitToViewBoxSVGAttributes {}

    interface TextSVGAttributes<T>
      extends TextContentElementSVGAttributes<T>,
        GraphicsElementSVGAttributes<T>,
        ConditionalProcessingSVGAttributes,
        ExternalResourceSVGAttributes,
        StylableSVGAttributes,
        TransformableSVGAttributes,
        Pick<PresentationSVGAttributes, "writingMode" | "textRendering"> {
      x?: number | string;
      y?: number | string;
      dx?: number | string;
      dy?: number | string;
      rotate?: number | string;
      textLength?: number | string;
      lengthAdjust?: "spacing" | "spacingAndGlyphs";
    }

    interface TextPathSVGAttributes<T>
      extends TextContentElementSVGAttributes<T>,
        ConditionalProcessingSVGAttributes,
        XLinkSVGAttributes,
        ExternalResourceSVGAttributes,
        StylableSVGAttributes,
        Pick<
          PresentationSVGAttributes,
          "alignmentBaseline" | "baselineShift" | "display" | "visibility"
        > {
      startOffset?: number | string;
      method?: "align" | "stretch";
      spacing?: "auto" | "exact";
    }

    interface TSpanSVGAttributes<T>
      extends TextContentElementSVGAttributes<T>,
        ConditionalProcessingSVGAttributes,
        ExternalResourceSVGAttributes,
        StylableSVGAttributes,
        Pick<
          PresentationSVGAttributes,
          "alignmentBaseline" | "baselineShift" | "display" | "visibility"
        > {
      x?: number | string;
      y?: number | string;
      dx?: number | string;
      dy?: number | string;
      rotate?: number | string;
      textLength?: number | string;
      lengthAdjust?: "spacing" | "spacingAndGlyphs";
    }

    interface UseSVGAttributes<T>
      extends GraphicsElementSVGAttributes<T>,
        ConditionalProcessingSVGAttributes,
        XLinkSVGAttributes,
        ExternalResourceSVGAttributes,
        StylableSVGAttributes,
        TransformableSVGAttributes {
      x?: number | string;
      y?: number | string;
      width?: number | string;
      height?: number | string;
    }

    interface ViewSVGAttributes<T>
      extends CoreSVGAttributes<T>,
        ExternalResourceSVGAttributes,
        FitToViewBoxSVGAttributes,
        ZoomAndPanSVGAttributes {
      viewTarget?: string;
    }

    interface IntrinsicElements {
      // HTML
      a: AnchorHTMLAttributes<HTMLAnchorElement>;
      abbr: HTMLAttributes<HTMLElement>;
      address: HTMLAttributes<HTMLElement>;
      area: AreaHTMLAttributes<HTMLAreaElement>;
      article: HTMLAttributes<HTMLElement>;
      aside: HTMLAttributes<HTMLElement>;
      audio: AudioHTMLAttributes<HTMLAudioElement>;
      b: HTMLAttributes<HTMLElement>;
      base: BaseHTMLAttributes<HTMLBaseElement>;
      bdi: HTMLAttributes<HTMLElement>;
      bdo: HTMLAttributes<HTMLElement>;
      big: HTMLAttributes<HTMLElement>;
      blockquote: BlockquoteHTMLAttributes<HTMLElement>;
      body: HTMLAttributes<HTMLBodyElement>;
      br: HTMLAttributes<HTMLBRElement>;
      button: ButtonHTMLAttributes<HTMLButtonElement>;
      canvas: CanvasHTMLAttributes<HTMLCanvasElement>;
      caption: HTMLAttributes<HTMLElement>;
      cite: HTMLAttributes<HTMLElement>;
      code: HTMLAttributes<HTMLElement>;
      col: ColHTMLAttributes<HTMLTableColElement>;
      colgroup: ColgroupHTMLAttributes<HTMLTableColElement>;
      data: DataHTMLAttributes<HTMLElement>;
      datalist: HTMLAttributes<HTMLDataListElement>;
      dd: HTMLAttributes<HTMLElement>;
      del: HTMLAttributes<HTMLElement>;
      details: DetailsHtmlAttributes<HTMLElement>;
      dfn: HTMLAttributes<HTMLElement>;
      dialog: DialogHtmlAttributes<HTMLElement>;
      div: HTMLAttributes<HTMLDivElement>;
      dl: HTMLAttributes<HTMLDListElement>;
      dt: HTMLAttributes<HTMLElement>;
      em: HTMLAttributes<HTMLElement>;
      embed: EmbedHTMLAttributes<HTMLEmbedElement>;
      fieldset: FieldsetHTMLAttributes<HTMLFieldSetElement>;
      figcaption: HTMLAttributes<HTMLElement>;
      figure: HTMLAttributes<HTMLElement>;
      footer: HTMLAttributes<HTMLElement>;
      form: FormHTMLAttributes<HTMLFormElement>;
      h1: HTMLAttributes<HTMLHeadingElement>;
      h2: HTMLAttributes<HTMLHeadingElement>;
      h3: HTMLAttributes<HTMLHeadingElement>;
      h4: HTMLAttributes<HTMLHeadingElement>;
      h5: HTMLAttributes<HTMLHeadingElement>;
      h6: HTMLAttributes<HTMLHeadingElement>;
      head: HTMLAttributes<HTMLHeadElement>;
      header: HTMLAttributes<HTMLElement>;
      hgroup: HTMLAttributes<HTMLElement>;
      hr: HTMLAttributes<HTMLHRElement>;
      html: HTMLAttributes<HTMLHtmlElement>;
      i: HTMLAttributes<HTMLElement>;
      iframe: IframeHTMLAttributes<HTMLIFrameElement>;
      img: ImgHTMLAttributes<HTMLImageElement>;
      input: InputHTMLAttributes<HTMLInputElement>;
      ins: InsHTMLAttributes<HTMLModElement>;
      kbd: HTMLAttributes<HTMLElement>;
      keygen: KeygenHTMLAttributes<HTMLElement>;
      label: LabelHTMLAttributes<HTMLLabelElement>;
      legend: HTMLAttributes<HTMLLegendElement>;
      li: LiHTMLAttributes<HTMLLIElement>;
      link: LinkHTMLAttributes<HTMLLinkElement>;
      main: HTMLAttributes<HTMLElement>;
      map: MapHTMLAttributes<HTMLMapElement>;
      mark: HTMLAttributes<HTMLElement>;
      menu: MenuHTMLAttributes<HTMLElement>;
      menuitem: HTMLAttributes<HTMLElement>;
      meta: MetaHTMLAttributes<HTMLMetaElement>;
      meter: MeterHTMLAttributes<HTMLElement>;
      nav: HTMLAttributes<HTMLElement>;
      noindex: HTMLAttributes<HTMLElement>;
      noscript: HTMLAttributes<HTMLElement>;
      object: ObjectHTMLAttributes<HTMLObjectElement>;
      ol: OlHTMLAttributes<HTMLOListElement>;
      optgroup: OptgroupHTMLAttributes<HTMLOptGroupElement>;
      option: OptionHTMLAttributes<HTMLOptionElement>;
      output: OutputHTMLAttributes<HTMLElement>;
      p: HTMLAttributes<HTMLParagraphElement>;
      param: ParamHTMLAttributes<HTMLParamElement>;
      picture: HTMLAttributes<HTMLElement>;
      pre: HTMLAttributes<HTMLPreElement>;
      progress: ProgressHTMLAttributes<HTMLProgressElement>;
      q: QuoteHTMLAttributes<HTMLQuoteElement>;
      rp: HTMLAttributes<HTMLElement>;
      rt: HTMLAttributes<HTMLElement>;
      ruby: HTMLAttributes<HTMLElement>;
      s: HTMLAttributes<HTMLElement>;
      samp: HTMLAttributes<HTMLElement>;
      script: ScriptHTMLAttributes<HTMLElement>;
      section: HTMLAttributes<HTMLElement>;
      select: SelectHTMLAttributes<HTMLSelectElement>;
      slot: HTMLSlotElementAttributes;
      small: HTMLAttributes<HTMLElement>;
      source: SourceHTMLAttributes<HTMLSourceElement>;
      span: HTMLAttributes<HTMLSpanElement>;
      strong: HTMLAttributes<HTMLElement>;
      style: StyleHTMLAttributes<HTMLStyleElement>;
      sub: HTMLAttributes<HTMLElement>;
      summary: HTMLAttributes<HTMLElement>;
      sup: HTMLAttributes<HTMLElement>;
      table: HTMLAttributes<HTMLTableElement>;
      tbody: HTMLAttributes<HTMLTableSectionElement>;
      td: TdHTMLAttributes<HTMLTableDataCellElement>;
      textarea: TextareaHTMLAttributes<HTMLTextAreaElement>;
      tfoot: HTMLAttributes<HTMLTableSectionElement>;
      th: ThHTMLAttributes<HTMLTableHeaderCellElement>;
      thead: HTMLAttributes<HTMLTableSectionElement>;
      time: TimeHTMLAttributes<HTMLElement>;
      title: HTMLAttributes<HTMLTitleElement>;
      tr: HTMLAttributes<HTMLTableRowElement>;
      track: TrackHTMLAttributes<HTMLTrackElement>;
      u: HTMLAttributes<HTMLElement>;
      ul: HTMLAttributes<HTMLUListElement>;
      var: HTMLAttributes<HTMLElement>;
      video: VideoHTMLAttributes<HTMLVideoElement>;
      wbr: HTMLAttributes<HTMLElement>;

      // SVG
      svg: SvgSVGAttributes<SVGSVGElement>;

      animate: AnimateSVGAttributes<SVGAnimateElement>;
      animateMotion: AnimateMotionSVGAttributes<SVGAnimateMotionElement>;
      animateTransform: AnimateTransformSVGAttributes<SVGAnimateTransformElement>;
      circle: CircleSVGAttributes<SVGCircleElement>;
      clipPath: ClipPathSVGAttributes<SVGClipPathElement>;
      defs: DefsSVGAttributes<SVGDefsElement>;
      desc: DescSVGAttributes<SVGDescElement>;
      ellipse: EllipseSVGAttributes<SVGEllipseElement>;
      feBlend: FeBlendSVGAttributes<SVGFEBlendElement>;
      feColorMatrix: FeColorMatrixSVGAttributes<SVGFEColorMatrixElement>;
      feComponentTransfer: FeComponentTransferSVGAttributes<SVGFEComponentTransferElement>;
      feComposite: FeCompositeSVGAttributes<SVGFECompositeElement>;
      feConvolveMatrix: FeConvolveMatrixSVGAttributes<SVGFEConvolveMatrixElement>;
      feDiffuseLighting: FeDiffuseLightingSVGAttributes<SVGFEDiffuseLightingElement>;
      feDisplacementMap: FeDisplacementMapSVGAttributes<SVGFEDisplacementMapElement>;
      feDistantLight: FeDistantLightSVGAttributes<SVGFEDistantLightElement>;
      feFlood: FeFloodSVGAttributes<SVGFEFloodElement>;
      feFuncA: FeFuncSVGAttributes<SVGFEFuncAElement>;
      feFuncB: FeFuncSVGAttributes<SVGFEFuncBElement>;
      feFuncG: FeFuncSVGAttributes<SVGFEFuncGElement>;
      feFuncR: FeFuncSVGAttributes<SVGFEFuncRElement>;
      feGaussianBlur: FeGaussianBlurSVGAttributes<SVGFEGaussianBlurElement>;
      feImage: FeImageSVGAttributes<SVGFEImageElement>;
      feMerge: FeMergeSVGAttributes<SVGFEMergeElement>;
      feMergeNode: FeMergeNodeSVGAttributes<SVGFEMergeNodeElement>;
      feMorphology: FeMorphologySVGAttributes<SVGFEMorphologyElement>;
      feOffset: FeOffsetSVGAttributes<SVGFEOffsetElement>;
      fePointLight: FePointLightSVGAttributes<SVGFEPointLightElement>;
      feSpecularLighting: FeSpecularLightingSVGAttributes<SVGFESpecularLightingElement>;
      feSpotLight: FeSpotLightSVGAttributes<SVGFESpotLightElement>;
      feTile: FeTileSVGAttributes<SVGFETileElement>;
      feTurbulence: FeTurbulanceSVGAttributes<SVGFETurbulenceElement>;
      filter: FilterSVGAttributes<SVGFilterElement>;
      foreignObject: ForeignObjectSVGAttributes<SVGForeignObjectElement>;
      g: GSVGAttributes<SVGGElement>;
      image: ImageSVGAttributes<SVGImageElement>;
      line: LineSVGAttributes<SVGLineElement>;
      linearGradient: LinearGradientSVGAttributes<SVGLinearGradientElement>;
      marker: MarkerSVGAttributes<SVGMarkerElement>;
      mask: MaskSVGAttributes<SVGMaskElement>;
      metadata: MetadataSVGAttributes<SVGMetadataElement>;
      path: PathSVGAttributes<SVGPathElement>;
      pattern: PatternSVGAttributes<SVGPatternElement>;
      polygon: PolygonSVGAttributes<SVGPolygonElement>;
      polyline: PolylineSVGAttributes<SVGPolylineElement>;
      radialGradient: RadialGradientSVGAttributes<SVGRadialGradientElement>;
      rect: RectSVGAttributes<SVGRectElement>;
      stop: StopSVGAttributes<SVGStopElement>;
      switch: SwitchSVGAttributes<SVGSwitchElement>;
      symbol: SymbolSVGAttributes<SVGSymbolElement>;
      text: TextSVGAttributes<SVGTextElement>;
      textPath: TextPathSVGAttributes<SVGTextPathElement>;
      tspan: TSpanSVGAttributes<SVGTSpanElement>;
      use: UseSVGAttributes<SVGUseElement>;
      view: ViewSVGAttributes<SVGViewElement>;
    }
  }
}

export {};
