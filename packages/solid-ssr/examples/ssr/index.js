import express from "express";
import url from "url";

import { renderToString } from "solid-js/web";
import App from "../shared/src/components/App";

const app = express();
const port = 8080;

app.use(express.static(url.fileURLToPath(new URL("../public", import.meta.url))));

app.get("*", (req, res) => {
  let html;
  try {
    html = renderToString(() => <App url={req.url} />);
  } catch (err) {
    console.error(err);
  } finally {
    res.send(html);
  }
});

app.listen(port, () => console.log(`Example app listening on port ${port}!`));
