import { createRequire } from "node:module";
import PDFDocument from "pdfkit";
import type Stripe from "stripe";

// An Adplaylist-branded PDF of a Stripe invoice (the billing page's "PDF"
// link), laid out like the invoice design: seller, buyer and details side by
// side, a VAT column, and the seller's legal details in the footer. Stripe's
// own PDF stays available through the hosted invoice page.

const require = createRequire(import.meta.url);
const font = (weight: number) =>
  require.resolve(`@fontsource/archivo/files/archivo-latin-${weight}-normal.woff`);

const ACCENT = "#e8311a";
const INK = "#1a1a1a";
const MUTED = "#6b6b6b";
const LINE = "#dcdcdc";
const SOFT = "#f0f0f0";
const HEAD = "#e8e8e8";

// Who issues the invoice. Adplaylist is run by Venloa OY.
export const SELLER = {
  legalName: "Venloa OY",
  tradingName: "Adplaylist",
  street: "Säteritilankatu 2",
  city: "01520 Vantaa, Finland",
  businessId: "3020178-6",
  vatId: "FI30201786",
  email: "info@adplaylist.com",
  website: "adplaylist.com",
};

const PAGE_MARGIN = 48;

// What the invoice itself doesn't say: how it was paid, and the customer's
// current details for invoices issued before they added them.
export type InvoiceExtras = {
  // e.g. "Visa •••• 4242"
  paidWith?: string | null;
  customerName?: string | null;
  customerAddress?: Stripe.Address | null;
  customerVatId?: string | null;
};

function money(cents: number, currency: string) {
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(Math.abs(cents) / 100);
  return cents < 0 ? `−${formatted}` : formatted;
}

const short = (seconds: number, withYear = true) =>
  new Date(seconds * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });

function day(seconds: number | null | undefined) {
  return seconds ? short(seconds) : "—";
}

// "6 Oct – 3 Nov 2026", or with both years when they differ.
function period(start: number, end: number) {
  const sameYear = new Date(start * 1000).getFullYear() === new Date(end * 1000).getFullYear();
  return `${short(start, !sameYear)} – ${short(end)}`;
}

function countryName(code: string | null | undefined) {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function addressLines(address: Stripe.Address | null | undefined) {
  if (!address) return [];
  return [
    address.line1,
    address.line2,
    [address.postal_code, address.city].filter(Boolean).join(" "),
    address.state,
    countryName(address.country),
  ].filter((l): l is string => !!l);
}

function statusLabel(inv: Stripe.Invoice) {
  if (inv.status === "paid") return inv.amount_paid === 0 ? "NO CHARGE" : "PAID";
  if (inv.status === "open") return "DUE";
  if (inv.status === "void") return "VOID";
  if (inv.status === "uncollectible") return "FAILED";
  return (inv.status ?? "").toUpperCase();
}

// A tax rate as a percentage, from the tax charged on what it was charged on.
function ratePercent(taxes: { amount: number; taxable_amount: number | null }[] | null | undefined) {
  const tax = (taxes ?? []).reduce((s, t) => s + t.amount, 0);
  const base = (taxes ?? []).reduce((s, t) => s + (t.taxable_amount ?? 0), 0);
  if (!tax || !base) return 0;
  return Math.round((tax / base) * 1000) / 10;
}

const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

export function renderInvoicePdf(
  inv: Stripe.Invoice,
  extras: InvoiceExtras = {}
): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE_MARGIN,
    info: { Title: `Invoice ${inv.number ?? ""}`.trim(), Author: SELLER.tradingName },
  });
  doc.registerFont("regular", font(400));
  doc.registerFont("semibold", font(600));
  doc.registerFont("heavy", font(800));

  const left = PAGE_MARGIN;
  const right = doc.page.width - PAGE_MARGIN;
  const width = right - left;
  const currency = inv.currency;
  const paid = inv.status === "paid";
  const label = (text: string, x: number, y: number, opts: PDFKit.Mixins.TextOptions = {}) =>
    doc
      .font("semibold")
      .fontSize(8)
      .fillColor(MUTED)
      .text(text.toUpperCase(), x, y, { characterSpacing: 1.3, ...opts });

  // Header: wordmark on the left, document number and status on the right.
  doc.font("heavy").fontSize(28).fillColor(INK).text(SELLER.tradingName, left, PAGE_MARGIN);
  doc.rect(left, PAGE_MARGIN + 38, 32, 3).fill(ACCENT);
  doc
    .font("regular")
    .fontSize(9.5)
    .fillColor(MUTED)
    .text(`${SELLER.website} · ${SELLER.email}`, left, PAGE_MARGIN + 50);

  label("Invoice / Receipt", left, PAGE_MARGIN + 2, { width, align: "right" });
  doc
    .font("heavy")
    .fontSize(18)
    .fillColor(INK)
    .text(inv.number ?? inv.id ?? "", left, PAGE_MARGIN + 15, { width, align: "right" });
  const status = statusLabel(inv);
  doc.font("semibold").fontSize(8);
  const tagWidth = doc.widthOfString(status, { characterSpacing: 1.2 }) + 18;
  doc.rect(right - tagWidth, PAGE_MARGIN + 42, tagWidth, 17).fill(paid ? ACCENT : INK);
  doc
    .fillColor("#ffffff")
    .text(status, right - tagWidth, PAGE_MARGIN + 46.5, {
      width: tagWidth,
      align: "center",
      characterSpacing: 1.2,
    });

  // From / Billed to / Details.
  const top = PAGE_MARGIN + 104;
  const gap = 20;
  const col = (width - gap * 2) / 3;
  const fromX = left;
  const billedX = left + col + gap;
  const detailsX = left + 2 * (col + gap);

  label("From", fromX, top);
  doc
    .font("semibold")
    .fontSize(10)
    .fillColor(INK)
    .text(SELLER.legalName, fromX, top + 15, { width: col, continued: true })
    .font("regular")
    .text(` (${SELLER.tradingName})`);
  doc
    .font("regular")
    .fontSize(10)
    .fillColor(INK)
    .text(
      [SELLER.street, SELLER.city, `Business ID: ${SELLER.businessId}`, `VAT ID: ${SELLER.vatId}`].join("\n"),
      fromX,
      doc.y + 1,
      { width: col, lineGap: 1.5 }
    );
  const fromBottom = doc.y;

  label("Billed to", billedX, top);
  const vatIds = (inv.customer_tax_ids ?? []).map((t) => t.value).filter(Boolean);
  const vatId = vatIds[0] ?? extras.customerVatId ?? null;
  const address = inv.customer_address ?? extras.customerAddress ?? null;
  const name = inv.customer_name ?? extras.customerName ?? inv.customer_email ?? "—";
  doc.font("semibold").fontSize(10).fillColor(INK).text(name, billedX, top + 15, { width: col });
  const buyer = [
    inv.customer_email && inv.customer_email !== name ? inv.customer_email : null,
    ...addressLines(address),
    vatId ? `VAT ID: ${vatId}` : null,
  ].filter((l): l is string => !!l);
  doc
    .font("regular")
    .fontSize(10)
    .text(buyer.join("\n"), billedX, doc.y + 1, { width: col, lineGap: 1.5 });
  const billedBottom = doc.y;

  label("Details", detailsX, top);
  const line0 = inv.lines.data[0]?.period;
  const details: [string, string][] = [
    ["Issued", day(inv.status_transitions?.finalized_at ?? inv.created)],
    paid
      ? ["Paid on", day(inv.status_transitions?.paid_at)]
      : ["Due", day(inv.due_date ?? inv.created)],
    ...(line0 ? ([["Period", period(line0.start, line0.end)]] as [string, string][]) : []),
    ["Currency", currency.toUpperCase()],
    ...(extras.paidWith ? ([["Paid with", extras.paidWith]] as [string, string][]) : []),
  ];
  let dy = top + 15;
  for (const [k, v] of details) {
    doc.font("regular").fontSize(10).fillColor(MUTED).text(k, detailsX, dy, { width: 58 });
    doc.fillColor(INK).text(v, detailsX + 60, dy, { width: col - 60 });
    dy = doc.y + 2.5;
  }

  // Line items: description, qty, VAT rate, amount.
  let y = Math.max(fromBottom, billedBottom, dy) + 34;
  const qtyX = right - 205;
  const vatX = right - 145;
  const amountX = right - 90;
  const header = (at: number) => {
    doc.rect(left, at, width, 28).fill(HEAD);
    doc.font("semibold").fontSize(8).fillColor(MUTED);
    doc.text("DESCRIPTION", left + 12, at + 10.5, { characterSpacing: 1.3 });
    doc.text("QTY", qtyX, at + 10.5, { width: 50, align: "center", characterSpacing: 1.3 });
    doc.text("VAT", vatX, at + 10.5, { width: 45, align: "right", characterSpacing: 1.3 });
    doc.text("AMOUNT", amountX, at + 10.5, { width: 78, align: "right", characterSpacing: 1.3 });
  };
  header(y);
  y += 28;

  for (const line of inv.lines.data) {
    if (y > doc.page.height - 230) {
      doc.addPage();
      y = PAGE_MARGIN;
      header(y);
      y += 28;
    }
    const rowTop = y + 12;
    doc
      .font("regular")
      .fontSize(10)
      .fillColor(INK)
      .text(line.description ?? "Adplaylist subscription", left + 12, rowTop, {
        width: qtyX - left - 24,
        lineGap: 1.5,
      });
    const bottom = doc.y;
    doc.text(String(line.quantity ?? 1), qtyX, rowTop, { width: 50, align: "center" });
    doc.text(pct(ratePercent(line.taxes)), vatX, rowTop, { width: 45, align: "right" });
    doc.font("semibold").text(money(line.amount, currency), amountX, rowTop, {
      width: 78,
      align: "right",
    });
    y = Math.max(bottom, rowTop + 12) + 12;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.75).strokeColor(LINE).stroke();
  }

  // Totals, on the right.
  y += 18;
  const totalsW = 250;
  const totalsX = right - totalsW;
  const row = (k: string, v: string, strong = false) => {
    doc
      .font(strong ? "semibold" : "regular")
      .fontSize(10)
      .fillColor(strong ? INK : MUTED)
      .text(k, totalsX, y, { width: 150 });
    doc
      .font(strong ? "semibold" : "regular")
      .fillColor(INK)
      .text(v, totalsX + 150, y, { width: totalsW - 150, align: "right" });
    y += 19;
  };
  const tax = (inv.total_taxes ?? []).reduce((s, t) => s + t.amount, 0);
  const discount = (inv.total_discount_amounts ?? []).reduce((s, d) => s + d.amount, 0);
  row("Subtotal (excl. VAT)", money(inv.subtotal, currency));
  if (discount) row("Discount", money(-discount, currency));
  row(`VAT ${pct(ratePercent(inv.total_taxes))}`, money(tax, currency));
  row("Total", money(inv.total, currency), true);

  // The headline figure: what was paid, or what's still due.
  y += 8;
  doc.rect(totalsX, y, totalsW, 52).fill(SOFT);
  doc.rect(totalsX, y, 3.5, 52).fill(ACCENT);
  label(paid ? "Amount paid" : "Amount due", totalsX + 16, y + 21);
  doc
    .font("heavy")
    .fontSize(20)
    .fillColor(INK)
    .text(money(paid ? inv.amount_paid : inv.amount_due, currency), totalsX + 16, y + 15, {
      width: totalsW - 32,
      align: "right",
    });

  // Footer, inside the bottom margin (so pdfkit doesn't start a new page).
  doc.page.margins.bottom = 0;
  const footerY = doc.page.height - PAGE_MARGIN - 30;
  doc.moveTo(left, footerY).lineTo(right, footerY).lineWidth(0.75).strokeColor(LINE).stroke();
  doc
    .font("regular")
    .fontSize(8)
    .fillColor(MUTED)
    .text(
      `${SELLER.legalName} · Business ID ${SELLER.businessId} · VAT ID ${SELLER.vatId} · ${SELLER.street}, ${SELLER.city}`,
      left,
      footerY + 12,
      { width: width - 125, lineBreak: false }
    )
    .text(`Questions? ${SELLER.email}`, right - 120, footerY + 12, {
      width: 120,
      align: "right",
      lineBreak: false,
    });

  doc.end();
  return doc;
}
