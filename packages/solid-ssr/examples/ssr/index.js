import express from "express";
import path from "path";

import { renderToString } from "solid-js/web";
import App from "../shared/src/components/App";

const app = express();
const port = 8080;

app.use(express.static(path.join(__dirname, "../public")));

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
