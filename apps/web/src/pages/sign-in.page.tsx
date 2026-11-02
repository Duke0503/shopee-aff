/**
 * W2 sign-in (Story 7.2). Phone and tablet: the mascot beside the title, then the form in one
 * card. Desktop: the mascot and the title on the left, the form card on the right, so the wide
 * screen is composed, not a stretched phone. A session ended by a new password is said by the
 * shell on every page (session-ended-notice.tsx, AC5).
 */
import { useState } from "react";

import { webText } from "../labels";
import { PageTitle } from "../shell/page-title";
import { SignInForm, type Mascot } from "./sign-in-form";

/** The mascot set (cashback-design-craft brand assets), scaled to 360 px tall for these sizes. */
const MASCOT = (name: Mascot): string => `/mascot-${name}-360.webp`;

export function SignInPage() {
  const [mascot, setMascot] = useState<Mascot>("shy");
  return (
    <div className="mx-auto w-full max-w-[440px] px-4 pt-6 md:px-0 md:pt-12 xl:grid xl:max-w-[920px] xl:grid-cols-[1fr_420px] xl:items-center xl:gap-16 xl:pt-20">
      <div className="flex items-center gap-4 xl:flex-col xl:items-start xl:gap-6">
        <img src={MASCOT(mascot)} alt="" width={238} height={360} data-mascot={mascot} className="h-16 w-auto shrink-0 object-contain md:h-20 xl:h-44" />
        <PageTitle lead={webText("sign_in_lead")}>{webText("sign_in_title")}</PageTitle>
      </div>
      <div className="mt-6 xl:mt-0">
        <div className="rounded-xl border border-border bg-card p-5 md:p-6">
          <SignInForm onMascot={setMascot} />
        </div>
      </div>
    </div>
  );
}
