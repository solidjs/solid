/// <reference path="../../node_modules/dom-expressions/runtime.d.ts" />
import { createHTML } from "lit-dom-expressions";
import {
  wrap,
  insert,
  createComponent,
  delegateEvents,
  classList
} from "./index.js";

export default createHTML({
  wrap,
  insert,
  createComponent,
  delegateEvents,
  classList
});
