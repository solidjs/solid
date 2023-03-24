import { JSX } from "jsx";

type FunctionMaybe<T = unknown> = JSX.FunctionMaybe<T>;
type HTMLAttributes<T = unknown> = JSX.HTMLAttributes<T>;
type HTMLCrossorigin = JSX.HTMLCrossorigin;
type HTMLFormEncType = JSX.HTMLFormEncType;
type HTMLFormMethod = JSX.HTMLFormMethod;

interface GlobalInputHTMLAttributes<T> extends HTMLAttributes<T> {
  autofocus?: FunctionMaybe<boolean>;
  capture?: FunctionMaybe<boolean | string>;
  crossorigin?: FunctionMaybe<HTMLCrossorigin>;
  disabled?: FunctionMaybe<boolean>;
  form?: FunctionMaybe<string>;
  name?: FunctionMaybe<string>;
  type?: FunctionMaybe<string>;
  value?: FunctionMaybe<string | string[] | number>;
  crossOrigin?: FunctionMaybe<HTMLCrossorigin>;
}

type HTMLFormTargetType = "_self" | "_blank" | "_parent" | "_top" | string;

type ConditionalInputHTMLAttributeTypes = {
  accept?: FunctionMaybe<string>;
  alt?: FunctionMaybe<string>;
  autocomplete?: FunctionMaybe<string>;
  checked?: FunctionMaybe<boolean>;
  dirname?: string | undefined;
  formaction?: FunctionMaybe<string>;
  formenctype?: FunctionMaybe<HTMLFormEncType>;
  formmethod?: FunctionMaybe<HTMLFormMethod>;
  formnovalidate?: FunctionMaybe<boolean>;
  formtarget?: FunctionMaybe<HTMLFormTargetType>;
  height?: FunctionMaybe<number | string>;
  list?: FunctionMaybe<string>;
  max?: FunctionMaybe<number | string>;
  maxlength?: FunctionMaybe<number | string>;
  min?: FunctionMaybe<number | string>;
  minlength?: FunctionMaybe<number | string>;
  multiple?: FunctionMaybe<boolean>;
  pattern?: FunctionMaybe<string>;
  placeholder?: FunctionMaybe<string>;
  popovertarget?: FunctionMaybe<string>;
  popovertargetaction?: FunctionMaybe<string>;
  readonly?: FunctionMaybe<boolean>;
  required?: FunctionMaybe<boolean>;
  size?: FunctionMaybe<number | string>;
  src?: FunctionMaybe<string>;
  step?: FunctionMaybe<number | string>;
  width?: FunctionMaybe<number | string>;
  formAction?: FunctionMaybe<string>;
  formEnctype?: FunctionMaybe<HTMLFormEncType>;
  formMethod?: FunctionMaybe<HTMLFormMethod>;
  formNoValidate?: FunctionMaybe<boolean>;
  formTarget?: FunctionMaybe<string>;
  maxLength?: FunctionMaybe<number | string>;
  minLength?: FunctionMaybe<number | string>;
  readOnly?: FunctionMaybe<boolean>;
};

type NonStandardInputTypes = {
  autocapitalize?: "none" | "sentences" | "words" | "characters" | undefined; // Safari only
  autocorrect?: "on" | "off" | undefined; // Safari only
  incremental?: boolean | undefined; // WebKit and Blink extension (Safari, Opera, Chrome, etc.)
  orient?: "horizontal" | "vertical" | undefined; // Firefox only
  results?: number | undefined; // Safari only
  webkitdirectory?: boolean | undefined; // Broad support but still non-standard
};

type HiddenInput = { type: "hidden" } & Pick<ConditionalInputHTMLAttributeTypes, "autocomplete">;

type TextInput = { type: "text" } & Pick<
  ConditionalInputHTMLAttributeTypes,
  | "autocomplete"
  | "dirname"
  | "list"
  | "maxlength"
  | "minlength"
  | "pattern"
  | "placeholder"
  | "readonly"
  | "required"
  | "size"
>;

type SearchInput = { type: "search" } & Pick<
  ConditionalInputHTMLAttributeTypes,
  | "autocomplete"
  | "dirname"
  | "list"
  | "maxlength"
  | "minlength"
  | "pattern"
  | "placeholder"
  | "readonly"
  | "required"
  | "size"
>;

type UrlInput = { type: "url" } & Pick<
  ConditionalInputHTMLAttributeTypes,
  | "autocomplete"
  | "list"
  | "maxlength"
  | "minlength"
  | "pattern"
  | "placeholder"
  | "readonly"
  | "required"
  | "size"
>;

type TelInput = { type: "tel" } & Pick<
  ConditionalInputHTMLAttributeTypes,
  | "autocomplete"
  | "list"
  | "maxlength"
  | "minlength"
  | "pattern"
  | "placeholder"
  | "readonly"
  | "required"
  | "size"
>;

type EmailInput = { type: "email" } & Pick<
  ConditionalInputHTMLAttributeTypes,
  | "autocomplete"
  | "list"
  | "maxlength"
  | "minlength"
  | "multiple"
  | "pattern"
  | "placeholder"
  | "readonly"
  | "required"
  | "size"
>;

type PasswordInput = { type: "password" } & Pick<
  ConditionalInputHTMLAttributeTypes,
  | "autocomplete"
  | "maxlength"
  | "minlength"
  | "pattern"
  | "placeholder"
  | "readonly"
  | "required"
  | "size"
>;

type DateInput = { type: "date" } & Pick<
  ConditionalInputHTMLAttributeTypes,
  "autocomplete" | "list" | "max" | "min" | "readonly" | "required" | "step"
>;

type MonthInput = { type: "month" } & Pick<
  ConditionalInputHTMLAttributeTypes,
  "autocomplete" | "list" | "max" | "min" | "readonly" | "required" | "step"
>;

type WeekInput = { type: "week" } & Pick<
  ConditionalInputHTMLAttributeTypes,
  "autocomplete" | "list" | "max" | "min" | "readonly" | "required" | "step"
>;

type TimeInput = { type: "time" } & Pick<
  ConditionalInputHTMLAttributeTypes,
  "autocomplete" | "list" | "max" | "min" | "readonly" | "required" | "step"
>;

type DatetimeLocalInput = { type: "datetime-local" } & Pick<
  ConditionalInputHTMLAttributeTypes,
  "autocomplete" | "list" | "max" | "min" | "readonly" | "required" | "step"
>;

type NumberInput = { type: "number" } & Pick<
  ConditionalInputHTMLAttributeTypes,
  "autocomplete" | "list" | "max" | "min" | "placeholder" | "readonly" | "required" | "step"
>;

type RangeInput = { type: "range" } & Pick<
  ConditionalInputHTMLAttributeTypes,
  "autocomplete" | "list" | "max" | "min" | "step"
>;

type ColorInput = { type: "color" } & Pick<
  ConditionalInputHTMLAttributeTypes,
  "autocomplete" | "list"
>;

type CheckboxInput = { type: "checkbox" } & Pick<
  ConditionalInputHTMLAttributeTypes,
  "checked" | "required"
>;

type RadioButtonInput = { type: "radio" } & Pick<
  ConditionalInputHTMLAttributeTypes,
  "checked" | "required"
>;

type FileUploadInput = { type: "file" } & Pick<
  ConditionalInputHTMLAttributeTypes,
  "accept" | "multiple" | "required"
>;

type SubmitButtonInput = { type: "submit" } & Pick<
  ConditionalInputHTMLAttributeTypes,
  | "formaction"
  | "formenctype"
  | "formmethod"
  | "formnovalidate"
  | "formtarget"
  | "popovertarget"
  | "popovertargetaction"
>;

type ImageButtonInput = { type: "image" } & Pick<
  ConditionalInputHTMLAttributeTypes,
  | "alt"
  | "formaction"
  | "formenctype"
  | "formmethod"
  | "formnovalidate"
  | "formtarget"
  | "height"
  | "popovertarget"
  | "popovertargetaction"
  | "src"
  | "width"
>;

type ResetButtonInput = { type: "reset" } & Pick<
  ConditionalInputHTMLAttributeTypes,
  "popovertarget" | "popovertargetaction"
>;

type ButtonInput = { type: "button" } & Pick<
  ConditionalInputHTMLAttributeTypes,
  "popovertarget" | "popovertargetaction"
>;
