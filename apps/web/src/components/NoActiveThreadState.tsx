import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { SidebarInset, SidebarTrigger, useSidebar } from "./ui/sidebar";
import { isElectron } from "../env";
import { cn, isMacPlatform } from "~/lib/utils";

export function NoActiveThreadState() {
  const { isMobile, open, openMobile } = useSidebar();
  const showCollapsedSidebarTrigger = isMobile ? isElectron && !openMobile : !open;
  const showFloatingSidebarTrigger = showCollapsedSidebarTrigger && !isElectron;
  const shouldOffsetForMacWindowControls = isElectron && isMacPlatform(navigator.platform);
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        {showFloatingSidebarTrigger ? (
          <SidebarTrigger className="absolute top-3 left-3 z-10 bg-background/90 shadow-xs backdrop-blur-xs" />
        ) : null}
        <header
          className={cn(
            "border-b border-border px-3 sm:px-5",
            isElectron
              ? "drag-region flex h-[52px] items-center gap-2 wco:h-[env(titlebar-area-height)]"
              : "py-2 sm:py-3",
          )}
        >
          {isElectron ? (
            <>
              {showCollapsedSidebarTrigger ? (
                <SidebarTrigger className="size-7 shrink-0" />
              ) : null}
              <div
                className={cn(
                  "min-w-0",
                  shouldOffsetForMacWindowControls && !showCollapsedSidebarTrigger && "ml-[55px] md:ml-0",
                )}
              >
                <span className="text-xs text-muted-foreground/50 wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]">
                  No active thread
                </span>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-7 shrink-0 md:hidden" />
              <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
                No active thread
              </span>
            </div>
          )}
        </header>

        <Empty className="flex-1">
          <div className="w-full max-w-lg rounded-3xl border border-border/55 bg-card/20 px-8 py-12 shadow-sm/5">
            <EmptyHeader className="max-w-none">
              <EmptyTitle className="text-foreground text-xl">Pick a thread to continue</EmptyTitle>
              <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
                Select an existing thread or create a new one to get started.
              </EmptyDescription>
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}
