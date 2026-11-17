/*
 * jsdom 31 has HTMLDialogElement but neither showModal nor close. This stands in for the two methods the way the HTML spec defines the
 * parts a modal sheet relies on: showModal opens the dialog and moves focus to its first control, Escape fires `cancel` and then closes,
 * close fires `close`. It deliberately does NOT restore focus on close (a browser does, but a component must not depend on that: Safari
 * and a removed opener both break it), so a focus-return test checks the component's own code.
 */
export function installDialogPolyfill(): void {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const cancel = new Event("cancel", { cancelable: true });
      this.dispatchEvent(cancel);
      if (!cancel.defaultPrevented) this.close();
    };
    document.addEventListener("keydown", onKey);
    this.addEventListener(
      "close",
      () => {
        document.removeEventListener("keydown", onKey);
      },
      { once: true },
    );
    // React renders the sheet's content in the same event as the open, so focus moves once it is there.
    queueMicrotask(() => {
      this.querySelector<HTMLElement>("button, a[href]")?.focus();
    });
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
