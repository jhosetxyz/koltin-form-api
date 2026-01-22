import { AgeBand } from "./age";

export type PaymentPlan = "monthly" | "annual";

const PRICE_TABLE: Record<
  Exclude<AgeBand, "out_of_range">,
  { monthly: number; annual: number }
> = {
  "50 - 54": { monthly: 899, annual: 899 * 12 * 0.9 },
  "55 - 59": { monthly: 999, annual: 999 * 12 * 0.9 },
  "60 - 64": { monthly: 1199, annual: 1199 * 12 * 0.9 },
  "65 - 69": { monthly: 1399, annual: 1399 * 12 * 0.9 },
  "70 - 74": { monthly: 1599, annual: 1599 * 12 * 0.9 },
  "75 - 79": { monthly: 1799, annual: 1799 * 12 * 0.9 },
  "80 - 84": { monthly: 1999, annual: 1999 * 12 * 0.9 },
};

export function getQuoteByBand(
  band: AgeBand,
  paymentPlan: PaymentPlan
): number | null {
  if (band === "out_of_range") return null;
  const pricing = PRICE_TABLE[band];
  return paymentPlan === "annual"
    ? Math.round(pricing.annual)
    : pricing.monthly;
}
