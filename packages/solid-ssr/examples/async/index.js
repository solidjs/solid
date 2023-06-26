import express from "express";
import url from "url";

import { renderToStringAsync } from "solid-js/web";
import App from "../shared/src/components/App";

const app = express();
const port = 8080;

app.use(express.static(url.fileURLToPath(new URL("../public", import.meta.url))));

app.get("*", async (req, res) => {
  let result;
  try {
    result = await renderToStringAsync(() => <App url={req.url} />);
  } catch (err) {
    console.error(err);
  } finally {
    res.send(result);
  }
});

app.listen(port, () => console.log(`Example app listening on port ${port}!`));
