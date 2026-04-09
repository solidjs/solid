import * as csstype from "csstype";

/**
 * Originally based on JSX types for Surplus and Inferno and adapted for `dom-expressions`.
 *
 * - https://github.com/adamhaile/surplus/blob/master/index.d.ts
 * - https://github.com/infernojs/inferno/blob/master/packages/inferno/src/core/types.ts
 *
 * MathML typings coming mostly from Preact
 *
 * - https://github.com/preactjs/preact/blob/07dc9f324e58569ce66634aa03fe8949b4190358/src/jsx.d.ts#L2575
 *
 * Checked against other frameworks via the following table:
 *
 * - https://potahtml.github.io/namespace-jsx-project/index.html
 *
 * # Typings on elements
 *
 * ## Attributes
 *
 * - Typings include attributes and not properties (unless the property Is special-cased, such
 *   textContent, event handlers, etc).
 * - Attributes are lowercase to avoid confusion with properties.
 * - Attributes are used "as is" and won't be transformed in any way (such to `lowercase` or from
 *   `dashed-case` to `camelCase`).
 *
 * ## Event Handlers
 *
 * - Event handlers use `camelCase` such `onClick` and will be delegated when possible, bubbling
 *   through the component tree, not the dom tree.
 * - Native event handlers use the namespace `on:` such `on:click`, and wont be delegated. bubbling
 *   the dom tree.
 * - A global case-insensitive event handler can be added by extending `EventHandlersElement<T>`
 * - A native `on:` event handler can be added by extending `CustomEvents<T>` interface
 *
 * ## Boolean Attributes (property setter that accepts `true | false`):
 *
 * - `(bool)true` adds the attribute `<video autoplay={true}/>` or in JSX as `<video autoplay/>`
 * - `(bool)false` removes the attribute from the DOM `<video autoplay={false}/>`
 * - `=""` may be accepted for the sake of parity with html `<video autoplay=""/>`
 * - `"true" | "false"` are NOT allowed, these are strings that evaluate to `(bool)true`
 *
 * ## Enumerated Attributes (attribute accepts 1 string value out of many)
 *
 * - Accepts any of the enumerated values, such: `"perhaps" | "maybe"`
 * - When one of the possible values is empty(in html that's for the attribute to be present), then it
 *   will also accept `(bool)true` to make it consistent with boolean attributes.
 *
 * Such `popover` attribute provides `"" | "manual" | "auto" | "hint"`.
 *
 * By NOT allowing `(bool)true` we will have to write `<div popover="" />`. Therefore, To make it
 * consistent with Boolean Attributes we accept `true | "" | "manual" | "auto" | "hint"`, such as:
 * `<div popover={true} />` or in JSX `<div popover />` is allowed and equivalent to `<div
 * popover="" />`
 *
 * ## Pseudo-Boolean Attributes (enumerated attributes that happen to accept the strings `"true" | "false"`)
 *
 * - Such `<div draggable="true"/>` or `<div draggable="false"/>`. The value of the attribute is a
 *   string not a boolean.
 * - `<div draggable={true}/>` is not valid because `(bool)true` is NOT transformed to the string
 *   `"true"`. Likewise `<div draggable={false}/>` removes the attribute from the element.
 * - MDN documentation https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/draggable
 *
 * ## All Of The Above In a nutshell
 *
 * - `(bool)true` adds an empty attribute
 * - `(bool)false` removes the attribute
 * - Attributes are lowercase
 * - Event handlers are camelCase
 * - Anything else is a `string` and used "as is"
 * - Additionally, an attribute may be removed by `undefined`
 *
 * ## Using Properties
 *
 * - The namespace `prop:` could be used to directly set properties in native elements and
 *   custom-elements. `<custom-element prop:myProp={true}/>` equivalent to `el.myProp = true`
 *
 * ## Interfaces
 *
 * Events
 *
 * 1. An event handler goes in `EventHandlersElement` when:
 *
 *    - `event` is global, that's to be defined in `HTMLElement` AND `SVGElement` AND `MathMLElement`
 *    - `event` is defined in `Element` (as `HTMLElement/MathMLElement/SVGElement` -> `Element`)
 * 2. `<body>`, `<svg>`, `<framesete>` are special as these include `window` events
 * 3. Any other event is special for its own tag.
 *
 * Browser Hierarchy
 *
 * - $Element (ex HTMLDivElement <div>) -> ... -> HTMLElement -> Element -> Node
 * - $Element (all math elements are MathMLElement) MathMLElement -> Element -> Node
 * - $Element`(ex SVGMaskElement <mask>) -> ... -> SVGElement -> Element -> Node
 *
 * Attributes
 *
 *      <div> -> ... -> HTMLAttributes -> ElementAttributes
 *      <svg> -> ... -> SVGAttributes -> ElementAttributes
 *      <math> -> ... -> MathMLAttributes -> ElementAttributes
 *
 *      ElementAttributes = `Element` + `Node` attributes (aka global attributes)
 *
 *      HTMLAttributes = `HTMLElement` attributes (aka HTML global attributes)
 *      SVGAttributes = `SVGElement` attributes (aka SVG global attributes)
 *      MathMLAttributes = `MathMLElement` attributes (aka MATH global attributes)
 *
 *      CustomAttributes = Framework attributes
 */

type DOMElement = Element;

export namespace JSX {
  // START - difference between `jsx.d.ts` and `jsx-h.d.ts`
  type FunctionMaybe<T = unknown> = { (): T } | T;
  interface FunctionElement {
    (): Element;
  }

  type Element =
    | Node
    | ArrayElement
    | FunctionElement
    | (string & {})
    | number
    | boolean
    | null
    | undefined;
  // END - difference between `jsx.d.ts` and `jsx-h.d.ts`

  interface ArrayElement extends Array<Element> {}

  interface ElementClass {
    // empty, libs can define requirements downstream
  }
  interface ElementAttributesProperty {
    // empty, libs can define requirements downstream
  }
  interface ElementChildrenAttribute {
    children: {};
  }

  // Event handlers

  interface EventHandler<T, E extends Event> {
    (
      e: E & {
        currentTarget: T;
        target: DOMElement;
      }
    ): void;
  }

  interface BoundEventHandler<
    T,
    E extends Event,
    EHandler extends EventHandler<T, any> = EventHandler<T, E>
  > {
    0: (data: any, ...e: Parameters<EHandler>) => void;
    1: any;
  }
  type EventHandlerUnion<
    T,
    E extends Event,
    EHandler extends EventHandler<T, any> = EventHandler<T, E>
  > = EHandler | BoundEventHandler<T, E, EHandler>;

  interface EventHandlerWithOptions<T, E extends Event, EHandler = EventHandler<T, E>>
    extends AddEventListenerOptions, EventListenerOptions {
    handleEvent: EHandler;
  }

  type EventHandlerWithOptionsUnion<
    T,
    E extends Event,
    EHandler extends EventHandler<T, any> = EventHandler<T, E>
  > = EHandler | EventHandlerWithOptions<T, E, EHandler>;

  interface InputEventHandler<T, E extends InputEvent> {
    (
      e: E & {
        currentTarget: T;
        target: T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
          ? T
          : DOMElement;
      }
    ): void;
  }
  type InputEventHandlerUnion<T, E extends InputEvent> = EventHandlerUnion<
    T,
    E,
    InputEventHandler<T, E>
  >;

  interface ChangeEventHandler<T, E extends Event> {
    (
      e: E & {
        currentTarget: T;
        target: T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
          ? T
          : DOMElement;
      }
    ): void;
  }
  type ChangeEventHandlerUnion<T, E extends Event> = EventHandlerUnion<
    T,
    E,
    ChangeEventHandler<T, E>
  >;

  interface FocusEventHandler<T, E extends FocusEvent> {
    (
      e: E & {
        currentTarget: T;
        target: T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
          ? T
          : DOMElement;
      }
    ): void;
  }
  type FocusEventHandlerUnion<T, E extends FocusEvent> = EventHandlerUnion<
    T,
    E,
    FocusEventHandler<T, E>
  >;
  // end event handlers

  type ClassList =
    | Record<string, boolean>
    | Array<string | number | boolean | null | undefined | Record<string, boolean>>;

  const SERIALIZABLE: unique symbol;
  interface SerializableAttributeValue {
    toString(): string;
    [SERIALIZABLE]: never;
  }

  type RefCallback<T> = (el: T) => void;
  type Ref<T> = T | RefCallback<T> | (RefCallback<T> | Ref<T>)[];

  interface IntrinsicAttributes {
    ref?: Ref<unknown> | undefined;
  }
  interface CustomAttributes<T> {
    ref?: Ref<T> | undefined;
    children?: FunctionMaybe<Element | undefined>;
    $ServerOnly?: boolean | undefined;
  }
  interface ExplicitProperties {}
  interface CustomEvents {}
  type PropAttributes = {
    [Key in keyof ExplicitProperties as `prop:${Key}`]?: ExplicitProperties[Key];
  };
  type OnAttributes<T> = {
    [Key in keyof CustomEvents as `on:${Key}`]?: EventHandlerWithOptionsUnion<T, CustomEvents[Key]>;
  };

  // CSS

  interface CSSProperties extends csstype.PropertiesHyphen {
    // Override
    [key: `-${string}`]: string | number | undefined;
  }

  // TODO: Should we allow this?
  // type ClassKeys = `class:${string}`;
  // type CSSKeys = Exclude<keyof csstype.PropertiesHyphen, `-${string}`>;

  // type CSSAttributes = {
  //   [key in CSSKeys as `style:${key}`]: csstype.PropertiesHyphen[key];
  // };

  // BOOLEAN

  /**
   * Boolean and Pseudo-Boolean Attributes Helpers.
   *
   * Please use the helpers to describe boolean and pseudo boolean attributes to make this file and
   * also the typings easier to understand and explain.
   */

  type BooleanAttribute = true | false | "";

  type BooleanProperty = true | false;

  type EnumeratedPseudoBoolean = "false" | "true";

  type EnumeratedAcceptsEmpty = "" | true;

  type RemoveAttribute = undefined | false;

  type RemoveProperty = undefined;

  // ARIA

  // All the WAI-ARIA 1.1 attributes from https://www.w3.org/TR/wai-aria-1.1/
  interface AriaAttributes {
    /**
     * Identifies the currently active element when DOM focus is on a composite widget, textbox,
     * group, or application.
     */
    "aria-activedescendant"?: FunctionMaybe<string | RemoveAttribute>;
    /**
     * Indicates whether assistive technologies will present all, or only parts of, the changed
     * region based on the change notifications defined by the aria-relevant attribute.
     */
    "aria-atomic"?: FunctionMaybe<EnumeratedPseudoBoolean | RemoveAttribute>;
    /**
     * Similar to the global aria-label. Defines a string value that labels the current element,
     * which is intended to be converted into Braille.
     *
     * @see aria-label.
     */
    "aria-braillelabel"?: FunctionMaybe<string | RemoveAttribute>;
    /**
     * Defines a human-readable, author-localized abbreviated description for the role of an element
     * intended to be converted into Braille. Braille is not a one-to-one transliteration of letters
     * and numbers, but rather it includes various abbreviations, contractions, and characters that
     * represent words (known as logograms).
     *
     * Instead of converting long role descriptions to Braille, the aria-brailleroledescription
     * attribute allows for providing an abbreviated version of the aria-roledescription value,
     * which is a human-readable, author-localized description for the role of an element, for
     * improved user experience with braille interfaces.
     *
     * @see aria-roledescription.
     */
    "aria-brailleroledescription"?: FunctionMaybe<string | RemoveAttribute>;
    /**
     * Indicates whether inputting text could trigger display of one or more predictions of the
     * user's intended value for an input and specifies how predictions would be presented if they
     * are made.
     */
    "aria-autocomplete"?: FunctionMaybe<"none" | "inline" | "list" | "both" | RemoveAttribute>;
    /**
     * Indicates an element is being modified and that assistive technologies MAY want to wait until
     * the modifications are complete before exposing them to the user.
     */
    "aria-busy"?: FunctionMaybe<EnumeratedPseudoBoolean | RemoveAttribute>;
    /**
     * Indicates the current "checked" state of checkboxes, radio buttons, and other widgets.
     *
     * @see aria-pressed @see aria-selected.
     */
    "aria-checked"?: FunctionMaybe<EnumeratedPseudoBoolean | "mixed" | RemoveAttribute>;
    /**
     * Defines the total number of columns in a table, grid, or treegrid.
     *
     * @see aria-colindex.
     */
    "aria-colcount"?: FunctionMaybe<number | string | RemoveAttribute>;
    /**
     * Defines an element's column index or position with respect to the total number of columns
     * within a table, grid, or treegrid.
     *
     * @see aria-colcount @see aria-colspan.
     */
    "aria-colindex"?: FunctionMaybe<number | string | RemoveAttribute>;
    /** Defines a human-readable text alternative of the numeric aria-colindex. */
    "aria-colindextext"?: FunctionMaybe<number | string | RemoveAttribute>;
    /**
     * Defines the number of columns spanned by a cell or gridcell within a table, grid, or
     * treegrid.
     *
     * @see aria-colindex @see aria-rowspan.
     */
    "aria-colspan"?: FunctionMaybe<number | string | RemoveAttribute>;
    /**
     * Identifies the element (or elements) whose contents or presence are controlled by the current
     * element.
     *
     * @see aria-owns.
     */
    "aria-controls"?: FunctionMaybe<string | RemoveAttribute>;
    /**
     * Indicates the element that represents the current item within a container or set of related
     * elements.
     */
    "aria-current"?: FunctionMaybe<
      EnumeratedPseudoBoolean | "page" | "step" | "location" | "date" | "time" | RemoveAttribute
    >;
    /**
     * Identifies the element (or elements) that describes the object.
     *
     * @see aria-labelledby
     */
    "aria-describedby"?: FunctionMaybe<string | RemoveAttribute>;
    /**
     * Defines a string value that describes or annotates the current element.
     *
     * @see aria-describedby
     */
    "aria-description"?: FunctionMaybe<string | RemoveAttribute>;
    /**
     * Identifies the element that provides a detailed, extended description for the object.
     *
     * @see aria-describedby.
     */
    "aria-details"?: FunctionMaybe<string | RemoveAttribute>;
    /**
     * Indicates that the element is perceivable but disabled, so it is not editable or otherwise
     * operable.
     *
     * @see aria-hidden @see aria-readonly.
     */
    "aria-disabled"?: FunctionMaybe<EnumeratedPseudoBoolean | RemoveAttribute>;
    /**
     * Indicates what functions can be performed when a dragged object is released on the drop
     * target.
     *
     * @deprecated In ARIA 1.1
     */
    "aria-dropeffect"?: FunctionMaybe<
      "none" | "copy" | "execute" | "link" | "move" | "popup" | RemoveAttribute
    >;
    /**
     * Identifies the element that provides an error message for the object.
     *
     * @see aria-invalid @see aria-describedby.
     */
    "aria-errormessage"?: FunctionMaybe<string | RemoveAttribute>;
    /**
     * Indicates whether the element, or another grouping element it controls, is currently expanded
     * or collapsed.
     */
    "aria-expanded"?: FunctionMaybe<EnumeratedPseudoBoolean | RemoveAttribute>;
    /**
     * Identifies the next element (or elements) in an alternate reading order of content which, at
     * the user's discretion, allows assistive technology to override the general default of reading
     * in document source order.
     */
    "aria-flowto"?: FunctionMaybe<string | RemoveAttribute>;
    /**
     * Indicates an element's "grabbed" state in a drag-and-drop operation.
     *
     * @deprecated In ARIA 1.1
     */
    "aria-grabbed"?: FunctionMaybe<EnumeratedPseudoBoolean | RemoveAttribute>;
    /**
     * Indicates the availability and type of interactive popup element, such as menu or dialog,
     * that can be triggered by an element.
     */
    "aria-haspopup"?: FunctionMaybe<
      EnumeratedPseudoBoolean | "menu" | "listbox" | "tree" | "grid" | "dialog" | RemoveAttribute
    >;
    /**
     * Indicates whether the element is exposed to an accessibility API.
     *
     * @see aria-disabled.
     */
    "aria-hidden"?: FunctionMaybe<EnumeratedPseudoBoolean | RemoveAttribute>;
    /**
     * Indicates the entered value does not conform to the format expected by the application.
     *
     * @see aria-errormessage.
     */
    "aria-invalid"?: FunctionMaybe<
      EnumeratedPseudoBoolean | "grammar" | "spelling" | RemoveAttribute
    >;
    /**
     * Indicates keyboard shortcuts that an author has implemented to activate or give focus to an
     * element.
     */
    "aria-keyshortcuts"?: FunctionMaybe<string | RemoveAttribute>;
    /**
     * Defines a string value that labels the current element.
     *
     * @see aria-labelledby.
     */
    "aria-label"?: FunctionMaybe<string | RemoveAttribute>;
    /**
     * Identifies the element (or elements) that labels the current element.
     *
     * @see aria-describedby.
     */
    "aria-labelledby"?: FunctionMaybe<string | RemoveAttribute>;
    /** Defines the hierarchical level of an element within a structure. */
    "aria-level"?: FunctionMaybe<number | string | RemoveAttribute>;
    /**
     * Indicates that an element will be updated, and describes the types of updates the user
     * agents, assistive technologies, and user can expect from the live region.
     */
    "aria-live"?: FunctionMaybe<"off" | "assertive" | "polite" | RemoveAttribute>;
    /** Indicates whether an element is modal when displayed. */
    "aria-modal"?: FunctionMaybe<EnumeratedPseudoBoolean | RemoveAttribute>;
    /** Indicates whether a text box accepts multiple lines of input or only a single line. */
    "aria-multiline"?: FunctionMaybe<EnumeratedPseudoBoolean | RemoveAttribute>;
    /**
     * Indicates that the user may select more than one item from the current selectable
     * descendants.
     */
    "aria-multiselectable"?: FunctionMaybe<EnumeratedPseudoBoolean | RemoveAttribute>;
    /** Indicates whether the element's orientation is horizontal, vertical, or unknown/ambiguous. */
    "aria-orientation"?: FunctionMaybe<"horizontal" | "vertical" | RemoveAttribute>;
    /**
     * Identifies an element (or elements) in order to define a visual, functional, or contextual
     * parent/child relationship between DOM elements where the DOM hierarchy cannot be used to
     * represent the relationship.
     *
     * @see aria-controls.
     */
    "aria-owns"?: FunctionMaybe<string | RemoveAttribute>;
    /**
     * Defines a short hint (a word or short phrase) intended to aid the user with data entry when
     * the control has no value. A hint could be a sample value or a brief description of the
     * expected format.
     */
    "aria-placeholder"?: FunctionMaybe<string | RemoveAttribute>;
    /**
     * Defines an element's number or position in the current set of listitems or treeitems. Not
     * required if all elements in the set are present in the DOM.
     *
     * @see aria-setsize.
     */
    "aria-posinset"?: FunctionMaybe<number | string | RemoveAttribute>;
    /**
     * Indicates the current "pressed" state of toggle buttons.
     *
     * @see aria-checked @see aria-selected.
     */
    "aria-pressed"?: FunctionMaybe<EnumeratedPseudoBoolean | "mixed" | RemoveAttribute>;
    /**
     * Indicates that the element is not editable, but is otherwise operable.
     *
     * @see aria-disabled.
     */
    "aria-readonly"?: FunctionMaybe<EnumeratedPseudoBoolean | RemoveAttribute>;
    /**
     * Indicates what notifications the user agent will trigger when the accessibility tree within a
     * live region is modified.
     *
     * @see aria-atomic.
     */
    "aria-relevant"?: FunctionMaybe<
      | "additions"
      | "additions removals"
      | "additions text"
      | "all"
      | "removals"
      | "removals additions"
      | "removals text"
      | "text"
      | "text additions"
      | "text removals"
      | RemoveAttribute
    >;
    /** Indicates that user input is required on the element before a form may be submitted. */
    "aria-required"?: FunctionMaybe<EnumeratedPseudoBoolean | RemoveAttribute>;
    /** Defines a human-readable, author-localized description for the role of an element. */
    "aria-roledescription"?: FunctionMaybe<string | RemoveAttribute>;
    /**
     * Defines the total number of rows in a table, grid, or treegrid.
     *
     * @see aria-rowindex.
     */
    "aria-rowcount"?: FunctionMaybe<number | string | RemoveAttribute>;
    /**
     * Defines an element's row index or position with respect to the total number of rows within a
     * table, grid, or treegrid.
     *
     * @see aria-rowcount @see aria-rowspan.
     */
    "aria-rowindex"?: FunctionMaybe<number | string | RemoveAttribute>;
    /** Defines a human-readable text alternative of aria-rowindex. */
    "aria-rowindextext"?: FunctionMaybe<number | string | RemoveAttribute>;

    /**
     * Defines the number of rows spanned by a cell or gridcell within a table, grid, or treegrid.
     *
     * @see aria-rowindex @see aria-colspan.
     */
    "aria-rowspan"?: FunctionMaybe<number | string | RemoveAttribute>;
    /**
     * Indicates the current "selected" state of various widgets.
     *
     * @see aria-checked @see aria-pressed.
     */
    "aria-selected"?: FunctionMaybe<EnumeratedPseudoBoolean | RemoveAttribute>;
    /**
     * Defines the number of items in the current set of listitems or treeitems. Not required if all
     * elements in the set are present in the DOM.
     *
     * @see aria-posinset.
     */
    "aria-setsize"?: FunctionMaybe<number | string | RemoveAttribute>;
    /** Indicates if items in a table or grid are sorted in ascending or descending order. */
    "aria-sort"?: FunctionMaybe<"none" | "ascending" | "descending" | "other" | RemoveAttribute>;
    /** Defines the maximum allowed value for a range widget. */
    "aria-valuemax"?: FunctionMaybe<number | string | RemoveAttribute>;
    /** Defines the minimum allowed value for a range widget. */
    "aria-valuemin"?: FunctionMaybe<number | string | RemoveAttribute>;
    /**
     * Defines the current value for a range widget.
     *
     * @see aria-valuetext.
     */
    "aria-valuenow"?: FunctionMaybe<number | string | RemoveAttribute>;
    /** Defines the human readable text alternative of aria-valuenow for a range widget. */
    "aria-valuetext"?: FunctionMaybe<string | RemoveAttribute>;
    role?: FunctionMaybe<
      | "alert"
      | "alertdialog"
      | "application"
      | "article"
      | "banner"
      | "button"
      | "cell"
      | "checkbox"
      | "columnheader"
      | "combobox"
      | "complementary"
      | "contentinfo"
      | "definition"
      | "dialog"
      | "directory"
      | "document"
      | "feed"
      | "figure"
      | "form"
      | "grid"
      | "gridcell"
      | "group"
      | "heading"
      | "img"
      | "link"
      | "list"
      | "listbox"
      | "listitem"
      | "log"
      | "main"
      | "marquee"
      | "math"
      | "menu"
      | "menubar"
      | "menuitem"
      | "menuitemcheckbox"
      | "menuitemradio"
      | "meter"
      | "navigation"
      | "none"
      | "note"
      | "option"
      | "presentation"
      | "progressbar"
      | "radio"
      | "radiogroup"
      | "region"
      | "row"
      | "rowgroup"
      | "rowheader"
      | "scrollbar"
      | "search"
      | "searchbox"
      | "separator"
      | "slider"
      | "spinbutton"
      | "status"
      | "switch"
      | "tab"
      | "table"
      | "tablist"
      | "tabpanel"
      | "term"
      | "textbox"
      | "timer"
      | "toolbar"
      | "tooltip"
      | "tree"
      | "treegrid"
      | "treeitem"
      | RemoveAttribute
    >;
  }

  // EVENTS

  /**
   * `Window` events, defined for `<body>`, `<svg>`, `<frameset>` tags.
   *
   * Excluding `EventHandlersElement` events already defined as globals that all tags share, such as
   * `onblur`.
   */
  interface EventHandlersWindow<T> {
    onAfterPrint?: EventHandlerUnion<T, Event> | undefined;
    onBeforePrint?: EventHandlerUnion<T, Event> | undefined;
    onBeforeUnload?: EventHandlerUnion<T, BeforeUnloadEvent> | undefined;
    onGamepadConnected?: EventHandlerUnion<T, GamepadEvent> | undefined;
    onGamepadDisconnected?: EventHandlerUnion<T, GamepadEvent> | undefined;
    onHashchange?: EventHandlerUnion<T, HashChangeEvent> | undefined;
    onLanguageChange?: EventHandlerUnion<T, Event> | undefined;
    onMessage?: EventHandlerUnion<T, MessageEvent> | undefined;
    onMessageError?: EventHandlerUnion<T, MessageEvent> | undefined;
    onOffline?: EventHandlerUnion<T, Event> | undefined;
    onOnline?: EventHandlerUnion<T, Event> | undefined;
    onPageHide?: EventHandlerUnion<T, PageTransitionEvent> | undefined;
    // TODO `PageRevealEvent` is currently undefined on TS
    onPageReveal?: EventHandlerUnion<T, Event> | undefined;
    onPageShow?: EventHandlerUnion<T, PageTransitionEvent> | undefined;
    // TODO `PageSwapEvent` is currently undefined on TS
    onPageSwap?: EventHandlerUnion<T, Event> | undefined;
    onPopstate?: EventHandlerUnion<T, PopStateEvent> | undefined;
    onRejectionHandled?: EventHandlerUnion<T, PromiseRejectionEvent> | undefined;
    onStorage?: EventHandlerUnion<T, StorageEvent> | undefined;
    onUnhandledRejection?: EventHandlerUnion<T, PromiseRejectionEvent> | undefined;
    onUnload?: EventHandlerUnion<T, Event> | undefined;

    "on:afterprint"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:beforeprint"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:beforeunload"?: EventHandlerWithOptionsUnion<T, BeforeUnloadEvent> | undefined;
    "on:gamepadconnected"?: EventHandlerWithOptionsUnion<T, GamepadEvent> | undefined;
    "on:gamepaddisconnected"?: EventHandlerWithOptionsUnion<T, GamepadEvent> | undefined;
    "on:hashchange"?: EventHandlerWithOptionsUnion<T, HashChangeEvent> | undefined;
    "on:languagechange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:message"?: EventHandlerWithOptionsUnion<T, MessageEvent> | undefined;
    "on:messageerror"?: EventHandlerWithOptionsUnion<T, MessageEvent> | undefined;
    "on:offline"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:online"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:pagehide"?: EventHandlerWithOptionsUnion<T, PageTransitionEvent> | undefined;
    // TODO `PageRevealEvent` is currently undefined in TS
    "on:pagereveal"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:pageshow"?: EventHandlerWithOptionsUnion<T, PageTransitionEvent> | undefined;
    // TODO `PageSwapEvent` is currently undefined in TS
    "on:pageswap"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:popstate"?: EventHandlerWithOptionsUnion<T, PopStateEvent> | undefined;
    "on:rejectionhandled"?: EventHandlerWithOptionsUnion<T, PromiseRejectionEvent> | undefined;
    "on:storage"?: EventHandlerWithOptionsUnion<T, StorageEvent> | undefined;
    "on:unhandledrejection"?: EventHandlerWithOptionsUnion<T, PromiseRejectionEvent> | undefined;
    "on:unload"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
  }

  /**
   * Global `EventHandlersElement`, defined for all tags.
   *
   * That's events defined and shared BY ALL of the `HTMLElement/SVGElement/MathMLElement`
   * interfaces.
   *
   * Includes events defined for the `Element` interface.
   */
  interface EventHandlersElement<T> {
    onAbort?: EventHandlerUnion<T, UIEvent> | undefined;
    onAnimationCancel?: EventHandlerUnion<T, AnimationEvent> | undefined;
    onAnimationEnd?: EventHandlerUnion<T, AnimationEvent> | undefined;
    onAnimationIteration?: EventHandlerUnion<T, AnimationEvent> | undefined;
    onAnimationStart?: EventHandlerUnion<T, AnimationEvent> | undefined;
    onAuxClick?: EventHandlerUnion<T, PointerEvent> | undefined;
    onBeforeCopy?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    onBeforeCut?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    onBeforeInput?: InputEventHandlerUnion<T, InputEvent> | undefined;
    onBeforeMatch?: EventHandlerUnion<T, Event> | undefined;
    onBeforePaste?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    onBeforeToggle?: EventHandlerUnion<T, ToggleEvent> | undefined;
    onBeforeXRSelect?: EventHandlerUnion<T, Event> | undefined;
    onBlur?: FocusEventHandlerUnion<T, FocusEvent> | undefined;
    onCancel?: EventHandlerUnion<T, Event> | undefined;
    onCanPlay?: EventHandlerUnion<T, Event> | undefined;
    onCanPlayThrough?: EventHandlerUnion<T, Event> | undefined;
    onChange?: ChangeEventHandlerUnion<T, Event> | undefined;
    onClick?: EventHandlerUnion<T, MouseEvent> | undefined;
    onClose?: EventHandlerUnion<T, Event> | undefined;
    // TODO `CommandEvent` is currently undefined in TS
    onCommand?: EventHandlerUnion<T, Event> | undefined;
    onCompositionEnd?: EventHandlerUnion<T, CompositionEvent> | undefined;
    onCompositionStart?: EventHandlerUnion<T, CompositionEvent> | undefined;
    onCompositionUpdate?: EventHandlerUnion<T, CompositionEvent> | undefined;
    onContentVisibilityAutoStateChange?:
      | EventHandlerUnion<T, ContentVisibilityAutoStateChangeEvent>
      | undefined;
    onContextLost?: EventHandlerUnion<T, Event> | undefined;
    onContextMenu?: EventHandlerUnion<T, PointerEvent> | undefined;
    onContextRestored?: EventHandlerUnion<T, Event> | undefined;
    onCopy?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    onCueChange?: EventHandlerUnion<T, Event> | undefined;
    onCut?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    onDblClick?: EventHandlerUnion<T, MouseEvent> | undefined;
    onDrag?: EventHandlerUnion<T, DragEvent> | undefined;
    onDragEnd?: EventHandlerUnion<T, DragEvent> | undefined;
    onDragEnter?: EventHandlerUnion<T, DragEvent> | undefined;
    onDragExit?: EventHandlerUnion<T, DragEvent> | undefined;
    onDragLeave?: EventHandlerUnion<T, DragEvent> | undefined;
    onDragOver?: EventHandlerUnion<T, DragEvent> | undefined;
    onDragStart?: EventHandlerUnion<T, DragEvent> | undefined;
    onDrop?: EventHandlerUnion<T, DragEvent> | undefined;
    onDurationChange?: EventHandlerUnion<T, Event> | undefined;
    onEmptied?: EventHandlerUnion<T, Event> | undefined;
    onEnded?: EventHandlerUnion<T, Event> | undefined;
    onError?: EventHandlerUnion<T, ErrorEvent> | undefined;
    onFocus?: FocusEventHandlerUnion<T, FocusEvent> | undefined;
    onFocusIn?: FocusEventHandlerUnion<T, FocusEvent> | undefined;
    onFocusOut?: FocusEventHandlerUnion<T, FocusEvent> | undefined;
    onFormData?: EventHandlerUnion<T, FormDataEvent> | undefined;
    onFullscreenChange?: EventHandlerUnion<T, Event> | undefined;
    onFullscreenError?: EventHandlerUnion<T, Event> | undefined;
    onGotPointerCapture?: EventHandlerUnion<T, PointerEvent> | undefined;
    onInput?: InputEventHandlerUnion<T, InputEvent> | undefined;
    onInvalid?: EventHandlerUnion<T, Event> | undefined;
    onKeyDown?: EventHandlerUnion<T, KeyboardEvent> | undefined;
    onKeyPress?: EventHandlerUnion<T, KeyboardEvent> | undefined;
    onKeyUp?: EventHandlerUnion<T, KeyboardEvent> | undefined;
    onLoad?: EventHandlerUnion<T, Event> | undefined;
    onLoadedData?: EventHandlerUnion<T, Event> | undefined;
    onLoadedMetadata?: EventHandlerUnion<T, Event> | undefined;
    onLoadStart?: EventHandlerUnion<T, Event> | undefined;
    onLostPointerCapture?: EventHandlerUnion<T, PointerEvent> | undefined;
    onMouseDown?: EventHandlerUnion<T, MouseEvent> | undefined;
    onMouseEnter?: EventHandlerUnion<T, MouseEvent> | undefined;
    onMouseLeave?: EventHandlerUnion<T, MouseEvent> | undefined;
    onMouseMove?: EventHandlerUnion<T, MouseEvent> | undefined;
    onMouseOut?: EventHandlerUnion<T, MouseEvent> | undefined;
    onMouseOver?: EventHandlerUnion<T, MouseEvent> | undefined;
    onMouseUp?: EventHandlerUnion<T, MouseEvent> | undefined;
    onPaste?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    onPause?: EventHandlerUnion<T, Event> | undefined;
    onPlay?: EventHandlerUnion<T, Event> | undefined;
    onPlaying?: EventHandlerUnion<T, Event> | undefined;
    onPointerCancel?: EventHandlerUnion<T, PointerEvent> | undefined;
    onPointerDown?: EventHandlerUnion<T, PointerEvent> | undefined;
    onPointerEnter?: EventHandlerUnion<T, PointerEvent> | undefined;
    onPointerLeave?: EventHandlerUnion<T, PointerEvent> | undefined;
    onPointerMove?: EventHandlerUnion<T, PointerEvent> | undefined;
    onPointerOut?: EventHandlerUnion<T, PointerEvent> | undefined;
    onPointerOver?: EventHandlerUnion<T, PointerEvent> | undefined;
    onPointerRawUpdate?: EventHandlerUnion<T, PointerEvent> | undefined;
    onPointerUp?: EventHandlerUnion<T, PointerEvent> | undefined;
    onProgress?: EventHandlerUnion<T, ProgressEvent> | undefined;
    onRateChange?: EventHandlerUnion<T, Event> | undefined;
    onReset?: EventHandlerUnion<T, Event> | undefined;
    onResize?: EventHandlerUnion<T, UIEvent> | undefined;
    onScroll?: EventHandlerUnion<T, Event> | undefined;
    onScrollEnd?: EventHandlerUnion<T, Event> | undefined;
    // todo `SnapEvent` is currently undefined in TS
    onScrollSnapChange?: EventHandlerUnion<T, Event> | undefined;
    // todo `SnapEvent` is currently undefined in TS
    onScrollSnapChanging?: EventHandlerUnion<T, Event> | undefined;
    onSecurityPolicyViolation?: EventHandlerUnion<T, SecurityPolicyViolationEvent> | undefined;
    onSeeked?: EventHandlerUnion<T, Event> | undefined;
    onSeeking?: EventHandlerUnion<T, Event> | undefined;
    onSelect?: EventHandlerUnion<T, Event> | undefined;
    onSelectionChange?: EventHandlerUnion<T, Event> | undefined;
    onSelectStart?: EventHandlerUnion<T, Event> | undefined;
    onSlotChange?: EventHandlerUnion<T, Event> | undefined;
    onStalled?: EventHandlerUnion<T, Event> | undefined;
    onSubmit?: EventHandlerUnion<T, SubmitEvent> | undefined;
    onSuspend?: EventHandlerUnion<T, Event> | undefined;
    onTimeUpdate?: EventHandlerUnion<T, Event> | undefined;
    onToggle?: EventHandlerUnion<T, ToggleEvent> | undefined;
    onTouchCancel?: EventHandlerUnion<T, TouchEvent> | undefined;
    onTouchEnd?: EventHandlerUnion<T, TouchEvent> | undefined;
    onTouchMove?: EventHandlerUnion<T, TouchEvent> | undefined;
    onTouchStart?: EventHandlerUnion<T, TouchEvent> | undefined;
    onTransitionCancel?: EventHandlerUnion<T, TransitionEvent> | undefined;
    onTransitionEnd?: EventHandlerUnion<T, TransitionEvent> | undefined;
    onTransitionRun?: EventHandlerUnion<T, TransitionEvent> | undefined;
    onTransitionStart?: EventHandlerUnion<T, TransitionEvent> | undefined;
    onVolumeChange?: EventHandlerUnion<T, Event> | undefined;
    onWaiting?: EventHandlerUnion<T, Event> | undefined;
    onWheel?: EventHandlerUnion<T, WheelEvent> | undefined;

    "on:abort"?: EventHandlerWithOptionsUnion<T, UIEvent> | undefined;
    "on:animationcancel"?: EventHandlerWithOptionsUnion<T, AnimationEvent> | undefined;
    "on:animationend"?: EventHandlerWithOptionsUnion<T, AnimationEvent> | undefined;
    "on:animationiteration"?: EventHandlerWithOptionsUnion<T, AnimationEvent> | undefined;
    "on:animationstart"?: EventHandlerWithOptionsUnion<T, AnimationEvent> | undefined;
    "on:auxclick"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:beforecopy"?: EventHandlerWithOptionsUnion<T, ClipboardEvent> | undefined;
    "on:beforecut"?: EventHandlerWithOptionsUnion<T, ClipboardEvent> | undefined;
    "on:beforeinput"?:
      | EventHandlerWithOptionsUnion<T, InputEvent, InputEventHandler<T, InputEvent>>
      | undefined;
    "on:beforematch"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:beforepaste"?: EventHandlerWithOptionsUnion<T, ClipboardEvent> | undefined;
    "on:beforetoggle"?: EventHandlerWithOptionsUnion<T, ToggleEvent> | undefined;
    "on:beforexrselect"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:blur"?:
      | EventHandlerWithOptionsUnion<T, FocusEvent, FocusEventHandler<T, FocusEvent>>
      | undefined;
    "on:cancel"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:canplay"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:canplaythrough"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:change"?: EventHandlerWithOptionsUnion<T, Event, ChangeEventHandler<T, Event>> | undefined;
    "on:click"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:close"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    // TODO `CommandEvent` is currently undefined in TS
    "on:command"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:compositionend"?: EventHandlerWithOptionsUnion<T, CompositionEvent> | undefined;
    "on:compositionstart"?: EventHandlerWithOptionsUnion<T, CompositionEvent> | undefined;
    "on:compositionupdate"?: EventHandlerWithOptionsUnion<T, CompositionEvent> | undefined;
    "on:contentvisibilityautostatechange"?:
      | EventHandlerWithOptionsUnion<T, ContentVisibilityAutoStateChangeEvent>
      | undefined;
    "on:contextlost"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:contextmenu"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:contextrestored"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:copy"?: EventHandlerWithOptionsUnion<T, ClipboardEvent> | undefined;
    "on:cuechange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:cut"?: EventHandlerWithOptionsUnion<T, ClipboardEvent> | undefined;
    "on:dblclick"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:drag"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:dragend"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:dragenter"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:dragexit"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:dragleave"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:dragover"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:dragstart"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:drop"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:durationchange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:emptied"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:ended"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:error"?: EventHandlerWithOptionsUnion<T, ErrorEvent> | undefined;
    "on:focus"?:
      | EventHandlerWithOptionsUnion<T, FocusEvent, FocusEventHandler<T, FocusEvent>>
      | undefined;
    "on:focusin"?:
      | EventHandlerWithOptionsUnion<T, FocusEvent, FocusEventHandler<T, FocusEvent>>
      | undefined;
    "on:focusout"?:
      | EventHandlerWithOptionsUnion<T, FocusEvent, FocusEventHandler<T, FocusEvent>>
      | undefined;
    "on:formdata"?: EventHandlerWithOptionsUnion<T, FormDataEvent> | undefined;
    "on:fullscreenchange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:fullscreenerror"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:gotpointercapture"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:input"?:
      | EventHandlerWithOptionsUnion<T, InputEvent, InputEventHandler<T, InputEvent>>
      | undefined;
    "on:invalid"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:keydown"?: EventHandlerWithOptionsUnion<T, KeyboardEvent> | undefined;
    "on:keypress"?: EventHandlerWithOptionsUnion<T, KeyboardEvent> | undefined;
    "on:keyup"?: EventHandlerWithOptionsUnion<T, KeyboardEvent> | undefined;
    "on:load"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:loadeddata"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:loadedmetadata"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:loadstart"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:lostpointercapture"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:mousedown"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:mouseenter"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:mouseleave"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:mousemove"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:mouseout"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:mouseover"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:mouseup"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:paste"?: EventHandlerWithOptionsUnion<T, ClipboardEvent> | undefined;
    "on:pause"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:play"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:playing"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:pointercancel"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:pointerdown"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:pointerenter"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:pointerleave"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:pointermove"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:pointerout"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:pointerover"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:pointerrawupdate"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:pointerup"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:progress"?: EventHandlerWithOptionsUnion<T, ProgressEvent> | undefined;
    "on:ratechange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:reset"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:resize"?: EventHandlerWithOptionsUnion<T, UIEvent> | undefined;
    "on:scroll"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:scrollend"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    // todo `SnapEvent` is currently undefined in TS
    "on:scrollsnapchange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    // todo `SnapEvent` is currently undefined in TS
    "on:scrollsnapchanging"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:securitypolicyviolation"?:
      | EventHandlerWithOptionsUnion<T, SecurityPolicyViolationEvent>
      | undefined;
    "on:seeked"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:seeking"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:select"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:selectionchange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:selectstart"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:slotchange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:stalled"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:submit"?: EventHandlerWithOptionsUnion<T, SubmitEvent> | undefined;
    "on:suspend"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:timeupdate"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:toggle"?: EventHandlerWithOptionsUnion<T, ToggleEvent> | undefined;
    "on:touchcancel"?: EventHandlerWithOptionsUnion<T, TouchEvent> | undefined;
    "on:touchend"?: EventHandlerWithOptionsUnion<T, TouchEvent> | undefined;
    "on:touchmove"?: EventHandlerWithOptionsUnion<T, TouchEvent> | undefined;
    "on:touchstart"?: EventHandlerWithOptionsUnion<T, TouchEvent> | undefined;
    "on:transitioncancel"?: EventHandlerWithOptionsUnion<T, TransitionEvent> | undefined;
    "on:transitionend"?: EventHandlerWithOptionsUnion<T, TransitionEvent> | undefined;
    "on:transitionrun"?: EventHandlerWithOptionsUnion<T, TransitionEvent> | undefined;
    "on:transitionstart"?: EventHandlerWithOptionsUnion<T, TransitionEvent> | undefined;
    "on:volumechange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:waiting"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:wheel"?: EventHandlerWithOptionsUnion<T, WheelEvent> | undefined;
  }

  // EventName = "click" | "mousedown" ...

  type EventName =
    | (keyof EventHandlersWindow<any> extends infer K
        ? K extends `on:${infer T}`
          ? T
          : K extends `on${infer T}`
            ? Lowercase<T>
            : never
        : never)
    | (keyof EventHandlersElement<any> extends infer K
        ? K extends `on:${infer T}`
          ? T
          : K extends `on${infer T}`
            ? Lowercase<T>
            : never
        : never)
    | (string & {});

  type ExtractEventType<T> = {
    [K in keyof T as K extends `on:${infer Name}`
      ? Name
      : never]: T[K] extends EventHandlerWithOptionsUnion<Element, infer E> ? E : never;
  };

  // EventType["click"] = MouseEvent

  type EventType = ExtractEventType<EventHandlersElement<Element>> &
    ExtractEventType<EventHandlersWindow<Element>>;

  // GLOBAL ATTRIBUTES

  /**
   * Global `Element` + `Node` interface keys, shared by all tags regardless of their namespace:
   *
   * 1. That's `keys` that are defined BY ALL `HTMLElement/SVGElement/MathMLElement` interfaces.
   * 2. Includes `keys` defined by `Element` and `Node` interfaces.
   */
  interface ElementAttributes<T>
    extends
      CustomAttributes<T>,
      PropAttributes,
      OnAttributes<T>,
      EventHandlersElement<T>,
      AriaAttributes {
    // [key: ClassKeys]: boolean;

    // properties
    innerHTML?: FunctionMaybe<string>;
    textContent?: FunctionMaybe<string | number>;

    // attributes
    autofocus?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    class?: FunctionMaybe<string | ClassList | RemoveAttribute>;
    elementtiming?: FunctionMaybe<string | RemoveAttribute>;
    id?: FunctionMaybe<string | RemoveAttribute>;
    nonce?: FunctionMaybe<string | RemoveAttribute>;
    part?: FunctionMaybe<string | RemoveAttribute>;
    slot?: FunctionMaybe<string | RemoveAttribute>;
    style?: FunctionMaybe<CSSProperties | string | RemoveAttribute>;
    tabindex?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  /** Global `SVGElement` interface keys only. */
  interface SVGAttributes<T> extends ElementAttributes<T> {
    id?: FunctionMaybe<string | RemoveAttribute>;
    lang?: FunctionMaybe<string | RemoveAttribute>;
    tabindex?: FunctionMaybe<number | string | RemoveAttribute>;
    xmlns?: FunctionMaybe<string | RemoveAttribute>;
  }
  /** Global `MathMLElement` interface keys only. */
  interface MathMLAttributes<T> extends ElementAttributes<T> {
    dir?: FunctionMaybe<HTMLDir | RemoveAttribute>;
    displaystyle?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    scriptlevel?: FunctionMaybe<string | RemoveAttribute>;
    xmlns?: FunctionMaybe<string | RemoveAttribute>;

    /** @deprecated */
    href?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    mathbackground?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    mathcolor?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    mathsize?: FunctionMaybe<string | RemoveAttribute>;
  }
  /** Global `HTMLElement` interface keys only. */
  interface HTMLAttributes<T> extends ElementAttributes<T> {
    // properties
    innerText?: FunctionMaybe<string | number>;

    // attributes
    accesskey?: FunctionMaybe<string | RemoveAttribute>;
    autocapitalize?: FunctionMaybe<HTMLAutocapitalize | RemoveAttribute>;
    autocorrect?: FunctionMaybe<"on" | "off" | RemoveAttribute>;
    contenteditable?: FunctionMaybe<
      | EnumeratedPseudoBoolean
      | EnumeratedAcceptsEmpty
      | "plaintext-only"
      | "inherit"
      | RemoveAttribute
    >;
    dir?: FunctionMaybe<HTMLDir | RemoveAttribute>;
    draggable?: FunctionMaybe<EnumeratedPseudoBoolean | RemoveAttribute>;
    enterkeyhint?: FunctionMaybe<
      "enter" | "done" | "go" | "next" | "previous" | "search" | "send" | RemoveAttribute
    >;
    exportparts?: FunctionMaybe<string | RemoveAttribute>;
    hidden?: FunctionMaybe<EnumeratedAcceptsEmpty | "hidden" | "until-found" | RemoveAttribute>;
    inert?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    inputmode?: FunctionMaybe<
      "decimal" | "email" | "none" | "numeric" | "search" | "tel" | "text" | "url" | RemoveAttribute
    >;
    is?: FunctionMaybe<string | RemoveAttribute>;
    lang?: FunctionMaybe<string | RemoveAttribute>;
    popover?: FunctionMaybe<EnumeratedAcceptsEmpty | "manual" | "auto" | RemoveAttribute>;
    spellcheck?: FunctionMaybe<EnumeratedPseudoBoolean | EnumeratedAcceptsEmpty | RemoveAttribute>;
    title?: FunctionMaybe<string | RemoveAttribute>;
    translate?: FunctionMaybe<"yes" | "no" | RemoveAttribute>;

    /** @experimental */
    virtualkeyboardpolicy?: FunctionMaybe<
      EnumeratedAcceptsEmpty | "auto" | "manual" | RemoveAttribute
    >;
    /** @experimental */
    writingsuggestions?: FunctionMaybe<EnumeratedPseudoBoolean | RemoveAttribute>;

    // Microdata
    itemid?: FunctionMaybe<string | RemoveAttribute>;
    itemprop?: FunctionMaybe<string | RemoveAttribute>;
    itemref?: FunctionMaybe<string | RemoveAttribute>;
    itemscope?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    itemtype?: FunctionMaybe<string | RemoveAttribute>;

    // RDFa Attributes
    about?: FunctionMaybe<string | RemoveAttribute>;
    datatype?: FunctionMaybe<string | RemoveAttribute>;
    inlist?: FunctionMaybe<any | RemoveAttribute>;
    prefix?: FunctionMaybe<string | RemoveAttribute>;
    property?: FunctionMaybe<string | RemoveAttribute>;
    resource?: FunctionMaybe<string | RemoveAttribute>;
    typeof?: FunctionMaybe<string | RemoveAttribute>;
    vocab?: FunctionMaybe<string | RemoveAttribute>;

    /** @deprecated */
    contextmenu?: FunctionMaybe<string | RemoveAttribute>;
  }

  // HTML

  type HTMLAutocapitalize = "off" | "none" | "on" | "sentences" | "words" | "characters";
  type HTMLAutocomplete =
    | "additional-name"
    | "address-level1"
    | "address-level2"
    | "address-level3"
    | "address-level4"
    | "address-line1"
    | "address-line2"
    | "address-line3"
    | "bday"
    | "bday-day"
    | "bday-month"
    | "bday-year"
    | "billing"
    | "cc-additional-name"
    | "cc-csc"
    | "cc-exp"
    | "cc-exp-month"
    | "cc-exp-year"
    | "cc-family-name"
    | "cc-given-name"
    | "cc-name"
    | "cc-number"
    | "cc-type"
    | "country"
    | "country-name"
    | "current-password"
    | "email"
    | "family-name"
    | "fax"
    | "given-name"
    | "home"
    | "honorific-prefix"
    | "honorific-suffix"
    | "impp"
    | "language"
    | "mobile"
    | "name"
    | "new-password"
    | "nickname"
    | "off"
    | "on"
    | "organization"
    | "organization-title"
    | "pager"
    | "photo"
    | "postal-code"
    | "sex"
    | "shipping"
    | "street-address"
    | "tel"
    | "tel-area-code"
    | "tel-country-code"
    | "tel-extension"
    | "tel-local"
    | "tel-local-prefix"
    | "tel-local-suffix"
    | "tel-national"
    | "transaction-amount"
    | "transaction-currency"
    | "url"
    | "username"
    | "work"
    | (string & {});
  type HTMLDir = "ltr" | "rtl" | "auto";
  type HTMLFormEncType = "application/x-www-form-urlencoded" | "multipart/form-data" | "text/plain";
  type HTMLFormMethod = "post" | "get" | "dialog";
  type HTMLCrossorigin = "anonymous" | "use-credentials" | EnumeratedAcceptsEmpty;
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
    | "allow-downloads"
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
    | "allow-top-navigation-by-user-activation"
    | "allow-top-navigation-to-custom-protocols";
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

  interface AnchorHTMLAttributes<T> extends HTMLAttributes<T> {
    download?: FunctionMaybe<string | EnumeratedAcceptsEmpty | RemoveAttribute>;
    href?: FunctionMaybe<string | RemoveAttribute>;
    hreflang?: FunctionMaybe<string | RemoveAttribute>;
    ping?: FunctionMaybe<string | RemoveAttribute>;
    referrerpolicy?: FunctionMaybe<HTMLReferrerPolicy | RemoveAttribute>;
    rel?: FunctionMaybe<string | RemoveAttribute>;
    target?: FunctionMaybe<
      "_self" | "_blank" | "_parent" | "_top" | (string & {}) | RemoveAttribute
    >;
    type?: FunctionMaybe<string | RemoveAttribute>;

    /** @experimental */
    attributionsrc?: FunctionMaybe<string | RemoveAttribute>;

    /** @deprecated */
    charset?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    coords?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    name?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    rev?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    shape?: FunctionMaybe<"rect" | "circle" | "poly" | "default" | RemoveAttribute>;
  }
  interface AudioHTMLAttributes<T> extends MediaHTMLAttributes<T> {}
  interface AreaHTMLAttributes<T> extends HTMLAttributes<T> {
    alt?: FunctionMaybe<string | RemoveAttribute>;
    coords?: FunctionMaybe<string | RemoveAttribute>;
    download?: FunctionMaybe<string | EnumeratedAcceptsEmpty | RemoveAttribute>;
    href?: FunctionMaybe<string | RemoveAttribute>;
    ping?: FunctionMaybe<string | RemoveAttribute>;
    referrerpolicy?: FunctionMaybe<HTMLReferrerPolicy | RemoveAttribute>;
    rel?: FunctionMaybe<string | RemoveAttribute>;
    shape?: FunctionMaybe<"rect" | "circle" | "poly" | "default" | RemoveAttribute>;
    target?: FunctionMaybe<
      "_self" | "_blank" | "_parent" | "_top" | (string & {}) | RemoveAttribute
    >;

    /** @experimental */
    attributionsrc?: FunctionMaybe<string | RemoveAttribute>;

    /** @deprecated */
    nohref?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
  }
  interface BaseHTMLAttributes<T> extends HTMLAttributes<T> {
    href?: FunctionMaybe<string | RemoveAttribute>;
    target?: FunctionMaybe<
      "_self" | "_blank" | "_parent" | "_top" | (string & {}) | RemoveAttribute
    >;
  }
  interface BdoHTMLAttributes<T> extends HTMLAttributes<T> {
    dir?: FunctionMaybe<"ltr" | "rtl" | RemoveAttribute>;
  }
  interface BlockquoteHTMLAttributes<T> extends HTMLAttributes<T> {
    cite?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface BodyHTMLAttributes<T> extends HTMLAttributes<T>, EventHandlersWindow<T> {}
  interface ButtonHTMLAttributes<T> extends HTMLAttributes<T> {
    disabled?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    form?: FunctionMaybe<string | RemoveAttribute>;
    formaction?: FunctionMaybe<string | SerializableAttributeValue | RemoveAttribute>;
    formenctype?: FunctionMaybe<HTMLFormEncType | RemoveAttribute>;
    formmethod?: FunctionMaybe<HTMLFormMethod | RemoveAttribute>;
    formnovalidate?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    formtarget?: FunctionMaybe<
      "_self" | "_blank" | "_parent" | "_top" | (string & {}) | RemoveAttribute
    >;
    name?: FunctionMaybe<string | RemoveAttribute>;
    popovertarget?: FunctionMaybe<string | RemoveAttribute>;
    popovertargetaction?: FunctionMaybe<"hide" | "show" | "toggle" | RemoveAttribute>;
    type?: FunctionMaybe<"submit" | "reset" | "button" | "menu" | RemoveAttribute>;
    value?: FunctionMaybe<string | RemoveAttribute>;

    /** @experimental */
    command?: FunctionMaybe<
      | "show-modal"
      | "close"
      | "show-popover"
      | "hide-popover"
      | "toggle-popover"
      | (string & {})
      | RemoveAttribute
    >;
    /** @experimental */
    commandfor?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface CanvasHTMLAttributes<T> extends HTMLAttributes<T> {
    height?: FunctionMaybe<number | string | RemoveAttribute>;
    width?: FunctionMaybe<number | string | RemoveAttribute>;

    /**
     * @deprecated
     * @non-standard
     */
    "moz-opaque"?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
  }
  interface CaptionHTMLAttributes<T> extends HTMLAttributes<T> {
    /** @deprecated */
    align?: FunctionMaybe<"left" | "center" | "right" | RemoveAttribute>;
  }
  interface ColHTMLAttributes<T> extends HTMLAttributes<T> {
    span?: FunctionMaybe<number | string | RemoveAttribute>;

    /** @deprecated */
    align?: FunctionMaybe<"left" | "center" | "right" | "justify" | "char" | RemoveAttribute>;
    /** @deprecated */
    bgcolor?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    char?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    charoff?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    valign?: FunctionMaybe<"baseline" | "bottom" | "middle" | "top" | RemoveAttribute>;
    /** @deprecated */
    width?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface ColgroupHTMLAttributes<T> extends HTMLAttributes<T> {
    span?: FunctionMaybe<number | string | RemoveAttribute>;

    /** @deprecated */
    align?: FunctionMaybe<"left" | "center" | "right" | "justify" | "char" | RemoveAttribute>;
    /** @deprecated */
    bgcolor?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    char?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    charoff?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    valign?: FunctionMaybe<"baseline" | "bottom" | "middle" | "top" | RemoveAttribute>;
    /** @deprecated */
    width?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface DataHTMLAttributes<T> extends HTMLAttributes<T> {
    value?: FunctionMaybe<string | string[] | number | RemoveAttribute>;
  }
  interface DetailsHtmlAttributes<T> extends HTMLAttributes<T> {
    name?: FunctionMaybe<string | RemoveAttribute>;
    open?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
  }
  interface DialogHtmlAttributes<T> extends HTMLAttributes<T> {
    open?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    /**
     * Do not add the `tabindex` property to the `<dialog>` element as it is not interactive and
     * does not receive focus. The dialog's contents, including the close button contained in the
     * dialog, can receive focus and be interactive.
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog#usage_notes
     */
    tabindex?: never;

    /** @experimental */
    closedby?: FunctionMaybe<"any" | "closerequest" | "none" | RemoveAttribute>;
  }
  interface EmbedHTMLAttributes<T> extends HTMLAttributes<T> {
    height?: FunctionMaybe<number | string | RemoveAttribute>;
    src?: FunctionMaybe<string | RemoveAttribute>;
    type?: FunctionMaybe<string | RemoveAttribute>;
    width?: FunctionMaybe<number | string | RemoveAttribute>;

    /** @deprecated */
    align?: FunctionMaybe<"left" | "right" | "justify" | "center" | RemoveAttribute>;
    /** @deprecated */
    name?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface FieldsetHTMLAttributes<T> extends HTMLAttributes<T> {
    disabled?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    form?: FunctionMaybe<string | RemoveAttribute>;
    name?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface FormHTMLAttributes<T> extends HTMLAttributes<T> {
    "accept-charset"?: FunctionMaybe<string | RemoveAttribute>;
    action?: FunctionMaybe<string | SerializableAttributeValue | RemoveAttribute>;
    autocomplete?: FunctionMaybe<"on" | "off" | RemoveAttribute>;
    encoding?: FunctionMaybe<HTMLFormEncType | RemoveAttribute>;
    enctype?: FunctionMaybe<HTMLFormEncType | RemoveAttribute>;
    method?: FunctionMaybe<HTMLFormMethod | RemoveAttribute>;
    name?: FunctionMaybe<string | RemoveAttribute>;
    novalidate?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    rel?: FunctionMaybe<string | RemoveAttribute>;
    target?: FunctionMaybe<
      "_self" | "_blank" | "_parent" | "_top" | (string & {}) | RemoveAttribute
    >;

    /** @deprecated */
    accept?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface IframeHTMLAttributes<T> extends HTMLAttributes<T> {
    allow?: FunctionMaybe<string | RemoveAttribute>;
    allowfullscreen?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    height?: FunctionMaybe<number | string | RemoveAttribute>;
    loading?: FunctionMaybe<"eager" | "lazy" | RemoveAttribute>;
    name?: FunctionMaybe<string | RemoveAttribute>;
    referrerpolicy?: FunctionMaybe<HTMLReferrerPolicy | RemoveAttribute>;
    sandbox?: FunctionMaybe<HTMLIframeSandbox | string | RemoveAttribute>;
    src?: FunctionMaybe<string | RemoveAttribute>;
    srcdoc?: FunctionMaybe<string | RemoveAttribute>;
    width?: FunctionMaybe<number | string | RemoveAttribute>;

    /** @experimental */
    adauctionheaders?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    /**
     * @non-standard
     * @experimental
     */
    browsingtopics?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    /** @experimental */
    credentialless?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    /** @experimental */
    csp?: FunctionMaybe<string | RemoveAttribute>;
    /** @experimental */
    privatetoken?: FunctionMaybe<string | RemoveAttribute>;
    /** @experimental */
    sharedstoragewritable?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;

    /** @deprecated */
    align?: FunctionMaybe<string | RemoveAttribute>;
    /**
     * @deprecated
     * @non-standard
     */
    allowpaymentrequest?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    /** @deprecated */
    allowtransparency?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    /** @deprecated */
    frameborder?: FunctionMaybe<number | string | RemoveAttribute>;
    /** @deprecated */
    longdesc?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    marginheight?: FunctionMaybe<number | string | RemoveAttribute>;
    /** @deprecated */
    marginwidth?: FunctionMaybe<number | string | RemoveAttribute>;
    /** @deprecated */
    scrolling?: FunctionMaybe<"yes" | "no" | "auto" | RemoveAttribute>;
    /** @deprecated */
    seamless?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
  }
  interface ImgHTMLAttributes<T> extends HTMLAttributes<T> {
    alt?: FunctionMaybe<string | RemoveAttribute>;
    browsingtopics?: FunctionMaybe<string | RemoveAttribute>;
    crossorigin?: FunctionMaybe<HTMLCrossorigin | RemoveAttribute>;
    decoding?: FunctionMaybe<"sync" | "async" | "auto" | RemoveAttribute>;
    fetchpriority?: FunctionMaybe<"high" | "low" | "auto" | RemoveAttribute>;
    height?: FunctionMaybe<number | string | RemoveAttribute>;
    ismap?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    loading?: FunctionMaybe<"eager" | "lazy" | RemoveAttribute>;
    referrerpolicy?: FunctionMaybe<HTMLReferrerPolicy | RemoveAttribute>;
    sizes?: FunctionMaybe<string | RemoveAttribute>;
    src?: FunctionMaybe<string | RemoveAttribute>;
    srcset?: FunctionMaybe<string | RemoveAttribute>;
    usemap?: FunctionMaybe<string | RemoveAttribute>;
    width?: FunctionMaybe<number | string | RemoveAttribute>;

    /** @experimental */
    attributionsrc?: FunctionMaybe<string | RemoveAttribute>;
    /** @experimental */
    sharedstoragewritable?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;

    /** @deprecated */
    align?: FunctionMaybe<"top" | "middle" | "bottom" | "left" | "right" | RemoveAttribute>;
    /** @deprecated */
    border?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    hspace?: FunctionMaybe<number | string | RemoveAttribute>;
    /** @deprecated */
    intrinsicsize?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    longdesc?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    lowsrc?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    name?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    vspace?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    accept?: FunctionMaybe<string | RemoveAttribute>;
    alpha?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    alt?: FunctionMaybe<string | RemoveAttribute>;
    autocomplete?: FunctionMaybe<HTMLAutocomplete | RemoveAttribute>;
    capture?: FunctionMaybe<"user" | "environment" | RemoveAttribute>;
    checked?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    "prop:checked"?: FunctionMaybe<BooleanProperty | RemoveProperty>;
    colorspace?: FunctionMaybe<string | RemoveAttribute>;
    dirname?: FunctionMaybe<string | RemoveAttribute>;
    disabled?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    form?: FunctionMaybe<string | RemoveAttribute>;
    formaction?: FunctionMaybe<string | SerializableAttributeValue | RemoveAttribute>;
    formenctype?: FunctionMaybe<HTMLFormEncType | RemoveAttribute>;
    formmethod?: FunctionMaybe<HTMLFormMethod | RemoveAttribute>;
    formnovalidate?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    formtarget?: FunctionMaybe<string | RemoveAttribute>;
    height?: FunctionMaybe<number | string | RemoveAttribute>;
    list?: FunctionMaybe<string | RemoveAttribute>;
    max?: FunctionMaybe<number | string | RemoveAttribute>;
    maxlength?: FunctionMaybe<number | string | RemoveAttribute>;
    min?: FunctionMaybe<number | string | RemoveAttribute>;
    minlength?: FunctionMaybe<number | string | RemoveAttribute>;
    multiple?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    name?: FunctionMaybe<string | RemoveAttribute>;
    pattern?: FunctionMaybe<string | RemoveAttribute>;
    placeholder?: FunctionMaybe<string | RemoveAttribute>;
    popovertarget?: FunctionMaybe<string | RemoveAttribute>;
    popovertargetaction?: FunctionMaybe<"hide" | "show" | "toggle" | RemoveAttribute>;
    readonly?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    required?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    // https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/search#results
    results?: FunctionMaybe<number | RemoveAttribute>;
    size?: FunctionMaybe<number | string | RemoveAttribute>;
    src?: FunctionMaybe<string | RemoveAttribute>;
    step?: FunctionMaybe<number | string | RemoveAttribute>;
    type?: FunctionMaybe<
      | "button"
      | "checkbox"
      | "color"
      | "date"
      | "datetime-local"
      | "email"
      | "file"
      | "hidden"
      | "image"
      | "month"
      | "number"
      | "password"
      | "radio"
      | "range"
      | "reset"
      | "search"
      | "submit"
      | "tel"
      | "text"
      | "time"
      | "url"
      | "week"
      | (string & {})
      | RemoveAttribute
    >;
    value?: FunctionMaybe<string | string[] | number | RemoveAttribute>;
    "prop:value"?: FunctionMaybe<string | string[] | number | RemoveProperty>;
    width?: FunctionMaybe<number | string | RemoveAttribute>;

    /** @non-standard */
    incremental?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;

    /** @deprecated */
    align?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    usemap?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface ModHTMLAttributes<T> extends HTMLAttributes<T> {
    cite?: FunctionMaybe<string | RemoveAttribute>;
    datetime?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface KeygenHTMLAttributes<T> extends HTMLAttributes<T> {
    /** @deprecated */
    challenge?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    disabled?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    /** @deprecated */
    form?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    keyparams?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    keytype?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    name?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface LabelHTMLAttributes<T> extends HTMLAttributes<T> {
    for?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface LiHTMLAttributes<T> extends HTMLAttributes<T> {
    value?: FunctionMaybe<number | string | RemoveAttribute>;

    /** @deprecated */
    type?: FunctionMaybe<"1" | "a" | "A" | "i" | "I" | RemoveAttribute>;
  }
  interface LinkHTMLAttributes<T> extends HTMLAttributes<T> {
    as?: FunctionMaybe<HTMLLinkAs | RemoveAttribute>;
    blocking?: FunctionMaybe<"render" | RemoveAttribute>;
    color?: FunctionMaybe<string | RemoveAttribute>;
    crossorigin?: FunctionMaybe<HTMLCrossorigin | RemoveAttribute>;
    disabled?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    fetchpriority?: FunctionMaybe<"high" | "low" | "auto" | RemoveAttribute>;
    href?: FunctionMaybe<string | RemoveAttribute>;
    hreflang?: FunctionMaybe<string | RemoveAttribute>;
    imagesizes?: FunctionMaybe<string | RemoveAttribute>;
    imagesrcset?: FunctionMaybe<string | RemoveAttribute>;
    integrity?: FunctionMaybe<string | RemoveAttribute>;
    media?: FunctionMaybe<string | RemoveAttribute>;
    referrerpolicy?: FunctionMaybe<HTMLReferrerPolicy | RemoveAttribute>;
    rel?: FunctionMaybe<string | RemoveAttribute>;
    sizes?: FunctionMaybe<string | RemoveAttribute>;
    type?: FunctionMaybe<string | RemoveAttribute>;

    /** @deprecated */
    charset?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    rev?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    target?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface MapHTMLAttributes<T> extends HTMLAttributes<T> {
    name?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface MediaHTMLAttributes<T> extends HTMLAttributes<T> {
    autoplay?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    controls?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    controlslist?: FunctionMaybe<
      | "nodownload"
      | "nofullscreen"
      | "noplaybackrate"
      | "noremoteplayback"
      | (string & {})
      | RemoveAttribute
    >;
    crossorigin?: FunctionMaybe<HTMLCrossorigin | RemoveAttribute>;
    disableremoteplayback?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    loop?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    muted?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    "prop:muted"?: FunctionMaybe<BooleanProperty | RemoveProperty>;
    preload?: FunctionMaybe<
      "none" | "metadata" | "auto" | EnumeratedAcceptsEmpty | RemoveAttribute
    >;
    src?: FunctionMaybe<string | RemoveAttribute>;

    onEncrypted?: EventHandlerUnion<T, MediaEncryptedEvent> | undefined;
    "on:encrypted"?: EventHandlerWithOptionsUnion<T, MediaEncryptedEvent> | undefined;

    onWaitingForKey?: EventHandlerUnion<T, Event> | undefined;
    "on:waitingforkey"?: EventHandlerWithOptionsUnion<T, Event> | undefined;

    /** @deprecated */
    mediagroup?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface MenuHTMLAttributes<T> extends HTMLAttributes<T> {
    /** @deprecated */
    compact?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    /** @deprecated */
    label?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    type?: FunctionMaybe<"context" | "toolbar" | RemoveAttribute>;
  }
  interface MetaHTMLAttributes<T> extends HTMLAttributes<T> {
    "http-equiv"?: FunctionMaybe<
      | "content-security-policy"
      | "content-type"
      | "default-style"
      | "x-ua-compatible"
      | "refresh"
      | RemoveAttribute
    >;
    charset?: FunctionMaybe<string | RemoveAttribute>;
    content?: FunctionMaybe<string | RemoveAttribute>;
    media?: FunctionMaybe<string | RemoveAttribute>;
    name?: FunctionMaybe<string | RemoveAttribute>;

    /** @deprecated */
    scheme?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface MeterHTMLAttributes<T> extends HTMLAttributes<T> {
    form?: FunctionMaybe<string | RemoveAttribute>;
    high?: FunctionMaybe<number | string | RemoveAttribute>;
    low?: FunctionMaybe<number | string | RemoveAttribute>;
    max?: FunctionMaybe<number | string | RemoveAttribute>;
    min?: FunctionMaybe<number | string | RemoveAttribute>;
    optimum?: FunctionMaybe<number | string | RemoveAttribute>;
    value?: FunctionMaybe<string | string[] | number | RemoveAttribute>;
  }
  interface QuoteHTMLAttributes<T> extends HTMLAttributes<T> {
    cite?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface ObjectHTMLAttributes<T> extends HTMLAttributes<T> {
    data?: FunctionMaybe<string | RemoveAttribute>;
    form?: FunctionMaybe<string | RemoveAttribute>;
    height?: FunctionMaybe<number | string | RemoveAttribute>;
    name?: FunctionMaybe<string | RemoveAttribute>;
    type?: FunctionMaybe<string | RemoveAttribute>;
    width?: FunctionMaybe<number | string | RemoveAttribute>;
    wmode?: FunctionMaybe<string | RemoveAttribute>;

    /** @deprecated */
    align?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    archive?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    border?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    classid?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    code?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    codebase?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    codetype?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    declare?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    /** @deprecated */
    hspace?: FunctionMaybe<number | string | RemoveAttribute>;
    /** @deprecated */
    standby?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    usemap?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    vspace?: FunctionMaybe<number | string | RemoveAttribute>;
    /** @deprecated */
    typemustmatch?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
  }
  interface OlHTMLAttributes<T> extends HTMLAttributes<T> {
    reversed?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    start?: FunctionMaybe<number | string | RemoveAttribute>;
    type?: FunctionMaybe<"1" | "a" | "A" | "i" | "I" | RemoveAttribute>;

    /**
     * @deprecated
     * @non-standard
     */
    compact?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
  }
  interface OptgroupHTMLAttributes<T> extends HTMLAttributes<T> {
    disabled?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    label?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface OptionHTMLAttributes<T> extends HTMLAttributes<T> {
    disabled?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    label?: FunctionMaybe<string | RemoveAttribute>;
    selected?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    "prop:selected"?: FunctionMaybe<BooleanProperty | RemoveProperty>;
    value?: FunctionMaybe<string | string[] | number | RemoveAttribute>;
    "prop:value"?: FunctionMaybe<string | string[] | number | RemoveProperty>;
  }
  interface OutputHTMLAttributes<T> extends HTMLAttributes<T> {
    for?: FunctionMaybe<string | RemoveAttribute>;
    form?: FunctionMaybe<string | RemoveAttribute>;
    name?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface ParamHTMLAttributes<T> extends HTMLAttributes<T> {
    /** @deprecated */
    name?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    type?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    value?: FunctionMaybe<string | number | RemoveAttribute>;
    /** @deprecated */
    valuetype?: FunctionMaybe<"data" | "ref" | "object" | RemoveAttribute>;
  }
  interface ProgressHTMLAttributes<T> extends HTMLAttributes<T> {
    max?: FunctionMaybe<number | string | RemoveAttribute>;
    value?: FunctionMaybe<string | string[] | number | RemoveAttribute>;
  }
  interface ScriptHTMLAttributes<T> extends HTMLAttributes<T> {
    async?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    blocking?: FunctionMaybe<"render" | RemoveAttribute>;
    crossorigin?: FunctionMaybe<HTMLCrossorigin | RemoveAttribute>;
    defer?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    fetchpriority?: FunctionMaybe<"high" | "low" | "auto" | RemoveAttribute>;
    for?: FunctionMaybe<string | RemoveAttribute>;
    integrity?: FunctionMaybe<string | RemoveAttribute>;
    nomodule?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    referrerpolicy?: FunctionMaybe<HTMLReferrerPolicy | RemoveAttribute>;
    src?: FunctionMaybe<string | RemoveAttribute>;
    type?: FunctionMaybe<
      "importmap" | "module" | "speculationrules" | (string & {}) | RemoveAttribute
    >;

    /** @experimental */
    attributionsrc?: FunctionMaybe<string | RemoveAttribute>;

    /** @deprecated */
    charset?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    event?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    language?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface SelectHTMLAttributes<T> extends HTMLAttributes<T> {
    autocomplete?: FunctionMaybe<HTMLAutocomplete | RemoveAttribute>;
    disabled?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    form?: FunctionMaybe<string | RemoveAttribute>;
    multiple?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    name?: FunctionMaybe<string | RemoveAttribute>;
    required?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    size?: FunctionMaybe<number | string | RemoveAttribute>;
    value?: FunctionMaybe<string | string[] | number | RemoveAttribute>;
    "prop:value"?: FunctionMaybe<string | string[] | number | RemoveProperty>;
  }
  interface HTMLSlotElementAttributes<T> extends HTMLAttributes<T> {
    name?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface SourceHTMLAttributes<T> extends HTMLAttributes<T> {
    height?: FunctionMaybe<number | string | RemoveAttribute>;
    media?: FunctionMaybe<string | RemoveAttribute>;
    sizes?: FunctionMaybe<string | RemoveAttribute>;
    src?: FunctionMaybe<string | RemoveAttribute>;
    srcset?: FunctionMaybe<string | RemoveAttribute>;
    type?: FunctionMaybe<string | RemoveAttribute>;
    width?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface StyleHTMLAttributes<T> extends HTMLAttributes<T> {
    blocking?: FunctionMaybe<"render" | RemoveAttribute>;
    media?: FunctionMaybe<string | RemoveAttribute>;

    /** @deprecated */
    scoped?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    /** @deprecated */
    type?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface TdHTMLAttributes<T> extends HTMLAttributes<T> {
    colspan?: FunctionMaybe<number | string | RemoveAttribute>;
    headers?: FunctionMaybe<string | RemoveAttribute>;
    rowspan?: FunctionMaybe<number | string | RemoveAttribute>;

    /** @deprecated */
    abbr?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    align?: FunctionMaybe<"left" | "center" | "right" | "justify" | "char" | RemoveAttribute>;
    /** @deprecated */
    axis?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    bgcolor?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    char?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    charoff?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    height?: FunctionMaybe<number | string | RemoveAttribute>;
    /** @deprecated */
    nowrap?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    /** @deprecated */
    scope?: FunctionMaybe<"col" | "row" | "rowgroup" | "colgroup" | RemoveAttribute>;
    /** @deprecated */
    valign?: FunctionMaybe<"baseline" | "bottom" | "middle" | "top" | RemoveAttribute>;
    /** @deprecated */
    width?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface TemplateHTMLAttributes<T> extends HTMLAttributes<T> {
    shadowrootclonable?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    shadowrootdelegatesfocus?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    shadowrootmode?: FunctionMaybe<"open" | "closed" | RemoveAttribute>;
    shadowrootcustomelementregistry?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;

    /** @experimental */
    shadowrootserializable?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
  }
  interface TextareaHTMLAttributes<T> extends HTMLAttributes<T> {
    autocomplete?: FunctionMaybe<HTMLAutocomplete | RemoveAttribute>;
    cols?: FunctionMaybe<number | string | RemoveAttribute>;
    dirname?: FunctionMaybe<string | RemoveAttribute>;
    disabled?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;

    form?: FunctionMaybe<string | RemoveAttribute>;
    maxlength?: FunctionMaybe<number | string | RemoveAttribute>;
    minlength?: FunctionMaybe<number | string | RemoveAttribute>;
    name?: FunctionMaybe<string | RemoveAttribute>;
    placeholder?: FunctionMaybe<string | RemoveAttribute>;
    readonly?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    required?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    rows?: FunctionMaybe<number | string | RemoveAttribute>;
    value?: FunctionMaybe<string | string[] | number | RemoveAttribute>;
    "prop:value"?: FunctionMaybe<string | string[] | number | RemoveProperty>;
    wrap?: FunctionMaybe<"hard" | "soft" | "off" | RemoveAttribute>;
  }
  interface ThHTMLAttributes<T> extends HTMLAttributes<T> {
    abbr?: FunctionMaybe<string | RemoveAttribute>;
    colspan?: FunctionMaybe<number | string | RemoveAttribute>;
    headers?: FunctionMaybe<string | RemoveAttribute>;
    rowspan?: FunctionMaybe<number | string | RemoveAttribute>;
    scope?: FunctionMaybe<"col" | "row" | "rowgroup" | "colgroup" | RemoveAttribute>;

    /** @deprecated */
    align?: FunctionMaybe<"left" | "center" | "right" | "justify" | "char" | RemoveAttribute>;
    /** @deprecated */
    axis?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    bgcolor?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    char?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    charoff?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    height?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    nowrap?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    /** @deprecated */
    valign?: FunctionMaybe<"baseline" | "bottom" | "middle" | "top" | RemoveAttribute>;
    /** @deprecated */
    width?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface TimeHTMLAttributes<T> extends HTMLAttributes<T> {
    datetime?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface TrackHTMLAttributes<T> extends HTMLAttributes<T> {
    default?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    kind?: FunctionMaybe<
      | "alternative"
      | "descriptions"
      | "main"
      | "main-desc"
      | "translation"
      | "commentary"
      | "subtitles"
      | "captions"
      | "chapters"
      | "metadata"
      | RemoveAttribute
    >;
    label?: FunctionMaybe<string | RemoveAttribute>;
    src?: FunctionMaybe<string | RemoveAttribute>;
    srclang?: FunctionMaybe<string | RemoveAttribute>;

    /** @deprecated */
    mediagroup?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface VideoHTMLAttributes<T> extends MediaHTMLAttributes<T> {
    disablepictureinpicture?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    height?: FunctionMaybe<number | string | RemoveAttribute>;
    playsinline?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    poster?: FunctionMaybe<string | RemoveAttribute>;
    width?: FunctionMaybe<number | string | RemoveAttribute>;

    onEnterPictureInPicture?: EventHandlerUnion<T, PictureInPictureEvent> | undefined;
    "on:enterpictureinpicture"?: EventHandlerWithOptionsUnion<T, PictureInPictureEvent> | undefined;

    onLeavePictureInPicture?: EventHandlerUnion<T, PictureInPictureEvent> | undefined;
    "on:leavepictureinpicture"?: EventHandlerWithOptionsUnion<T, PictureInPictureEvent> | undefined;
  }

  interface WebViewHTMLAttributes<T> extends HTMLAttributes<T> {
    allowpopups?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    disableblinkfeatures?: FunctionMaybe<string | RemoveAttribute>;
    disablewebsecurity?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    enableblinkfeatures?: FunctionMaybe<string | RemoveAttribute>;
    httpreferrer?: FunctionMaybe<string | RemoveAttribute>;
    nodeintegration?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    nodeintegrationinsubframes?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    partition?: FunctionMaybe<string | RemoveAttribute>;
    plugins?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    preload?: FunctionMaybe<string | RemoveAttribute>;
    src?: FunctionMaybe<string | RemoveAttribute>;
    useragent?: FunctionMaybe<string | RemoveAttribute>;
    webpreferences?: FunctionMaybe<string | RemoveAttribute>;

    // does this exists?
    allowfullscreen?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    autosize?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;

    /** @deprecated */
    blinkfeatures?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    disableguestresize?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    /** @deprecated */
    guestinstance?: FunctionMaybe<string | RemoveAttribute>;
  }

  // SVG

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

  interface StylableSVGAttributes {
    class?: FunctionMaybe<string | ClassList | RemoveAttribute>;
    style?: FunctionMaybe<CSSProperties | string | RemoveAttribute>;
  }
  interface TransformableSVGAttributes {
    transform?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface ConditionalProcessingSVGAttributes {
    requiredExtensions?: FunctionMaybe<string | RemoveAttribute>;
    requiredFeatures?: FunctionMaybe<string | RemoveAttribute>;
    systemLanguage?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface ExternalResourceSVGAttributes {
    externalResourcesRequired?: FunctionMaybe<EnumeratedPseudoBoolean | RemoveAttribute>;
  }
  interface AnimationTimingSVGAttributes {
    begin?: FunctionMaybe<string | RemoveAttribute>;
    dur?: FunctionMaybe<string | RemoveAttribute>;
    end?: FunctionMaybe<string | RemoveAttribute>;
    fill?: FunctionMaybe<"freeze" | "remove" | RemoveAttribute>;
    max?: FunctionMaybe<string | RemoveAttribute>;
    min?: FunctionMaybe<string | RemoveAttribute>;
    repeatCount?: FunctionMaybe<number | "indefinite" | RemoveAttribute>;
    repeatDur?: FunctionMaybe<string | RemoveAttribute>;
    restart?: FunctionMaybe<"always" | "whenNotActive" | "never" | RemoveAttribute>;
  }
  interface AnimationValueSVGAttributes {
    by?: FunctionMaybe<number | string | RemoveAttribute>;
    calcMode?: FunctionMaybe<"discrete" | "linear" | "paced" | "spline" | RemoveAttribute>;
    from?: FunctionMaybe<number | string | RemoveAttribute>;
    keySplines?: FunctionMaybe<string | RemoveAttribute>;
    keyTimes?: FunctionMaybe<string | RemoveAttribute>;
    to?: FunctionMaybe<number | string | RemoveAttribute>;
    values?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface AnimationAdditionSVGAttributes {
    accumulate?: FunctionMaybe<"none" | "sum" | RemoveAttribute>;
    additive?: FunctionMaybe<"replace" | "sum" | RemoveAttribute>;
    attributeName?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface AnimationAttributeTargetSVGAttributes {
    attributeName?: FunctionMaybe<string | RemoveAttribute>;
    attributeType?: FunctionMaybe<"CSS" | "XML" | "auto" | RemoveAttribute>;
  }
  interface PresentationSVGAttributes {
    "alignment-baseline"?: FunctionMaybe<
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
      | "inherit"
      | RemoveAttribute
    >;
    "baseline-shift"?: FunctionMaybe<number | string | RemoveAttribute>;
    "clip-path"?: FunctionMaybe<string | RemoveAttribute>;
    "clip-rule"?: FunctionMaybe<"nonzero" | "evenodd" | "inherit" | RemoveAttribute>;
    "color-interpolation"?: FunctionMaybe<
      "auto" | "sRGB" | "linearRGB" | "inherit" | RemoveAttribute
    >;
    "color-interpolation-filters"?: FunctionMaybe<
      "auto" | "sRGB" | "linearRGB" | "inherit" | RemoveAttribute
    >;
    "color-profile"?: FunctionMaybe<string | RemoveAttribute>;
    "color-rendering"?: FunctionMaybe<
      "auto" | "optimizeSpeed" | "optimizeQuality" | "inherit" | RemoveAttribute
    >;
    "dominant-baseline"?: FunctionMaybe<
      | "auto"
      | "text-bottom"
      | "alphabetic"
      | "ideographic"
      | "middle"
      | "central"
      | "mathematical"
      | "hanging"
      | "text-top"
      | "inherit"
      | RemoveAttribute
    >;
    "enable-background"?: FunctionMaybe<string | RemoveAttribute>;
    "fill-opacity"?: FunctionMaybe<number | string | "inherit" | RemoveAttribute>;
    "fill-rule"?: FunctionMaybe<"nonzero" | "evenodd" | "inherit" | RemoveAttribute>;
    "flood-color"?: FunctionMaybe<string | RemoveAttribute>;
    "flood-opacity"?: FunctionMaybe<number | string | "inherit" | RemoveAttribute>;
    "font-family"?: FunctionMaybe<string | RemoveAttribute>;
    "font-size"?: FunctionMaybe<string | RemoveAttribute>;
    "font-size-adjust"?: FunctionMaybe<number | string | RemoveAttribute>;
    "font-stretch"?: FunctionMaybe<string | RemoveAttribute>;
    "font-style"?: FunctionMaybe<"normal" | "italic" | "oblique" | "inherit" | RemoveAttribute>;
    "font-variant"?: FunctionMaybe<string | RemoveAttribute>;
    "font-weight"?: FunctionMaybe<number | string | RemoveAttribute>;
    "glyph-orientation-horizontal"?: FunctionMaybe<string | RemoveAttribute>;
    "glyph-orientation-vertical"?: FunctionMaybe<string | RemoveAttribute>;
    "image-rendering"?: FunctionMaybe<
      "auto" | "optimizeQuality" | "optimizeSpeed" | "inherit" | RemoveAttribute
    >;
    "letter-spacing"?: FunctionMaybe<number | string | RemoveAttribute>;
    "lighting-color"?: FunctionMaybe<string | RemoveAttribute>;
    "marker-end"?: FunctionMaybe<string | RemoveAttribute>;
    "marker-mid"?: FunctionMaybe<string | RemoveAttribute>;
    "marker-start"?: FunctionMaybe<string | RemoveAttribute>;
    "pointer-events"?: FunctionMaybe<
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
      | "inherit"
      | RemoveAttribute
    >;
    "shape-rendering"?: FunctionMaybe<
      "auto" | "optimizeSpeed" | "crispEdges" | "geometricPrecision" | "inherit" | RemoveAttribute
    >;
    "stop-color"?: FunctionMaybe<string | RemoveAttribute>;
    "stop-opacity"?: FunctionMaybe<number | string | "inherit" | RemoveAttribute>;
    "stroke-dasharray"?: FunctionMaybe<string | RemoveAttribute>;
    "stroke-dashoffset"?: FunctionMaybe<number | string | RemoveAttribute>;
    "stroke-linecap"?: FunctionMaybe<"butt" | "round" | "square" | "inherit" | RemoveAttribute>;
    "stroke-linejoin"?: FunctionMaybe<
      "arcs" | "bevel" | "miter" | "miter-clip" | "round" | "inherit" | RemoveAttribute
    >;
    "stroke-miterlimit"?: FunctionMaybe<number | string | "inherit" | RemoveAttribute>;
    "stroke-opacity"?: FunctionMaybe<number | string | "inherit" | RemoveAttribute>;
    "stroke-width"?: FunctionMaybe<number | string | RemoveAttribute>;
    "text-anchor"?: FunctionMaybe<"start" | "middle" | "end" | "inherit" | RemoveAttribute>;
    "text-decoration"?: FunctionMaybe<
      "none" | "underline" | "overline" | "line-through" | "blink" | "inherit" | RemoveAttribute
    >;
    "text-rendering"?: FunctionMaybe<
      | "auto"
      | "optimizeSpeed"
      | "optimizeLegibility"
      | "geometricPrecision"
      | "inherit"
      | RemoveAttribute
    >;
    "unicode-bidi"?: FunctionMaybe<string | RemoveAttribute>;
    "word-spacing"?: FunctionMaybe<number | string | RemoveAttribute>;
    "writing-mode"?: FunctionMaybe<
      "lr-tb" | "rl-tb" | "tb-rl" | "lr" | "rl" | "tb" | "inherit" | RemoveAttribute
    >;
    clip?: FunctionMaybe<string | RemoveAttribute>;
    color?: FunctionMaybe<string | RemoveAttribute>;
    cursor?: FunctionMaybe<string | RemoveAttribute>;
    direction?: FunctionMaybe<"ltr" | "rtl" | "inherit" | RemoveAttribute>;
    display?: FunctionMaybe<string | RemoveAttribute>;
    fill?: FunctionMaybe<string | RemoveAttribute>;
    filter?: FunctionMaybe<string | RemoveAttribute>;
    kerning?: FunctionMaybe<string | RemoveAttribute>;
    mask?: FunctionMaybe<string | RemoveAttribute>;
    opacity?: FunctionMaybe<number | string | "inherit" | RemoveAttribute>;
    overflow?: FunctionMaybe<
      "visible" | "hidden" | "scroll" | "auto" | "inherit" | RemoveAttribute
    >;
    pathLength?: FunctionMaybe<string | number | RemoveAttribute>;
    stroke?: FunctionMaybe<string | RemoveAttribute>;
    visibility?: FunctionMaybe<"visible" | "hidden" | "collapse" | "inherit" | RemoveAttribute>;
  }
  interface AnimationElementSVGAttributes<T>
    extends SVGAttributes<T>, ExternalResourceSVGAttributes, ConditionalProcessingSVGAttributes {
    // TODO TimeEvent is currently undefined on TS
    onBegin?: EventHandlerUnion<T, Event> | undefined;
    "on:begin"?: EventHandlerWithOptionsUnion<T, Event> | undefined;

    // TODO TimeEvent is currently undefined on TS
    onEnd?: EventHandlerUnion<T, Event> | undefined;
    "on:end"?: EventHandlerWithOptionsUnion<T, Event> | undefined;

    // TODO TimeEvent is currently undefined on TS
    onRepeat?: EventHandlerUnion<T, Event> | undefined;
    "on:repeat"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
  }
  interface ContainerElementSVGAttributes<T>
    extends
      SVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      Pick<
        PresentationSVGAttributes,
        | "clip-path"
        | "mask"
        | "cursor"
        | "opacity"
        | "filter"
        | "enable-background"
        | "color-interpolation"
        | "color-rendering"
      > {}
  interface FilterPrimitiveElementSVGAttributes<T>
    extends SVGAttributes<T>, Pick<PresentationSVGAttributes, "color-interpolation-filters"> {
    height?: FunctionMaybe<number | string | RemoveAttribute>;
    result?: FunctionMaybe<string | RemoveAttribute>;
    width?: FunctionMaybe<number | string | RemoveAttribute>;
    x?: FunctionMaybe<number | string | RemoveAttribute>;
    y?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface SingleInputFilterSVGAttributes {
    in?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface DoubleInputFilterSVGAttributes {
    in?: FunctionMaybe<string | RemoveAttribute>;
    in2?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface FitToViewBoxSVGAttributes {
    preserveAspectRatio?: FunctionMaybe<SVGPreserveAspectRatio | RemoveAttribute>;
    viewBox?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface GradientElementSVGAttributes<T>
    extends SVGAttributes<T>, ExternalResourceSVGAttributes, StylableSVGAttributes {
    gradientTransform?: FunctionMaybe<string | RemoveAttribute>;
    gradientUnits?: FunctionMaybe<SVGUnits | RemoveAttribute>;
    href?: FunctionMaybe<string | RemoveAttribute>;
    spreadMethod?: FunctionMaybe<"pad" | "reflect" | "repeat" | RemoveAttribute>;
  }
  interface GraphicsElementSVGAttributes<T>
    extends
      SVGAttributes<T>,
      Pick<
        PresentationSVGAttributes,
        | "clip-rule"
        | "mask"
        | "pointer-events"
        | "cursor"
        | "opacity"
        | "filter"
        | "display"
        | "visibility"
        | "color-interpolation"
        | "color-rendering"
      > {}
  interface LightSourceElementSVGAttributes<T> extends SVGAttributes<T> {}
  interface NewViewportSVGAttributes<T>
    extends SVGAttributes<T>, Pick<PresentationSVGAttributes, "overflow" | "clip"> {
    viewBox?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface ShapeElementSVGAttributes<T>
    extends
      SVGAttributes<T>,
      Pick<
        PresentationSVGAttributes,
        | "color"
        | "fill"
        | "fill-rule"
        | "fill-opacity"
        | "stroke"
        | "stroke-width"
        | "stroke-linecap"
        | "stroke-linejoin"
        | "stroke-miterlimit"
        | "stroke-dasharray"
        | "stroke-dashoffset"
        | "stroke-opacity"
        | "shape-rendering"
        | "pathLength"
      > {}
  interface TextContentElementSVGAttributes<T>
    extends
      SVGAttributes<T>,
      Pick<
        PresentationSVGAttributes,
        | "font-family"
        | "font-style"
        | "font-variant"
        | "font-weight"
        | "font-stretch"
        | "font-size"
        | "font-size-adjust"
        | "kerning"
        | "letter-spacing"
        | "word-spacing"
        | "text-decoration"
        | "glyph-orientation-horizontal"
        | "glyph-orientation-vertical"
        | "direction"
        | "unicode-bidi"
        | "text-anchor"
        | "dominant-baseline"
        | "color"
        | "fill"
        | "fill-rule"
        | "fill-opacity"
        | "stroke"
        | "stroke-width"
        | "stroke-linecap"
        | "stroke-linejoin"
        | "stroke-miterlimit"
        | "stroke-dasharray"
        | "stroke-dashoffset"
        | "stroke-opacity"
      > {}
  interface ZoomAndPanSVGAttributes {
    /**
     * @deprecated
     * @non-standard
     */
    zoomAndPan?: FunctionMaybe<"disable" | "magnify" | RemoveAttribute>;
  }
  interface AnimateSVGAttributes<T>
    extends
      AnimationElementSVGAttributes<T>,
      AnimationAttributeTargetSVGAttributes,
      AnimationTimingSVGAttributes,
      AnimationValueSVGAttributes,
      AnimationAdditionSVGAttributes,
      Pick<PresentationSVGAttributes, "color-interpolation" | "color-rendering"> {}
  interface AnimateMotionSVGAttributes<T>
    extends
      AnimationElementSVGAttributes<T>,
      AnimationTimingSVGAttributes,
      AnimationValueSVGAttributes,
      AnimationAdditionSVGAttributes {
    keyPoints?: FunctionMaybe<string | RemoveAttribute>;
    origin?: FunctionMaybe<"default" | RemoveAttribute>;
    path?: FunctionMaybe<string | RemoveAttribute>;
    rotate?: FunctionMaybe<number | string | "auto" | "auto-reverse" | RemoveAttribute>;
  }
  interface AnimateTransformSVGAttributes<T>
    extends
      AnimationElementSVGAttributes<T>,
      AnimationAttributeTargetSVGAttributes,
      AnimationTimingSVGAttributes,
      AnimationValueSVGAttributes,
      AnimationAdditionSVGAttributes {
    type?: FunctionMaybe<"translate" | "scale" | "rotate" | "skewX" | "skewY" | RemoveAttribute>;
  }
  interface CircleSVGAttributes<T>
    extends
      GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path"> {
    cx?: FunctionMaybe<number | string | RemoveAttribute>;
    cy?: FunctionMaybe<number | string | RemoveAttribute>;
    r?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface ClipPathSVGAttributes<T>
    extends
      SVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path"> {
    clipPathUnits?: FunctionMaybe<SVGUnits | RemoveAttribute>;
  }
  interface DefsSVGAttributes<T>
    extends
      ContainerElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes {}
  interface DescSVGAttributes<T> extends SVGAttributes<T>, StylableSVGAttributes {}
  interface EllipseSVGAttributes<T>
    extends
      GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path"> {
    cx?: FunctionMaybe<number | string | RemoveAttribute>;
    cy?: FunctionMaybe<number | string | RemoveAttribute>;
    rx?: FunctionMaybe<number | string | RemoveAttribute>;
    ry?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface FeBlendSVGAttributes<T>
    extends
      FilterPrimitiveElementSVGAttributes<T>,
      DoubleInputFilterSVGAttributes,
      StylableSVGAttributes {
    mode?: FunctionMaybe<"normal" | "multiply" | "screen" | "darken" | "lighten" | RemoveAttribute>;
  }
  interface FeColorMatrixSVGAttributes<T>
    extends
      FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {
    type?: FunctionMaybe<
      "matrix" | "saturate" | "hueRotate" | "luminanceToAlpha" | RemoveAttribute
    >;
    values?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface FeComponentTransferSVGAttributes<T>
    extends
      FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {}
  interface FeCompositeSVGAttributes<T>
    extends
      FilterPrimitiveElementSVGAttributes<T>,
      DoubleInputFilterSVGAttributes,
      StylableSVGAttributes {
    k1?: FunctionMaybe<number | string | RemoveAttribute>;
    k2?: FunctionMaybe<number | string | RemoveAttribute>;
    k3?: FunctionMaybe<number | string | RemoveAttribute>;
    k4?: FunctionMaybe<number | string | RemoveAttribute>;
    operator?: FunctionMaybe<
      "over" | "in" | "out" | "atop" | "xor" | "arithmetic" | RemoveAttribute
    >;
  }
  interface FeConvolveMatrixSVGAttributes<T>
    extends
      FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {
    bias?: FunctionMaybe<number | string | RemoveAttribute>;
    divisor?: FunctionMaybe<number | string | RemoveAttribute>;
    edgeMode?: FunctionMaybe<"duplicate" | "wrap" | "none" | RemoveAttribute>;
    kernelMatrix?: FunctionMaybe<string | RemoveAttribute>;
    kernelUnitLength?: FunctionMaybe<number | string | RemoveAttribute>;
    order?: FunctionMaybe<number | string | RemoveAttribute>;
    preserveAlpha?: FunctionMaybe<EnumeratedPseudoBoolean | RemoveAttribute>;
    targetX?: FunctionMaybe<number | string | RemoveAttribute>;
    targetY?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface FeDiffuseLightingSVGAttributes<T>
    extends
      FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes,
      Pick<PresentationSVGAttributes, "color" | "lighting-color"> {
    diffuseConstant?: FunctionMaybe<number | string | RemoveAttribute>;
    kernelUnitLength?: FunctionMaybe<number | string | RemoveAttribute>;
    surfaceScale?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface FeDisplacementMapSVGAttributes<T>
    extends
      FilterPrimitiveElementSVGAttributes<T>,
      DoubleInputFilterSVGAttributes,
      StylableSVGAttributes {
    scale?: FunctionMaybe<number | string | RemoveAttribute>;
    xChannelSelector?: FunctionMaybe<"R" | "G" | "B" | "A" | RemoveAttribute>;
    yChannelSelector?: FunctionMaybe<"R" | "G" | "B" | "A" | RemoveAttribute>;
  }
  interface FeDistantLightSVGAttributes<T> extends LightSourceElementSVGAttributes<T> {
    azimuth?: FunctionMaybe<number | string | RemoveAttribute>;
    elevation?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface FeDropShadowSVGAttributes<T>
    extends
      SVGAttributes<T>,
      FilterPrimitiveElementSVGAttributes<T>,
      StylableSVGAttributes,
      Pick<PresentationSVGAttributes, "color" | "flood-color" | "flood-opacity"> {
    dx?: FunctionMaybe<number | string | RemoveAttribute>;
    dy?: FunctionMaybe<number | string | RemoveAttribute>;
    stdDeviation?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface FeFloodSVGAttributes<T>
    extends
      FilterPrimitiveElementSVGAttributes<T>,
      StylableSVGAttributes,
      Pick<PresentationSVGAttributes, "color" | "flood-color" | "flood-opacity"> {}
  interface FeFuncSVGAttributes<T> extends SVGAttributes<T> {
    amplitude?: FunctionMaybe<number | string | RemoveAttribute>;
    exponent?: FunctionMaybe<number | string | RemoveAttribute>;
    intercept?: FunctionMaybe<number | string | RemoveAttribute>;
    offset?: FunctionMaybe<number | string | RemoveAttribute>;
    slope?: FunctionMaybe<number | string | RemoveAttribute>;
    tableValues?: FunctionMaybe<string | RemoveAttribute>;
    type?: FunctionMaybe<"identity" | "table" | "discrete" | "linear" | "gamma" | RemoveAttribute>;
  }
  interface FeGaussianBlurSVGAttributes<T>
    extends
      FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {
    stdDeviation?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface FeImageSVGAttributes<T>
    extends
      FilterPrimitiveElementSVGAttributes<T>,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes {
    href?: FunctionMaybe<string | RemoveAttribute>;
    preserveAspectRatio?: FunctionMaybe<SVGPreserveAspectRatio | RemoveAttribute>;
  }
  interface FeMergeSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>, StylableSVGAttributes {}
  interface FeMergeNodeSVGAttributes<T> extends SVGAttributes<T>, SingleInputFilterSVGAttributes {}
  interface FeMorphologySVGAttributes<T>
    extends
      FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {
    operator?: FunctionMaybe<"erode" | "dilate" | RemoveAttribute>;
    radius?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface FeOffsetSVGAttributes<T>
    extends
      FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {
    dx?: FunctionMaybe<number | string | RemoveAttribute>;
    dy?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface FePointLightSVGAttributes<T> extends LightSourceElementSVGAttributes<T> {
    x?: FunctionMaybe<number | string | RemoveAttribute>;
    y?: FunctionMaybe<number | string | RemoveAttribute>;
    z?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface FeSpecularLightingSVGAttributes<T>
    extends
      FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes,
      Pick<PresentationSVGAttributes, "color" | "lighting-color"> {
    kernelUnitLength?: FunctionMaybe<number | string | RemoveAttribute>;
    specularConstant?: FunctionMaybe<string | RemoveAttribute>;
    specularExponent?: FunctionMaybe<string | RemoveAttribute>;
    surfaceScale?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface FeSpotLightSVGAttributes<T> extends LightSourceElementSVGAttributes<T> {
    limitingConeAngle?: FunctionMaybe<number | string | RemoveAttribute>;
    pointsAtX?: FunctionMaybe<number | string | RemoveAttribute>;
    pointsAtY?: FunctionMaybe<number | string | RemoveAttribute>;
    pointsAtZ?: FunctionMaybe<number | string | RemoveAttribute>;
    specularExponent?: FunctionMaybe<number | string | RemoveAttribute>;
    x?: FunctionMaybe<number | string | RemoveAttribute>;
    y?: FunctionMaybe<number | string | RemoveAttribute>;
    z?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface FeTileSVGAttributes<T>
    extends
      FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {}
  interface FeTurbulanceSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>, StylableSVGAttributes {
    baseFrequency?: FunctionMaybe<number | string | RemoveAttribute>;
    numOctaves?: FunctionMaybe<number | string | RemoveAttribute>;
    seed?: FunctionMaybe<number | string | RemoveAttribute>;
    stitchTiles?: FunctionMaybe<"stitch" | "noStitch" | RemoveAttribute>;
    type?: FunctionMaybe<"fractalNoise" | "turbulence" | RemoveAttribute>;
  }
  interface FilterSVGAttributes<T>
    extends SVGAttributes<T>, ExternalResourceSVGAttributes, StylableSVGAttributes {
    filterRes?: FunctionMaybe<number | string | RemoveAttribute>;
    filterUnits?: FunctionMaybe<SVGUnits | RemoveAttribute>;
    height?: FunctionMaybe<number | string | RemoveAttribute>;
    primitiveUnits?: FunctionMaybe<SVGUnits | RemoveAttribute>;
    width?: FunctionMaybe<number | string | RemoveAttribute>;
    x?: FunctionMaybe<number | string | RemoveAttribute>;
    y?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface ForeignObjectSVGAttributes<T>
    extends
      NewViewportSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "display" | "visibility"> {
    height?: FunctionMaybe<number | string | RemoveAttribute>;
    width?: FunctionMaybe<number | string | RemoveAttribute>;
    x?: FunctionMaybe<number | string | RemoveAttribute>;
    y?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface GSVGAttributes<T>
    extends
      ContainerElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "display" | "visibility"> {}
  interface ImageSVGAttributes<T>
    extends
      NewViewportSVGAttributes<T>,
      GraphicsElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "color-profile" | "image-rendering"> {
    height?: FunctionMaybe<number | string | RemoveAttribute>;
    href?: FunctionMaybe<string | RemoveAttribute>;
    preserveAspectRatio?: FunctionMaybe<ImagePreserveAspectRatio | RemoveAttribute>;
    width?: FunctionMaybe<number | string | RemoveAttribute>;
    x?: FunctionMaybe<number | string | RemoveAttribute>;
    y?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface LineSVGAttributes<T>
    extends
      GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "marker-start" | "marker-mid" | "marker-end"> {
    x1?: FunctionMaybe<number | string | RemoveAttribute>;
    x2?: FunctionMaybe<number | string | RemoveAttribute>;
    y1?: FunctionMaybe<number | string | RemoveAttribute>;
    y2?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface LinearGradientSVGAttributes<T> extends GradientElementSVGAttributes<T> {
    x1?: FunctionMaybe<number | string | RemoveAttribute>;
    x2?: FunctionMaybe<number | string | RemoveAttribute>;
    y1?: FunctionMaybe<number | string | RemoveAttribute>;
    y2?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface MarkerSVGAttributes<T>
    extends
      ContainerElementSVGAttributes<T>,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      FitToViewBoxSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "overflow" | "clip"> {
    markerHeight?: FunctionMaybe<number | string | RemoveAttribute>;
    markerUnits?: FunctionMaybe<"strokeWidth" | "userSpaceOnUse" | RemoveAttribute>;
    markerWidth?: FunctionMaybe<number | string | RemoveAttribute>;
    orient?: FunctionMaybe<string | RemoveAttribute>;
    refX?: FunctionMaybe<number | string | RemoveAttribute>;
    refY?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface MaskSVGAttributes<T>
    extends
      Omit<ContainerElementSVGAttributes<T>, "opacity" | "filter">,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path"> {
    height?: FunctionMaybe<number | string | RemoveAttribute>;
    maskContentUnits?: FunctionMaybe<SVGUnits | RemoveAttribute>;
    maskUnits?: FunctionMaybe<SVGUnits | RemoveAttribute>;
    width?: FunctionMaybe<number | string | RemoveAttribute>;
    x?: FunctionMaybe<number | string | RemoveAttribute>;
    y?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface MetadataSVGAttributes<T> extends SVGAttributes<T> {}
  interface MPathSVGAttributes<T> extends SVGAttributes<T> {}
  interface PathSVGAttributes<T>
    extends
      GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "marker-start" | "marker-mid" | "marker-end"> {
    d?: FunctionMaybe<string | RemoveAttribute>;
    pathLength?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface PatternSVGAttributes<T>
    extends
      ContainerElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      FitToViewBoxSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "overflow" | "clip"> {
    height?: FunctionMaybe<number | string | RemoveAttribute>;
    href?: FunctionMaybe<string | RemoveAttribute>;
    patternContentUnits?: FunctionMaybe<SVGUnits | RemoveAttribute>;
    patternTransform?: FunctionMaybe<string | RemoveAttribute>;
    patternUnits?: FunctionMaybe<SVGUnits | RemoveAttribute>;
    width?: FunctionMaybe<number | string | RemoveAttribute>;
    x?: FunctionMaybe<number | string | RemoveAttribute>;
    y?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface PolygonSVGAttributes<T>
    extends
      GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "marker-start" | "marker-mid" | "marker-end"> {
    points?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface PolylineSVGAttributes<T>
    extends
      GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "marker-start" | "marker-mid" | "marker-end"> {
    points?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface RadialGradientSVGAttributes<T> extends GradientElementSVGAttributes<T> {
    cx?: FunctionMaybe<number | string | RemoveAttribute>;
    cy?: FunctionMaybe<number | string | RemoveAttribute>;
    fx?: FunctionMaybe<number | string | RemoveAttribute>;
    fy?: FunctionMaybe<number | string | RemoveAttribute>;
    r?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface RectSVGAttributes<T>
    extends
      GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path"> {
    height?: FunctionMaybe<number | string | RemoveAttribute>;
    rx?: FunctionMaybe<number | string | RemoveAttribute>;
    ry?: FunctionMaybe<number | string | RemoveAttribute>;
    width?: FunctionMaybe<number | string | RemoveAttribute>;
    x?: FunctionMaybe<number | string | RemoveAttribute>;
    y?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface SetSVGAttributes<T>
    extends AnimationElementSVGAttributes<T>, StylableSVGAttributes, AnimationTimingSVGAttributes {}
  interface StopSVGAttributes<T>
    extends
      SVGAttributes<T>,
      StylableSVGAttributes,
      Pick<PresentationSVGAttributes, "color" | "stop-color" | "stop-opacity"> {
    offset?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface SvgSVGAttributes<T>
    extends
      ContainerElementSVGAttributes<T>,
      NewViewportSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      FitToViewBoxSVGAttributes,
      ZoomAndPanSVGAttributes,
      PresentationSVGAttributes,
      EventHandlersWindow<T> {
    "xmlns:xlink"?: FunctionMaybe<string | RemoveAttribute>;
    contentScriptType?: FunctionMaybe<string | RemoveAttribute>;
    contentStyleType?: FunctionMaybe<string | RemoveAttribute>;
    height?: FunctionMaybe<number | string | RemoveAttribute>;
    width?: FunctionMaybe<number | string | RemoveAttribute>;
    x?: FunctionMaybe<number | string | RemoveAttribute>;
    y?: FunctionMaybe<number | string | RemoveAttribute>;

    /** @deprecated */
    baseProfile?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    version?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface SwitchSVGAttributes<T>
    extends
      ContainerElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "display" | "visibility"> {}
  interface SymbolSVGAttributes<T>
    extends
      ContainerElementSVGAttributes<T>,
      NewViewportSVGAttributes<T>,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      FitToViewBoxSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path"> {
    height?: FunctionMaybe<number | string | RemoveAttribute>;
    preserveAspectRatio?: FunctionMaybe<SVGPreserveAspectRatio | RemoveAttribute>;
    refX?: FunctionMaybe<number | string | RemoveAttribute>;
    refY?: FunctionMaybe<number | string | RemoveAttribute>;
    viewBox?: FunctionMaybe<string | RemoveAttribute>;
    width?: FunctionMaybe<number | string | RemoveAttribute>;
    x?: FunctionMaybe<number | string | RemoveAttribute>;
    y?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface TextSVGAttributes<T>
    extends
      TextContentElementSVGAttributes<T>,
      GraphicsElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "writing-mode" | "text-rendering"> {
    dx?: FunctionMaybe<number | string | RemoveAttribute>;
    dy?: FunctionMaybe<number | string | RemoveAttribute>;
    lengthAdjust?: FunctionMaybe<"spacing" | "spacingAndGlyphs" | RemoveAttribute>;
    rotate?: FunctionMaybe<number | string | RemoveAttribute>;
    textLength?: FunctionMaybe<number | string | RemoveAttribute>;
    x?: FunctionMaybe<number | string | RemoveAttribute>;
    y?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface TextPathSVGAttributes<T>
    extends
      TextContentElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      Pick<
        PresentationSVGAttributes,
        "alignment-baseline" | "baseline-shift" | "display" | "visibility"
      > {
    href?: FunctionMaybe<string | RemoveAttribute>;
    method?: FunctionMaybe<"align" | "stretch" | RemoveAttribute>;
    spacing?: FunctionMaybe<"auto" | "exact" | RemoveAttribute>;
    startOffset?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface TSpanSVGAttributes<T>
    extends
      TextContentElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      Pick<
        PresentationSVGAttributes,
        "alignment-baseline" | "baseline-shift" | "display" | "visibility"
      > {
    dx?: FunctionMaybe<number | string | RemoveAttribute>;
    dy?: FunctionMaybe<number | string | RemoveAttribute>;
    lengthAdjust?: FunctionMaybe<"spacing" | "spacingAndGlyphs" | RemoveAttribute>;
    rotate?: FunctionMaybe<number | string | RemoveAttribute>;
    textLength?: FunctionMaybe<number | string | RemoveAttribute>;
    x?: FunctionMaybe<number | string | RemoveAttribute>;
    y?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  /** @see https://developer.mozilla.org/en-US/docs/Web/SVG/Element/use */
  interface UseSVGAttributes<T>
    extends
      SVGAttributes<T>,
      StylableSVGAttributes,
      ConditionalProcessingSVGAttributes,
      GraphicsElementSVGAttributes<T>,
      PresentationSVGAttributes,
      ExternalResourceSVGAttributes,
      TransformableSVGAttributes {
    height?: FunctionMaybe<number | string | RemoveAttribute>;
    href?: FunctionMaybe<string | RemoveAttribute>;
    width?: FunctionMaybe<number | string | RemoveAttribute>;
    x?: FunctionMaybe<number | string | RemoveAttribute>;
    y?: FunctionMaybe<number | string | RemoveAttribute>;
  }
  interface ViewSVGAttributes<T>
    extends
      SVGAttributes<T>,
      ExternalResourceSVGAttributes,
      FitToViewBoxSVGAttributes,
      ZoomAndPanSVGAttributes {
    viewTarget?: FunctionMaybe<string | RemoveAttribute>;
  }

  // MATH

  interface MathMLAnnotationElementAttributes<T> extends MathMLAttributes<T> {
    encoding?: FunctionMaybe<string | RemoveAttribute>;

    /** @deprecated */
    src?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface MathMLAnnotationXmlElementAttributes<T> extends MathMLAttributes<T> {
    encoding?: FunctionMaybe<string | RemoveAttribute>;

    /** @deprecated */
    src?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface MathMLMactionElementAttributes<T> extends MathMLAttributes<T> {
    /**
     * @deprecated
     * @non-standard
     */
    actiontype?: FunctionMaybe<"statusline" | "toggle" | RemoveAttribute>;
    /**
     * @deprecated
     * @non-standard
     */
    selection?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface MathMLMathElementAttributes<T> extends MathMLAttributes<T> {
    display?: FunctionMaybe<"block" | "inline" | RemoveAttribute>;
  }
  interface MathMLMerrorElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMfracElementAttributes<T> extends MathMLAttributes<T> {
    linethickness?: FunctionMaybe<string | RemoveAttribute>;

    /**
     * @deprecated
     * @non-standard
     */
    denomalign?: FunctionMaybe<"center" | "left" | "right" | RemoveAttribute>;
    /**
     * @deprecated
     * @non-standard
     */
    numalign?: FunctionMaybe<"center" | "left" | "right" | RemoveAttribute>;
  }
  interface MathMLMiElementAttributes<T> extends MathMLAttributes<T> {
    mathvariant?: FunctionMaybe<"normal" | RemoveAttribute>;
  }

  interface MathMLMmultiscriptsElementAttributes<T> extends MathMLAttributes<T> {
    /**
     * @deprecated
     * @non-standard
     */
    subscriptshift?: FunctionMaybe<string | RemoveAttribute>;
    /**
     * @deprecated
     * @non-standard
     */
    superscriptshift?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface MathMLMnElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMoElementAttributes<T> extends MathMLAttributes<T> {
    fence?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    form?: FunctionMaybe<"prefix" | "infix" | "postfix" | RemoveAttribute>;
    largeop?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    lspace?: FunctionMaybe<string | RemoveAttribute>;
    maxsize?: FunctionMaybe<string | RemoveAttribute>;
    minsize?: FunctionMaybe<string | RemoveAttribute>;
    movablelimits?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    rspace?: FunctionMaybe<string | RemoveAttribute>;
    separator?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    stretchy?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    symmetric?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;

    /** @non-standard */
    accent?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
  }
  interface MathMLMoverElementAttributes<T> extends MathMLAttributes<T> {
    accent?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
  }
  interface MathMLMpaddedElementAttributes<T> extends MathMLAttributes<T> {
    depth?: FunctionMaybe<string | RemoveAttribute>;
    height?: FunctionMaybe<string | RemoveAttribute>;
    lspace?: FunctionMaybe<string | RemoveAttribute>;
    voffset?: FunctionMaybe<string | RemoveAttribute>;
    width?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface MathMLMphantomElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMprescriptsElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMrootElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMrowElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMsElementAttributes<T> extends MathMLAttributes<T> {
    /** @deprecated */
    lquote?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    rquote?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface MathMLMspaceElementAttributes<T> extends MathMLAttributes<T> {
    depth?: FunctionMaybe<string | RemoveAttribute>;
    height?: FunctionMaybe<string | RemoveAttribute>;
    width?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface MathMLMsqrtElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMstyleElementAttributes<T> extends MathMLAttributes<T> {
    /**
     * @deprecated
     * @non-standard
     */
    background?: FunctionMaybe<string | RemoveAttribute>;
    /**
     * @deprecated
     * @non-standard
     */
    color?: FunctionMaybe<string | RemoveAttribute>;
    /**
     * @deprecated
     * @non-standard
     */
    fontsize?: FunctionMaybe<string | RemoveAttribute>;
    /**
     * @deprecated
     * @non-standard
     */
    fontstyle?: FunctionMaybe<string | RemoveAttribute>;
    /**
     * @deprecated
     * @non-standard
     */
    fontweight?: FunctionMaybe<string | RemoveAttribute>;

    /** @deprecated */
    scriptminsize?: FunctionMaybe<string | RemoveAttribute>;
    /** @deprecated */
    scriptsizemultiplier?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface MathMLMsubElementAttributes<T> extends MathMLAttributes<T> {
    /**
     * @deprecated
     * @non-standard
     */
    subscriptshift?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface MathMLMsubsupElementAttributes<T> extends MathMLAttributes<T> {
    /**
     * @deprecated
     * @non-standard
     */
    subscriptshift?: FunctionMaybe<string | RemoveAttribute>;
    /**
     * @deprecated
     * @non-standard
     */
    superscriptshift?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface MathMLMsupElementAttributes<T> extends MathMLAttributes<T> {
    /**
     * @deprecated
     * @non-standard
     */
    superscriptshift?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface MathMLMtableElementAttributes<T> extends MathMLAttributes<T> {
    /** @non-standard */
    align?: FunctionMaybe<"axis" | "baseline" | "bottom" | "center" | "top" | RemoveAttribute>;
    /** @non-standard */
    columnalign?: FunctionMaybe<"center" | "left" | "right" | RemoveAttribute>;
    /** @non-standard */
    columnlines?: FunctionMaybe<"dashed" | "none" | "solid" | RemoveAttribute>;
    /** @non-standard */
    columnspacing?: FunctionMaybe<string | RemoveAttribute>;
    /** @non-standard */
    frame?: FunctionMaybe<"dashed" | "none" | "solid" | RemoveAttribute>;
    /** @non-standard */
    framespacing?: FunctionMaybe<string | RemoveAttribute>;
    /** @non-standard */
    rowalign?: FunctionMaybe<"axis" | "baseline" | "bottom" | "center" | "top" | RemoveAttribute>;
    /** @non-standard */
    rowlines?: FunctionMaybe<"dashed" | "none" | "solid" | RemoveAttribute>;
    /** @non-standard */
    rowspacing?: FunctionMaybe<string | RemoveAttribute>;
    /** @non-standard */
    width?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface MathMLMtdElementAttributes<T> extends MathMLAttributes<T> {
    columnspan?: FunctionMaybe<number | string | RemoveAttribute>;
    rowspan?: FunctionMaybe<number | string | RemoveAttribute>;
    /** @non-standard */
    columnalign?: FunctionMaybe<"center" | "left" | "right" | RemoveAttribute>;
    /** @non-standard */
    rowalign?: FunctionMaybe<"axis" | "baseline" | "bottom" | "center" | "top" | RemoveAttribute>;
  }
  interface MathMLMtextElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMtrElementAttributes<T> extends MathMLAttributes<T> {
    /** @non-standard */
    columnalign?: FunctionMaybe<"center" | "left" | "right" | RemoveAttribute>;
    /** @non-standard */
    rowalign?: FunctionMaybe<"axis" | "baseline" | "bottom" | "center" | "top" | RemoveAttribute>;
  }
  interface MathMLMunderElementAttributes<T> extends MathMLAttributes<T> {
    accentunder?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
  }
  interface MathMLMunderoverElementAttributes<T> extends MathMLAttributes<T> {
    accent?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
    accentunder?: FunctionMaybe<BooleanAttribute | RemoveAttribute>;
  }
  interface MathMLSemanticsElementAttributes<T> extends MathMLAttributes<T> {}

  interface MathMLMencloseElementAttributes<T> extends MathMLAttributes<T> {
    /** @non-standard */
    notation?: FunctionMaybe<string | RemoveAttribute>;
  }
  interface MathMLMfencedElementAttributes<T> extends MathMLAttributes<T> {
    close?: FunctionMaybe<string | RemoveAttribute>;
    open?: FunctionMaybe<string | RemoveAttribute>;
    separators?: FunctionMaybe<string | RemoveAttribute>;
  }

  // TAGS

  /** @type {HTMLElementTagNameMap} */
  interface HTMLElementTags {
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/a
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLAnchorElement
     */
    a: AnchorHTMLAttributes<HTMLAnchorElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/abbr
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    abbr: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/address
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    address: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/area
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLAreaElement
     */
    area: AreaHTMLAttributes<HTMLAreaElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/article
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    article: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/aside
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    aside: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/audio
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLAudioElement
     */
    audio: AudioHTMLAttributes<HTMLAudioElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/b
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    b: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/base
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLBaseElement
     */
    base: BaseHTMLAttributes<HTMLBaseElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/bdi
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    bdi: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/bdo
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    bdo: BdoHTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/blockquote
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLQuoteElement
     */
    blockquote: BlockquoteHTMLAttributes<HTMLQuoteElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/body
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLBodyElement
     */
    body: BodyHTMLAttributes<HTMLBodyElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/br
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLBRElement
     */
    br: HTMLAttributes<HTMLBRElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLButtonElement
     */
    button: ButtonHTMLAttributes<HTMLButtonElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/canvas
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement
     */
    canvas: CanvasHTMLAttributes<HTMLCanvasElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/caption
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTableCaptionElement
     */
    caption: CaptionHTMLAttributes<HTMLTableCaptionElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/cite
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    cite: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/code
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    code: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/col
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTableColElement
     */
    col: ColHTMLAttributes<HTMLTableColElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/colgroup
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTableColElement
     */
    colgroup: ColgroupHTMLAttributes<HTMLTableColElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/data
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLDataElement
     */
    data: DataHTMLAttributes<HTMLDataElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/datalist
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLDataListElement
     */
    datalist: HTMLAttributes<HTMLDataListElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dd
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    dd: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/del
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLModElement
     */
    del: ModHTMLAttributes<HTMLModElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/details
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLDetailsElement
     */
    details: DetailsHtmlAttributes<HTMLDetailsElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dfn
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    dfn: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement
     */
    dialog: DialogHtmlAttributes<HTMLDialogElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/div
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLDivElement
     */
    div: HTMLAttributes<HTMLDivElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dl
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLDListElement
     */
    dl: HTMLAttributes<HTMLDListElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dt
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    dt: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/em
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    em: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/embed
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLEmbedElement
     */
    embed: EmbedHTMLAttributes<HTMLEmbedElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/fieldset
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLFieldSetElement
     */
    fieldset: FieldsetHTMLAttributes<HTMLFieldSetElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/figcaption
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    figcaption: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/figure
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    figure: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/footer
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    footer: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement
     */
    form: FormHTMLAttributes<HTMLFormElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/h1
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLHeadingElement
     */
    h1: HTMLAttributes<HTMLHeadingElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/h2
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLHeadingElement
     */
    h2: HTMLAttributes<HTMLHeadingElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/h3
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLHeadingElement
     */
    h3: HTMLAttributes<HTMLHeadingElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/h4
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLHeadingElement
     */
    h4: HTMLAttributes<HTMLHeadingElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/h5
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLHeadingElement
     */
    h5: HTMLAttributes<HTMLHeadingElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/h6
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLHeadingElement
     */
    h6: HTMLAttributes<HTMLHeadingElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/head
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLHeadElement
     */
    head: HTMLAttributes<HTMLHeadElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/header
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    header: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/hgroup
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    hgroup: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/hr
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLHRElement
     */
    hr: HTMLAttributes<HTMLHRElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/html
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLHtmlElement
     */
    html: HTMLAttributes<HTMLHtmlElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/i
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    i: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement
     */
    iframe: IframeHTMLAttributes<HTMLIFrameElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/img
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement
     */
    img: ImgHTMLAttributes<HTMLImageElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement
     */
    input: InputHTMLAttributes<HTMLInputElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/ins
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLModElement
     */
    ins: ModHTMLAttributes<HTMLModElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/kbd
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    kbd: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/label
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLLabelElement
     */
    label: LabelHTMLAttributes<HTMLLabelElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/legend
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLLegendElement
     */
    legend: HTMLAttributes<HTMLLegendElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/li
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLLIElement
     */
    li: LiHTMLAttributes<HTMLLIElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/link
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLLinkElement
     */
    link: LinkHTMLAttributes<HTMLLinkElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/main
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    main: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/map
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLMapElement
     */
    map: MapHTMLAttributes<HTMLMapElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/mark
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    mark: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/menu
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLMenuElement
     */
    menu: MenuHTMLAttributes<HTMLMenuElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLMetaElement
     */
    meta: MetaHTMLAttributes<HTMLMetaElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meter
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLMeterElement
     */
    meter: MeterHTMLAttributes<HTMLMeterElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/nav
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    nav: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/noscript
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    noscript: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/object
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLObjectElement
     */
    object: ObjectHTMLAttributes<HTMLObjectElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/ol
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLOListElement
     */
    ol: OlHTMLAttributes<HTMLOListElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/optgroup
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLOptGroupElement
     */
    optgroup: OptgroupHTMLAttributes<HTMLOptGroupElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/option
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLOptionElement
     */
    option: OptionHTMLAttributes<HTMLOptionElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/output
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLOutputElement
     */
    output: OutputHTMLAttributes<HTMLOutputElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/p
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLParagraphElement
     */
    p: HTMLAttributes<HTMLParagraphElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/picture
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLPictureElement
     */
    picture: HTMLAttributes<HTMLPictureElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/pre
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLPreElement
     */
    pre: HTMLAttributes<HTMLPreElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/progress
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLProgressElement
     */
    progress: ProgressHTMLAttributes<HTMLProgressElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/q
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLQuoteElement
     */
    q: QuoteHTMLAttributes<HTMLQuoteElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/rp
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    rp: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/rt
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    rt: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/ruby
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    ruby: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/s
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    s: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/samp
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    samp: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLScriptElement
     */
    script: ScriptHTMLAttributes<HTMLScriptElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/search
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    search: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/section
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    section: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/select
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLSelectElement
     */
    select: SelectHTMLAttributes<HTMLSelectElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/slot
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLSlotElement
     */
    slot: HTMLSlotElementAttributes<HTMLSlotElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/small
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    small: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/source
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLSourceElement
     */
    source: SourceHTMLAttributes<HTMLSourceElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/span
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLSpanElement
     */
    span: HTMLAttributes<HTMLSpanElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/strong
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    strong: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/style
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLStyleElement
     */
    style: StyleHTMLAttributes<HTMLStyleElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/sub
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    sub: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/summary
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    summary: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/sup
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    sup: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/table
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTableElement
     */
    table: HTMLAttributes<HTMLTableElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/tbody
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTableSectionElement
     */
    tbody: HTMLAttributes<HTMLTableSectionElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/td
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTableCellElement
     */
    td: TdHTMLAttributes<HTMLTableCellElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/template
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTemplateElement
     */
    template: TemplateHTMLAttributes<HTMLTemplateElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/textarea
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTextAreaElement
     */
    textarea: TextareaHTMLAttributes<HTMLTextAreaElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/tfoot
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTableSectionElement
     */
    tfoot: HTMLAttributes<HTMLTableSectionElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/th
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTableCellElement
     */
    th: ThHTMLAttributes<HTMLTableCellElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/thead
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTableSectionElement
     */
    thead: HTMLAttributes<HTMLTableSectionElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/time
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTimeElement
     */
    time: TimeHTMLAttributes<HTMLTimeElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/title
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTitleElement
     */
    title: HTMLAttributes<HTMLTitleElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/tr
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTableRowElement
     */
    tr: HTMLAttributes<HTMLTableRowElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/track
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLTrackElement
     */
    track: TrackHTMLAttributes<HTMLTrackElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/u
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    u: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/ul
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLUListElement
     */
    ul: HTMLAttributes<HTMLUListElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/var
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    var: HTMLAttributes<HTMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement
     */
    video: VideoHTMLAttributes<HTMLVideoElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/wbr
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    wbr: HTMLAttributes<HTMLElement>;
    /** @url https://www.electronjs.org/docs/latest/api/webview-tag */
    webview: WebViewHTMLAttributes<HTMLElement>;
  }
  /** @type {HTMLElementDeprecatedTagNameMap} */
  interface HTMLElementDeprecatedTags {
    /**
     * @deprecated
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/big
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement
     */
    big: HTMLAttributes<HTMLElement>;
    /**
     * @deprecated
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/keygen
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLUnknownElement
     */
    keygen: KeygenHTMLAttributes<HTMLUnknownElement>;
    /**
     * @deprecated
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/menuitem
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLUnknownElement
     */
    menuitem: HTMLAttributes<HTMLUnknownElement>;
    /**
     * @deprecated
     * @url https://developer.mozilla.org/en-US/docs/Web/HTML/Element/param
     * @url https://developer.mozilla.org/en-US/docs/Web/API/HTMLParamElement
     */
    param: ParamHTMLAttributes<HTMLParamElement>;
  }
  /** @type {SVGElementTagNameMap} */
  interface SVGElementTags {
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/animate
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGAnimateElement
     */
    animate: AnimateSVGAttributes<SVGAnimateElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/animateMotion
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGAnimateMotionElement
     */
    animateMotion: AnimateMotionSVGAttributes<SVGAnimateMotionElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/animateTransform
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGAnimateTransformElement
     */
    animateTransform: AnimateTransformSVGAttributes<SVGAnimateTransformElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/circle
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGCircleElement
     */
    circle: CircleSVGAttributes<SVGCircleElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/clipPath
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGClipPathElement
     */
    clipPath: ClipPathSVGAttributes<SVGClipPathElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/defs
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGDefsElement
     */
    defs: DefsSVGAttributes<SVGDefsElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/desc
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGDescElement
     */
    desc: DescSVGAttributes<SVGDescElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/ellipse
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGEllipseElement
     */
    ellipse: EllipseSVGAttributes<SVGEllipseElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feBlend
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEBlendElement
     */
    feBlend: FeBlendSVGAttributes<SVGFEBlendElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feColorMatrix
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEColorMatrixElement
     */
    feColorMatrix: FeColorMatrixSVGAttributes<SVGFEColorMatrixElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feComponentTransfer
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEComponentTransferElemen
     */
    feComponentTransfer: FeComponentTransferSVGAttributes<SVGFEComponentTransferElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feComposite
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFECompositeElement
     */
    feComposite: FeCompositeSVGAttributes<SVGFECompositeElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feConvolveMatrix
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEConvolveMatrixElement
     */
    feConvolveMatrix: FeConvolveMatrixSVGAttributes<SVGFEConvolveMatrixElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feDiffuseLighting
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEDiffuseLightingElement
     */
    feDiffuseLighting: FeDiffuseLightingSVGAttributes<SVGFEDiffuseLightingElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feDisplacementMap
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEDisplacementMapElement
     */
    feDisplacementMap: FeDisplacementMapSVGAttributes<SVGFEDisplacementMapElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feDistantLight
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEDistantLightElement
     */
    feDistantLight: FeDistantLightSVGAttributes<SVGFEDistantLightElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feDropShadow
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEDropShadowElement
     */
    feDropShadow: FeDropShadowSVGAttributes<SVGFEDropShadowElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feFlood
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEFloodElement
     */
    feFlood: FeFloodSVGAttributes<SVGFEFloodElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feFuncA
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEFuncAElement
     */
    feFuncA: FeFuncSVGAttributes<SVGFEFuncAElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feFuncB
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEFuncBElement
     */
    feFuncB: FeFuncSVGAttributes<SVGFEFuncBElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feFuncG
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEFuncGElement
     */
    feFuncG: FeFuncSVGAttributes<SVGFEFuncGElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feFuncR
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEFuncRElement
     */
    feFuncR: FeFuncSVGAttributes<SVGFEFuncRElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feGaussianBlur
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEGaussianBlurElement
     */
    feGaussianBlur: FeGaussianBlurSVGAttributes<SVGFEGaussianBlurElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feImage
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEImageElement
     */
    feImage: FeImageSVGAttributes<SVGFEImageElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feMerge
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEMergeElement
     */
    feMerge: FeMergeSVGAttributes<SVGFEMergeElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feMergeNode
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEMergeNodeElement
     */
    feMergeNode: FeMergeNodeSVGAttributes<SVGFEMergeNodeElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feMorphology
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEMorphologyElement
     */
    feMorphology: FeMorphologySVGAttributes<SVGFEMorphologyElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feOffset
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEOffsetElement
     */
    feOffset: FeOffsetSVGAttributes<SVGFEOffsetElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/fePointLight
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFEPointLightElement
     */
    fePointLight: FePointLightSVGAttributes<SVGFEPointLightElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feSpecularLighting
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFESpecularLightingElement
     */
    feSpecularLighting: FeSpecularLightingSVGAttributes<SVGFESpecularLightingElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feSpotLight
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFESpotLightElement
     */
    feSpotLight: FeSpotLightSVGAttributes<SVGFESpotLightElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feTile
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFETileElement
     */
    feTile: FeTileSVGAttributes<SVGFETileElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feTurbulence
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFETurbulenceElement
     */
    feTurbulence: FeTurbulanceSVGAttributes<SVGFETurbulenceElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/filter
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGFilterElement
     */
    filter: FilterSVGAttributes<SVGFilterElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/foreignObject
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGForeignObjectElement
     */
    foreignObject: ForeignObjectSVGAttributes<SVGForeignObjectElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/g
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGGElement
     */
    g: GSVGAttributes<SVGGElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/image
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGImageElement
     */
    image: ImageSVGAttributes<SVGImageElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/line
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGLineElement
     */
    line: LineSVGAttributes<SVGLineElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/linearGradient
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGLinearGradientElement
     */
    linearGradient: LinearGradientSVGAttributes<SVGLinearGradientElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/marker
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGMarkerElement
     */
    marker: MarkerSVGAttributes<SVGMarkerElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/mask
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGMaskElement
     */
    mask: MaskSVGAttributes<SVGMaskElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/metadata
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGMetadataElement
     */
    metadata: MetadataSVGAttributes<SVGMetadataElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/mpath
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGMPathElement
     */
    mpath: MPathSVGAttributes<SVGMPathElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/path
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGPathElement
     */
    path: PathSVGAttributes<SVGPathElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/pattern
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGPatternElement
     */
    pattern: PatternSVGAttributes<SVGPatternElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/polygon
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGPolygonElement
     */
    polygon: PolygonSVGAttributes<SVGPolygonElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/polyline
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGPolylineElement
     */
    polyline: PolylineSVGAttributes<SVGPolylineElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/radialGradient
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGRadialGradientElement
     */
    radialGradient: RadialGradientSVGAttributes<SVGRadialGradientElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/rect
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGRectElement
     */
    rect: RectSVGAttributes<SVGRectElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/set
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGSetElement
     */
    set: SetSVGAttributes<SVGSetElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/stop
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGStopElement
     */
    stop: StopSVGAttributes<SVGStopElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/svg
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGSVGElement
     */
    svg: SvgSVGAttributes<SVGSVGElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/switch
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGSwitchElement
     */
    switch: SwitchSVGAttributes<SVGSwitchElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/symbol
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGSymbolElement
     */
    symbol: SymbolSVGAttributes<SVGSymbolElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/text
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGTextElement
     */
    text: TextSVGAttributes<SVGTextElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/textPath
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGTextPathElement
     */
    textPath: TextPathSVGAttributes<SVGTextPathElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/tspan
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGTSpanElement
     */
    tspan: TSpanSVGAttributes<SVGTSpanElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/use
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGUseElement
     */
    use: UseSVGAttributes<SVGUseElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/SVG/Element/view
     * @url https://developer.mozilla.org/en-US/docs/Web/API/SVGViewElement
     */
    view: ViewSVGAttributes<SVGViewElement>;
  }

  interface MathMLElementTags {
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/annotation
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    annotation: MathMLAnnotationElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/annotation-xml
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    "annotation-xml": MathMLAnnotationXmlElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/math
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    math: MathMLMathElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/merror
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    merror: MathMLMerrorElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mfrac
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mfrac: MathMLMfracElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mi
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mi: MathMLMiElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mmultiscripts
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mmultiscripts: MathMLMmultiscriptsElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mn
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mn: MathMLMnElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mo
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mo: MathMLMoElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mover
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mover: MathMLMoverElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mpadded
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mpadded: MathMLMpaddedElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mphantom
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mphantom: MathMLMphantomElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mprescripts
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mprescripts: MathMLMprescriptsElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mroot
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mroot: MathMLMrootElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mrow
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mrow: MathMLMrowElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/ms
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    ms: MathMLMsElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mspace
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mspace: MathMLMspaceElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/msqrt
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    msqrt: MathMLMsqrtElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mstyle
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mstyle: MathMLMstyleElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/msub
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    msub: MathMLMsubElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/msubsup
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    msubsup: MathMLMsubsupElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/msup
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    msup: MathMLMsupElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mtable
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mtable: MathMLMtableElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mtd
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mtd: MathMLMtdElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mtext
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mtext: MathMLMtextElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mtr
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mtr: MathMLMtrElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/munder
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    munder: MathMLMunderElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/munderover
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    munderover: MathMLMunderoverElementAttributes<MathMLElement>;
    /**
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/semantics
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    semantics: MathMLSemanticsElementAttributes<MathMLElement>;
    /**
     * @non-standard
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/menclose
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    menclose: MathMLMencloseElementAttributes<MathMLElement>;
    /**
     * @deprecated
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/maction
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    maction: MathMLMactionElementAttributes<MathMLElement>;
    /**
     * @deprecated
     * @non-standard
     * @url https://developer.mozilla.org/en-US/docs/Web/MathML/Element/mfenced
     * @url https://developer.mozilla.org/en-US/docs/Web/API/MathMLElement
     */
    mfenced: MathMLMfencedElementAttributes<MathMLElement>;
  }

  interface IntrinsicElements
    extends HTMLElementTags, HTMLElementDeprecatedTags, SVGElementTags, MathMLElementTags {}
}
