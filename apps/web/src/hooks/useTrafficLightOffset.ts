import { useSidebar } from "~/components/ui/sidebar";
import { isElectron } from "~/env";
import { isMacPlatform } from "~/lib/utils";

/**
 * Returns `true` when the Electron header content needs a left margin to
 * avoid the macOS traffic-light (window-control) buttons.
 *
 * The offset is required whenever:
 * - We're running inside the Electron shell on macOS, AND
 * - The sidebar is not currently pushing the content area to the right
 *   (i.e. the sidebar is collapsed on desktop, or we're at mobile width
 *   where the sidebar renders as an overlay sheet).
 */
export function useTrafficLightOffset(): boolean {
  const { open, isMobile } = useSidebar();

  if (!isElectron || !isMacPlatform(navigator.platform)) {
    return false;
  }

  // On mobile the sidebar is a Sheet overlay — it never pushes content.
  // On desktop the sidebar only pushes content when it's open/expanded.
  return isMobile || !open;
}
