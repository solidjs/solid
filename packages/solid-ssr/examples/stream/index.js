import express from "express";
import path from "path";

import { renderToPipeableStream } from "solid-js/web";
import App from "../shared/src/components/App";

const app = express();
const port = 8080;

app.use(express.static(path.join(__dirname, "../public")));

app.get("*", (req, res) => renderToPipeableStream(() => <App url={req.url} />).pipe(res));

app.listen(port, () => console.log(`Example app listening on port ${port}!`));
