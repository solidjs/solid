import { hydrate } from "solid-js/web";
import App from "./components/App";

// entry point for browser
hydrate(() => <App/>, document.getElementById("app"));