import { hydrate } from "solid-js/dom";
import App from "./components/App";

// entry point for browser
hydrate(App, document.getElementById("app"));