import type { TerminalEvent } from "@t3tools/contracts";

export function terminalRunningSubprocessFromEvent(event: TerminalEvent): boolean {
  switch (event.type) {
    case "activity":
      return event.hasRunningSubprocess;
    case "started":
    case "restarted":
      return event.snapshot.status === "running";
    case "cleared":
    case "error":
    case "exited":
    case "output":
      return false;
  }
  return false;
}
