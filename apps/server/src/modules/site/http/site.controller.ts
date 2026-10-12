import { Controller, Get, Inject } from "@nestjs/common";

import { MESSAGES, type Messages } from "../../../notifications";
import { siteFigures } from "../application/site-figures.use-case";
import { labelsPath, loadLabels } from "../infrastructure/labels.repository";

const cashbackRate = (): number => Number(process.env.CASHBACK_RATE ?? 0.8);
const taxPolicy = (): string => (process.env.TAX_POLICY ?? "owner_absorbs").trim().toLowerCase();

/**
 * Website text and settings, public and unauthenticated: the labels every
 * screen renders, and the figures the landing page quotes. Both are read live.
 */
@Controller("api")
export class SiteController {
  constructor(@Inject(MESSAGES) private readonly messages: Messages) {}

  @Get("labels")
  labels() {
    return loadLabels(labelsPath());
  }

  @Get("site")
  site() {
    return siteFigures(this.messages, { cashbackRate: cashbackRate(), taxPolicy: taxPolicy() });
  }
}
