import { createUniqueId, createSignal } from "solid-js";

const Settings = () => {
  const [text, setText] = createSignal("Hi");
  const id = createUniqueId();
  return <>
    <h1>Settings</h1>
    <p>All that configuration you never really ever want to look at.</p>
    <label for={id}>Write:</label>
    <input type="text" id={id} value={text()} onInput={e => setText(e.currentTarget.value)} />
    <p>{text()}</p>
  </>
};

export default Settings;