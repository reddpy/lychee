import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { AppSidebar } from "../components/app-sidebar";
import { CollapsedSidebarWidget } from "../components/collapsed-sidebar-widget";
import { ErrorBoundary } from "../components/error-boundary";
import { HamburgerMenu } from "../components/hamburger-menu";
import { LexicalEditor } from "../components/lexical-editor";
import { SettingsDialog } from "../components/settings/settings-dialog";
import { LycheeLogoHorizontal } from "../components/sidebar/lychee-logo";
import { TabStrip } from "../components/tab-strip";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "../components/ui/sidebar";
import { useDocumentStore } from "../renderer/document-store";
import { useSettingsStore } from "../renderer/settings-store";
import type { SidebarPreferences } from "../renderer/sidebar-preferences";

// Pulls inset-centered content left by half the sidebar width to land at the
// viewport center, clamped so the ~320px horizontal logo never crosses the
// sidebar boundary as the window narrows.
const EMPTY_STATE_OFFSET_TRANSFORM =
  "translateX(max(calc((100vw - var(--sidebar-width) - 320px) / -2), calc(var(--sidebar-width) / -2)))";

const IS_MAC = window.lychee.platform === "darwin";

// Width to reserve at the right edge of the title bar so tabs/controls don't
// slide under the OS-painted min/max/close overlay (Win/Linux). Returns 0 on
// macOS or when the overlay isn't visible (fullscreen, unsupported platforms).
type WindowControlsOverlay = {
  visible: boolean;
  getTitlebarAreaRect: () => DOMRect;
  addEventListener: (type: "geometrychange", listener: () => void) => void;
  removeEventListener: (type: "geometrychange", listener: () => void) => void;
};

function useWindowControlsOverlayInset(): number {
  const [inset, setInset] = React.useState(0);
  React.useEffect(() => {
    const wco = (
      navigator as Navigator & {
        windowControlsOverlay?: WindowControlsOverlay;
      }
    ).windowControlsOverlay;
    if (!wco) return;
    const update = () => {
      if (!wco.visible) {
        setInset(0);
        return;
      }
      const rect = wco.getTitlebarAreaRect();
      setInset(Math.max(0, window.innerWidth - rect.right));
    };
    update();
    wco.addEventListener("geometrychange", update);
    window.addEventListener("resize", update);
    return () => {
      wco.removeEventListener("geometrychange", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return inset;
}

/** Unified top bar: left section aligns with sidebar, right section holds tabs. */
function TopBar() {
  const { open: sidebarOpen } = useSidebar();
  const openTabs = useDocumentStore((s) => s.openTabs);
  const selectedId = useDocumentStore((s) => s.selectedId);
  const selectDocument = useDocumentStore((s) => s.selectDocument);
  const hasTabs = openTabs.length > 0;

  const activeIndex =
    selectedId != null ? openTabs.findIndex((t) => t.tabId === selectedId) : -1;
  const canGoLeft = activeIndex > 0;
  const canGoRight = activeIndex >= 0 && activeIndex < openTabs.length - 1;

  const handlePrevTab = React.useCallback(() => {
    if (!canGoLeft) return;
    const prevTab = openTabs[activeIndex - 1];
    if (prevTab) selectDocument(prevTab.tabId);
  }, [canGoLeft, activeIndex, openTabs, selectDocument]);

  const handleNextTab = React.useCallback(() => {
    if (!canGoRight) return;
    const nextTab = openTabs[activeIndex + 1];
    if (nextTab) selectDocument(nextTab.tabId);
  }, [canGoRight, activeIndex, openTabs, selectDocument]);

  const overlayInset = useWindowControlsOverlayInset();

  // Hide the WCO divider when the rightmost tab is active so the divider
  // doesn't visually crash into the active tab's edge — mirrors how
  // inactive-tab dividers hide next to the active tab.
  const lastTabActive =
    openTabs.length > 0 && selectedId === openTabs[openTabs.length - 1].tabId;

  return (
    <div className="titlebar-drag relative flex h-10 w-full shrink-0 bg-[hsl(var(--sidebar-background))]">
      {/* Left section — matches sidebar width when open, shrinks when collapsed */}
      <div
        className={`relative z-20 flex shrink-0 items-center overflow-hidden border-r border-r-[hsl(var(--border))] transition-[width] duration-200 ease-out ${sidebarOpen ? "w-[var(--sidebar-width)]" : "w-[184px]"}`}
      >
        {IS_MAC ? (
          /* Traffic lights space — Mac only */
          <div className="w-19 shrink-0" />
        ) : (
          /* Hamburger menu replaces the native menu bar on Win/Linux */
          <div className="flex shrink-0 items-center px-2 translate-y-0.5">
            <HamburgerMenu />
          </div>
        )}
        {/* Sidebar toggle */}
        <div className="titlebar-nodrag flex shrink-0 items-center px-1 translate-y-0.5">
          <SidebarTrigger className="h-7 w-7 rounded-md border border-transparent text-[hsl(var(--muted-foreground))] hover:bg-brand/15 hover:border-brand/30 hover:text-brand transition-all" />
        </div>
        {/* Spacer pushes chevrons to the right edge */}
        <div className="flex-1" />
        {/* Tab nav chevrons */}
        <div className="titlebar-nodrag flex shrink-0 items-center gap-0.5 px-1.5 translate-y-0.5">
          <button
            type="button"
            onClick={handlePrevTab}
            disabled={!canGoLeft}
            aria-label="Previous tab"
            className={
              "flex h-6 w-6 items-center justify-center rounded-sm text-[hsl(var(--muted-foreground))] transition-colors " +
              (canGoLeft ? "hover:bg-brand/15 hover:text-brand" : "opacity-30")
            }
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleNextTab}
            disabled={!canGoRight}
            aria-label="Next tab"
            className={
              "flex h-6 w-6 items-center justify-center rounded-sm text-[hsl(var(--muted-foreground))] transition-colors " +
              (canGoRight ? "hover:bg-brand/15 hover:text-brand" : "opacity-30")
            }
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tab strip fills remaining space */}
      <div className="relative flex min-w-0 flex-1 items-stretch bg-[hsl(var(--sidebar-background))]">
        {hasTabs ? <TabStrip /> : null}
      </div>
      {/* Reserved gutter for OS-painted window controls overlay (Win/Linux).
          A short, vertically-centered divider sits just left of the gutter so
          tabs never visually touch the min/max/close buttons — matches the
          inactive-tab divider style so it doesn't crash into the content area. */}
      {overlayInset > 0 ? (
        <>
          <div className="shrink-0 relative w-px" aria-hidden>
            {!lastTabActive && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-px bg-[hsl(var(--border))]" />
            )}
          </div>
          <div
            className="shrink-0"
            style={{ width: overlayInset }}
            aria-hidden
          />
        </>
      ) : null}
      {/* Bottom border — last child so it paints above inactive tabs; active tab z-10 breaks through */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-foreground/8" />
    </div>
  );
}

function EditorArea() {
  const { open: sidebarOpen } = useSidebar();
  const selectedId = useDocumentStore((s) => s.selectedId);
  const openTabs = useDocumentStore((s) => s.openTabs);
  const documents = useDocumentStore((s) => s.documents);

  const docById = React.useMemo(() => {
    const map = new Map<string, (typeof documents)[number]>();
    for (const d of documents) map.set(d.id, d);
    return map;
  }, [documents]);

  // Stable docId render order, independent of openTabs order.
  //
  // Why: each docId renders one persistent <main> sharing a parent. Re-ordering
  // these via React's keyed reconciler calls insertBefore on whichever <main>
  // it picks to move (smaller-old-index that lands later in the new order),
  // which resets that element's scrollTop in Chromium. Keeping render order
  // stable across openTabs reorders avoids the DOM move entirely.
  const renderOrderRef = React.useRef<string[]>([]);
  const uniqueDocIds = React.useMemo(() => {
    const present = new Set<string>();
    for (const { docId } of openTabs) present.add(docId);
    const next = renderOrderRef.current.filter((id) => present.has(id));
    const inNext = new Set(next);
    for (const { docId } of openTabs) {
      if (!inNext.has(docId)) {
        next.push(docId);
        inNext.add(docId);
      }
    }
    return next;
  }, [openTabs]);
  renderOrderRef.current = uniqueDocIds;

  const activeDocId = React.useMemo(
    () => openTabs.find((t) => t.tabId === selectedId)?.docId ?? null,
    [openTabs, selectedId],
  );

  if (activeDocId == null) {
    return (
      <main
        data-testid="empty-state"
        className="flex h-full flex-1 items-start justify-center bg-[hsl(var(--background))] pt-[30vh]"
      >
        <div
          className="flex flex-col items-center gap-6 select-none"
          style={
            sidebarOpen
              ? { transform: EMPTY_STATE_OFFSET_TRANSFORM }
              : undefined
          }
        >
          <LycheeLogoHorizontal className="h-20 opacity-15" />
        </div>
      </main>
    );
  }

  return (
    <>
      {uniqueDocIds.map((docId) => {
        const doc = docById.get(docId);
        if (!doc) return null;
        return (
          <LexicalEditor
            key={docId}
            documentId={doc.id}
            document={doc}
            hidden={docId !== activeDocId}
            activeTabId={docId === activeDocId ? selectedId : null}
          />
        );
      })}
    </>
  );
}

function useMenuEventSubscriptions() {
  React.useEffect(() => {
    const offNewNote = window.lychee.on("menu:new-note", () => {
      void useDocumentStore.getState().createDocument(null);
    });
    const offOpenSettings = window.lychee.on("menu:open-settings", () => {
      useSettingsStore.getState().openSettings();
    });
    const offCloseTab = window.lychee.on("menu:close-tab", () => {
      const { selectedId, closeTab } = useDocumentStore.getState();
      if (selectedId) closeTab(selectedId);
    });
    const offReopenClosedTab = window.lychee.on(
      "menu:reopen-closed-tab",
      () => {
        useDocumentStore.getState().reopenLastClosedTab();
      },
    );
    return () => {
      offNewNote();
      offOpenSettings();
      offCloseTab();
      offReopenClosedTab();
    };
  }, []);
}

// E2E-only crash injector. Loaded via require() inside the build-flag guard so
// webpack drops both the call and the entire module from production bundles
// (zero trace — no probe code or strings ship). See src/types/globals.d.ts and
// src/components/e2e-crash-probe.tsx.
function e2eCrashProbe(scope: string): React.ReactElement | null {
  if (!__LYCHEE_E2E__) return null;
  const { E2ECrashProbe } =
    require("../components/e2e-crash-probe") as typeof import("../components/e2e-crash-probe");
  return <E2ECrashProbe scope={scope} />;
}

export function App({
  initialSidebarPreferences,
}: {
  initialSidebarPreferences?: SidebarPreferences;
}) {
  useMenuEventSubscriptions();
  // Reset the editor boundary when the active tab changes, so a crash isolated
  // to one document recovers as soon as the user navigates away from it,
  // instead of staying stuck on the fallback until a full reload.
  const selectedId = useDocumentStore((s) => s.selectedId);
  return (
    <SidebarProvider
      defaultOpen={initialSidebarPreferences?.open ?? true}
      defaultWidth={initialSidebarPreferences?.width}
    >
      {e2eCrashProbe("app")}
      <div className="flex h-full w-full flex-col">
        <TopBar />
        <div className="relative flex min-h-0 flex-1">
          <AppSidebar />
          <SidebarInset>
            <div className="relative flex min-h-0 flex-1 flex-col">
              <ErrorBoundary scope="editor" resetKeys={[selectedId]}>
                {e2eCrashProbe("editor")}
                <EditorArea />
              </ErrorBoundary>
            </div>
          </SidebarInset>
          <CollapsedSidebarWidget />
        </div>
      </div>
      <SettingsDialog />
    </SidebarProvider>
  );
}
