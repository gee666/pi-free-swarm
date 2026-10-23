// jsdom lacks the native dialog APIs; emulate their open/close and focus contract only.
export function installDialogFixture(): () => void {
  const prototype = HTMLDialogElement.prototype;
  const previous = new WeakMap<HTMLDialogElement, Element | null>();
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const patch = (name: string, value: (this: HTMLDialogElement) => void) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(prototype, name));
    Object.defineProperty(prototype, name, { configurable: true, writable: true, value });
  };
  patch("showModal", function () {
    previous.set(this, document.activeElement);
    this.setAttribute("open", "");
    this.querySelector<HTMLElement>("button, a[href], input, [tabindex]")?.focus();
  });
  patch("close", function () {
    if (!this.open) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
    const target = previous.get(this);
    if (target instanceof HTMLElement && target.isConnected) target.focus();
  });
  return () => {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(prototype, name, descriptor);
      else Reflect.deleteProperty(prototype, name);
    }
  };
}
