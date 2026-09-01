export const StatusMessage = ({ status }) => @switch (status) {
  @case "loading": {
    <p>Loading...</p>
  }
  @case "success": {
    <p class="success">Done!</p>
  }
  @default: {
    <p>Unknown status.</p>
  }
};

export function NoDefault({ mode }) @{
  <header>
    @switch (mode.kind) {
      @case "wide": {
        <h1>Wide</h1>
      }
      @case "narrow": {
        <h2>Narrow</h2>
      }
    }
  </header>
}
