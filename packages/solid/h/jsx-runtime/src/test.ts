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

type TestType = HiddenInput | TextInput;

type InputHTMLAttributes<T> = HTMLAttributes<T> & TestType;
