class CustomHeader extends HTMLElement {
  connectedCallback() {
    const title = this.getAttribute("title");
    this.appendChild(<h1>{title}</h1>);
  }
}

customElements.define("custom-header", CustomHeader);
