/**
 * W2 sign-in (Story 7.2, pen.dev m1XQ8 phone, N9g57 error and ulWqr desktop): one centred 420 px column
 * at every width, the mascot over the title and its lead, then the form on the page itself, no
 * card. A session ended by a new password is said by the
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
    <div className="mx-auto flex w-full max-w-[420px] flex-col gap-6 px-4 pt-6 md:px-0 md:pt-12 xl:pt-14">
      <div className="flex flex-col items-center gap-3 text-center">
        <img src={MASCOT(mascot)} alt="" width={238} height={360} data-mascot={mascot} className="h-[116px] w-auto object-contain md:h-[140px]" />
        <PageTitle lead={webText("sign_in_lead")} className="items-center [&_p]:text-[15px] [&_p]:md:text-base">
          {webText("sign_in_title")}
        </PageTitle>
      </div>
      <SignInForm onMascot={setMascot} />
    </div>
  );
}
