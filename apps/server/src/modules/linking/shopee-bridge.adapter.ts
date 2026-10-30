/**
 * The Shopee report source of production reconciliation (AD-14, D8, Story 5.9): report pages read
 * by the affiliate browser through `bridge_jobs`, page 1 per call, yielding to link jobs between
 * pages, never a direct call to Shopee. It sits behind the same `WindowedReportSource` the hourly
 * run and the nightly sweep use, so Story 5.9 replaces only this file.
 *
 * TODO(Story 5.9): enqueue report-page bridge jobs for the window, wait on the server for their
 * results, refuse a page cap or a captcha page with `report_page_cap` / `report_fetch_failed`, and
 * hand back every row or none. Until then a read fails with `report_source_unavailable`, so a run
 * wired to it records a FAILED run and changes nothing.
 */
import { ReportSourceError, type WindowedReportSource } from "./report-source.port";

export function shopeeBridgeSource(): WindowedReportSource {
  return {
    network: "shopee",
    read: () => Promise.reject(new ReportSourceError("report_source_unavailable", "the Shopee browser bridge report source arrives with Story 5.9")),
  };
}
