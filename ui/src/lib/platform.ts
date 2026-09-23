/** The modifier shown in keyboard hints: "⌘" on Apple devices, "Ctrl" elsewhere. */
export function sendModifierLabel(): string {
  return /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";
}
