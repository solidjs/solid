import { Router } from "~/router";
import "./app.css";

export default function App() {
  return <Router>{props => props.children}</Router>;
}
