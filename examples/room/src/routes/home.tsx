// Placeholder. Stage 8 Phase B puts the same room on this page as a live
// SERVER component — markup that keeps changing after it arrives, over one
// connection with the same declaration and status surface as /live.
export default function Home() {
  return (
    <div class="room">
      <header class="header">
        <div>
          <h1>Room</h1>
          <p class="muted">
            A shared room over live server functions. The live-sources page is at{" "}
            <a href="/live">/live</a>; this page is reserved for the server-component rendering of
            the same room (Phase B).
          </p>
        </div>
      </header>
    </div>
  );
}
