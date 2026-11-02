/**
 * One order in full (W2, Story 7.4, pen.dev opJFP): signed in only, opened from a line of My money
 * (`/don-hang?ma=<orderId>`). The way back to the list on top, then the order. An order that is not
 * the customer's (or does not exist) is said as such with the missing-order page as the next step,
 * never as an error; any other failure says so with a retry. One 640 px column at every width.
 */
import { CUSTOMER_PATHS } from "@cashback/contracts";
import { Button, RefreshCwIcon, Skeleton, cn } from "@cashback/ui";
import { Link } from "@tanstack/react-router";

import { ApiError } from "../api/api.queries";
import { webText } from "../labels";
import { OrderDetail } from "../money/order-detail";
import { useMyOrder } from "../money/money.queries";
import { FOCUS_RING } from "../shell/nav-items";
import { ArrowLeftIcon } from "../shell/page-icons";
import { useDocumentTitle } from "../shell/use-document-title";
import { SignedIn } from "./signed-in";

const BACK = cn("-ml-1 inline-flex h-11 items-center gap-2 self-start rounded-md px-1 text-[15px] font-medium hover:bg-muted", FOCUS_RING);

function Missing() {
  return (
    <div data-order-missing className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4">
      <h1 className="text-xl font-semibold">{webText("order_detail_missing_title")}</h1>
      <p className="text-[15px] text-muted-foreground">{webText("order_detail_missing_body")}</p>
      <Link to={CUSTOMER_PATHS.missingOrder} className={cn("inline-flex h-11 items-center rounded-md text-[15px] font-medium text-primary hover:underline", FOCUS_RING)}>
        {webText("orders_missing_link")}
      </Link>
    </div>
  );
}

function Order({ orderId }: { readonly orderId: string }) {
  const order = useMyOrder(orderId);
  if (order.data !== undefined) return <OrderDetail order={order.data} />;
  if (orderId === "" || (order.error instanceof ApiError && order.error.status === 404)) return <Missing />;
  if (order.isPending) {
    return (
      <div aria-busy="true" aria-label={webText("loading")} className="flex flex-col gap-4">
        <Skeleton className="h-[72px] w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4">
      <p className="text-[15px]">{webText("order_detail_error")}</p>
      <Button type="button" variant="outline" className="h-11 px-4 text-[15px]" disabled={order.isFetching} onClick={() => void order.refetch()}>
        <RefreshCwIcon aria-hidden />
        {webText("retry")}
      </Button>
    </div>
  );
}

export function OrderDetailPage({ orderId }: { readonly orderId: string }) {
  useDocumentTitle(webText("order_detail_title"));
  return (
    <SignedIn>
      {() => (
        <div className="mx-auto flex max-w-[640px] flex-col gap-4 px-4 pt-4 md:px-6 md:pt-8">
          <Link to={CUSTOMER_PATHS.myMoney} className={BACK}>
            <ArrowLeftIcon aria-hidden className="size-5" />
            {webText("order_detail_back")}
          </Link>
          <Order orderId={orderId} />
        </div>
      )}
    </SignedIn>
  );
}
