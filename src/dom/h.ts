/// <reference path="../../node_modules/dom-expressions/runtime.d.ts" />
import { createHyperScript } from "hyper-dom-expressions";
import {
  wrap,
  insert,
  createComponent,
  delegateEvents,
  classList
} from "./index";

export default createHyperScript({
  wrap,
  insert,
  createComponent,
  delegateEvents,
  classList
});
