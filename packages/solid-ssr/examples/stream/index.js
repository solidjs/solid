import express from "express";
import path from "path";

import { pipeToNodeWritable } from "solid-js/web";
import App from "../shared/src/components/App";

const app = express();
const port = 8080;

app.use(express.static(path.join(__dirname, "../public")));

app.get("*", (req, res) => pipeToNodeWritable(() => <App url={req.url} />, res));

app.listen(port, () => console.log(`Example app listening on port ${port}!`));
