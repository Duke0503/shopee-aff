/**
 * The website shell (Story 7.1, W0, W7): top bar, then the Zalo-down banner, the offline strip and
 * the "session ended by a new password" notice when they apply, the page, and the phone bottom tabs. Each navigation asks the server again
 * whether the assistant is down, so the banner follows its answer from page to page (AC1, AC2).
 * The page column leaves room for the fixed tabs and the safe area on phone.
 */
import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { Suspense, useEffect } from "react";

import { webText } from "../labels";

import { SITE_STATUS_KEY } from "../site/site-status.queries";
import { BottomTabs } from "./bottom-tabs";
import { OfflineStrip } from "./offline-strip";
import { SessionEndedNotice } from "./session-ended-notice";
import { TopBar } from "./top-bar";
import { ZaloDownBanner } from "./zalo-down-banner";

export function SiteShell() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const client = useQueryClient();
  useEffect(() => {
    void client.invalidateQueries({ queryKey: SITE_STATUS_KEY });
  }, [client, path]);
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <TopBar />
      <ZaloDownBanner />
      <OfflineStrip />
      <SessionEndedNotice />
      <main className="flex-1 pb-[calc(88px+env(safe-area-inset-bottom))] md:pb-16">
        <Suspense fallback={<div aria-busy="true" aria-label={webText("loading")} className="mx-auto h-40 max-w-[640px]" />}>
          <Outlet />
        </Suspense>
      </main>
      <BottomTabs />
    </div>
  );
}
