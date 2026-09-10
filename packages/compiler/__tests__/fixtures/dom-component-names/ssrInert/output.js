import { escape as _$escape } from "r-dom";
import { ssr as _$ssr } from "r-dom";
var _tmpl$ = [
	"<div>",
	"",
	"</div>"
];
import { Child, Ui } from "./components";
var _v$ = _$escape(Child({ name: "Jane" })), _v$2 = _$escape(Ui.Button({ variant: "primary" }));
const template = _$ssr(_tmpl$, _v$, _v$2);
