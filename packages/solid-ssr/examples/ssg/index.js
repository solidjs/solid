import { renderToStringAsync } from "solid-js/web";
import App from "../shared/src/components/App";

// entry point for server render
export default async req => {
  return await renderToStringAsync(() => <App url={req.url} />);
};
