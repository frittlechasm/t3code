export const WINDOW_CLOSE_REQUEST_EVENT = "t3code:window-close-request";

export function requestWindowClose(): boolean {
  return window.dispatchEvent(new Event(WINDOW_CLOSE_REQUEST_EVENT, { cancelable: true }));
}
