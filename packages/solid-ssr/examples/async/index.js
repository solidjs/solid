import express from "express";
import path from "path";

import { renderToStringAsync } from "solid-js/web";
import App from "../shared/src/components/App";

const app = express();
const port = 8080;

app.use(express.static(path.join(__dirname, "../public")));

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
