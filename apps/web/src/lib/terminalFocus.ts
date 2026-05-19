function isTerminalFocusElement(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  if (element.classList.contains("xterm-helper-textarea")) return true;
  return element.closest(".thread-terminal-drawer .xterm") !== null;
}

function elementFromEventTarget(target: EventTarget | null | undefined): HTMLElement | null {
  if (target instanceof HTMLElement) return target;
  if (
    typeof Node !== "undefined" &&
    target instanceof Node &&
    target.parentElement instanceof HTMLElement
  ) {
    return target.parentElement;
  }
  return null;
}

export function isTerminalFocused(target?: EventTarget | null): boolean {
  const targetElement = elementFromEventTarget(target);
  if (targetElement && isTerminalFocusElement(targetElement)) return true;

  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return false;
  return isTerminalFocusElement(activeElement);
}
