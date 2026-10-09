import type Stripe from "stripe";

// The Stripe tax ID type for a business VAT (or similar) number in each
// country we can store one for. EU countries share eu_vat, which Stripe
// checks against VIES. Elsewhere the number is kept on the customer's
// metadata instead, so it still prints on the invoice.
const EU = [
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU",
  "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
];

const OTHER: Record<string, Stripe.TaxIdCreateParams.Type> = {
  GB: "gb_vat",
  CH: "ch_vat",
  NO: "no_vat",
  IS: "is_vat",
  AU: "au_abn",
  NZ: "nz_gst",
  CA: "ca_bn",
  US: "us_ein",
  IN: "in_gst",
  ZA: "za_vat",
  AE: "ae_trn",
  SG: "sg_gst",
  NP: "np_pan",
};

export function taxIdTypeFor(country: string): Stripe.TaxIdCreateParams.Type | null {
  if (EU.includes(country)) return "eu_vat";
  return OTHER[country] ?? null;
}
