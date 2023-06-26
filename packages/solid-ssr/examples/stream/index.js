import express from "express";
import url from "url";

import { renderToStream } from "solid-js/web";
import App from "../shared/src/components/App";

const app = express();
const port = 8080;

app.use(express.static(url.fileURLToPath(new URL("../public", import.meta.url))));

app.get("*", (req, res) => renderToStream(() => <App url={req.url} />).pipe(res));

app.listen(port, () => console.log(`Example app listening on port ${port}!`));
