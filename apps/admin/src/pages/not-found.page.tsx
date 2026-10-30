/** W7 not found: a plain sentence and the way back to the Overview. */
import { Button } from "@cashback/ui";
import { Link } from "@tanstack/react-router";

import { adminText } from "../labels";

export function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-start gap-3 px-4 py-16">
      <h1 className="text-[22px] leading-tight font-bold">{adminText("not_found_title")}</h1>
      <p className="text-[15px] text-muted-foreground">{adminText("not_found_body")}</p>
      <Button asChild className="h-11">
        <Link to="/">{adminText("not_found_action")}</Link>
      </Button>
    </div>
  );
}
