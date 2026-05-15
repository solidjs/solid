import { createSignal, createUniqueId } from "solid-js";
import { Portal } from "@solidjs/web";

const Settings = () => {
  const [text, setText] = createSignal("Hi");
  const [modalOpen, setModalOpen] = createSignal(false);
  const [modalClicks, setModalClicks] = createSignal(0);
  const id = createUniqueId();

  return (
    <section onClick={() => modalOpen() && setModalClicks(c => c + 1)}>
      <h1>Settings</h1>
      <p>All that configuration you never really ever want to look at.</p>
      <label for={id}>Write:</label>
      <input type="text" id={id} value={text()} onInput={e => setText(e.currentTarget.value)} />
      <p>{text()}</p>
      <button type="button" onClick={() => setModalOpen(true)}>
        Open body portal
      </button>
      <p>Portal logical clicks: {modalClicks()}</p>
      {modalOpen() && (
        <Portal>
          <div class="modal-backdrop">
            <div class="modal-card" role="dialog" aria-modal="true" aria-label="Settings portal">
              <h2>Body Portal</h2>
              <p>This modal is portaled to document.body.</p>
              <button type="button" onClick={() => setModalOpen(false)}>
                Close portal
              </button>
            </div>
          </div>
        </Portal>
      )}
    </section>
  );
};

export default Settings;
