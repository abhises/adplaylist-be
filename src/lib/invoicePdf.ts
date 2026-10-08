import { createRequire } from "node:module";
import PDFDocument from "pdfkit";
import type Stripe from "stripe";

// An Adplaylist-branded PDF of a Stripe invoice, in the site's colours and
// typeface (Archivo), for the billing page's "PDF" link. Stripe's own PDF
// stays available through the hosted invoice page.

const require = createRequire(import.meta.url);
const font = (weight: number) =>
  require.resolve(`@fontsource/archivo/files/archivo-latin-${weight}-normal.woff`);

// The site's theme (adplaylist-fe/src/app/globals.css, light).
const BRAND = "#ec3013";
const INK = "#201e1d";
const MUTED = "#7d7979";
const SURFACE = "#f3f2f2";
const SURFACE_2 = "#eae9e9";
const RULE = "#d9d7d6";

const PAGE_MARGIN = 48;

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function day(seconds: number | null | undefined) {
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function statusLabel(inv: Stripe.Invoice) {
  if (inv.status === "paid") return inv.amount_paid === 0 ? "NO CHARGE" : "PAID";
  if (inv.status === "open") return "DUE";
  if (inv.status === "void") return "VOID";
  if (inv.status === "uncollectible") return "FAILED";
  return (inv.status ?? "").toUpperCase();
}

function addressLines(address: Stripe.Address | null | undefined) {
  if (!address) return [];
  return [
    address.line1,
    address.line2,
    [address.postal_code, address.city].filter(Boolean).join(" "),
    [address.state, address.country].filter(Boolean).join(", "),
  ].filter((l): l is string => !!l);
}

export function renderInvoicePdf(
  inv: Stripe.Invoice,
  opts: { companyName?: string | null; site: string }
): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE_MARGIN,
    info: {
      Title: `Adplaylist invoice ${inv.number ?? ""}`.trim(),
      Author: "Adplaylist",
    },
  });
  doc.registerFont("regular", font(400));
  doc.registerFont("semibold", font(600));
  doc.registerFont("heavy", font(800));

  const left = PAGE_MARGIN;
  const right = doc.page.width - PAGE_MARGIN;
  const width = right - left;
  const currency = inv.currency;
  const paid = inv.status === "paid";

  // Brand bar across the top.
  doc.rect(0, 0, doc.page.width, 8).fill(BRAND);

  // Wordmark, then the document kind and number on the right.
  doc.font("heavy").fontSize(26).fillColor(INK).text("Adplaylist", left, 44);
  doc.rect(left, 78, 28, 3).fill(BRAND);
  doc
    .font("regular")
    .fontSize(9)
    .fillColor(MUTED)
    .text(opts.site.replace(/^https?:\/\//, ""), left, 88);

  doc
    .font("semibold")
    .fontSize(9)
    .fillColor(MUTED)
    .text(paid ? "RECEIPT" : "INVOICE", left, 46, { width, align: "right", characterSpacing: 1.5 });
  doc
    .font("heavy")
    .fontSize(16)
    .fillColor(INK)
    .text(inv.number ?? inv.id ?? "", left, 60, { width, align: "right" });

  // Status tag.
  const status = statusLabel(inv);
  doc.font("semibold").fontSize(8);
  const tagWidth = doc.widthOfString(status, { characterSpacing: 1 }) + 16;
  const tagColor = paid ? BRAND : INK;
  doc.rect(right - tagWidth, 84, tagWidth, 16).fill(tagColor);
  doc
    .fillColor("#ffffff")
    .text(status, right - tagWidth, 88.5, { width: tagWidth, align: "center", characterSpacing: 1 });

  // Billed to / details, side by side.
  let y = 136;
  const colWidth = (width - 24) / 2;
  const label = (text: string, x: number, at: number) =>
    doc
      .font("semibold")
      .fontSize(8)
      .fillColor(MUTED)
      .text(text, x, at, { characterSpacing: 1.2 });

  label("BILLED TO", left, y);
  const billedTo = [
    opts.companyName,
    inv.customer_name,
    inv.customer_email,
    ...addressLines(inv.customer_address),
  ].filter((l, i, all): l is string => !!l && all.indexOf(l) === i);
  doc.font("semibold").fontSize(11).fillColor(INK).text(billedTo[0] ?? "—", left, y + 14, {
    width: colWidth,
  });
  doc
    .font("regular")
    .fontSize(10)
    .fillColor(INK)
    .text(billedTo.slice(1).join("\n"), left, doc.y + 2, { width: colWidth, lineGap: 2 });
  const billedBottom = doc.y;

  const detailsX = left + colWidth + 24;
  label("DETAILS", detailsX, y);
  const period = inv.lines.data[0]?.period;
  const details: [string, string][] = [
    ["Issued", day(inv.created)],
    paid
      ? ["Paid on", day(inv.status_transitions?.paid_at)]
      : ["Due", day(inv.due_date ?? inv.created)],
    ...(period ? ([["Period", `${day(period.start)} – ${day(period.end)}`]] as [string, string][]) : []),
    ["From", inv.account_name ?? "Adplaylist"],
  ];
  let dy = y + 14;
  for (const [k, v] of details) {
    doc.font("regular").fontSize(10).fillColor(MUTED).text(k, detailsX, dy, { width: 70 });
    doc.fillColor(INK).text(v, detailsX + 70, dy, { width: colWidth - 70 });
    dy = doc.y + 3;
  }
  y = Math.max(billedBottom, dy) + 28;

  // Line items.
  const qtyX = right - 170;
  const amountX = right - 100;
  doc.rect(left, y, width, 24).fill(SURFACE_2);
  doc.font("semibold").fontSize(8).fillColor(MUTED);
  doc.text("DESCRIPTION", left + 10, y + 8.5, { characterSpacing: 1.2 });
  doc.text("QTY", qtyX, y + 8.5, { width: 50, align: "right", characterSpacing: 1.2 });
  doc.text("AMOUNT", amountX, y + 8.5, { width: 90, align: "right", characterSpacing: 1.2 });
  y += 24;

  for (const line of inv.lines.data) {
    if (y > doc.page.height - 200) {
      doc.addPage();
      y = PAGE_MARGIN;
    }
    const top = y + 10;
    doc
      .font("regular")
      .fontSize(10)
      .fillColor(INK)
      .text(line.description ?? "Adplaylist subscription", left + 10, top, {
        width: qtyX - left - 30,
        lineGap: 2,
      });
    const bottom = doc.y;
    doc.text(String(line.quantity ?? 1), qtyX, top, { width: 50, align: "right" });
    doc
      .font("semibold")
      .text(money(line.amount, currency), amountX, top, { width: 90, align: "right" });
    y = Math.max(bottom, top + 12) + 10;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.75).strokeColor(RULE).stroke();
  }

  // Totals, right-aligned.
  y += 16;
  const totalsX = right - 230;
  const row = (k: string, v: string, bold = false) => {
    doc
      .font(bold ? "semibold" : "regular")
      .fontSize(10)
      .fillColor(bold ? INK : MUTED)
      .text(k, totalsX, y, { width: 120 });
    doc.fillColor(INK).text(v, totalsX + 120, y, { width: 110, align: "right" });
    y += 18;
  };
  row("Subtotal", money(inv.subtotal, currency));
  const discount = (inv.total_discount_amounts ?? []).reduce((s, d) => s + d.amount, 0);
  if (discount) row("Discount", `−${money(discount, currency)}`);
  const tax = (inv.total_taxes ?? []).reduce((s, t) => s + t.amount, 0);
  if (tax) row("Tax", money(tax, currency));
  row("Total", money(inv.total, currency), true);

  // The headline figure: what was paid, or what's still due.
  y += 6;
  const headline = paid ? "Amount paid" : "Amount due";
  const figure = money(paid ? inv.amount_paid : inv.amount_due, currency);
  doc.rect(totalsX, y, 230, 46).fill(SURFACE);
  doc.rect(totalsX, y, 3, 46).fill(BRAND);
  doc
    .font("semibold")
    .fontSize(8)
    .fillColor(MUTED)
    .text(headline.toUpperCase(), totalsX + 14, y + 10, { characterSpacing: 1.2 });
  doc
    .font("heavy")
    .fontSize(18)
    .fillColor(INK)
    .text(figure, totalsX + 14, y + 13, { width: 230 - 28, align: "right" });

  // Footer, inside the bottom margin (so pdfkit doesn't start a new page).
  doc.page.margins.bottom = 0;
  const footerY = doc.page.height - PAGE_MARGIN - 34;
  doc.moveTo(left, footerY).lineTo(right, footerY).lineWidth(0.75).strokeColor(RULE).stroke();
  doc
    .font("semibold")
    .fontSize(10)
    .fillColor(INK)
    .text("Thank you for creating with Adplaylist.", left, footerY + 12, { width, lineBreak: false });
  doc
    .font("regular")
    .fontSize(8.5)
    .fillColor(MUTED)
    .text(
      `Questions about this ${paid ? "receipt" : "invoice"}? Reply to your billing email or visit ${opts.site.replace(/^https?:\/\//, "")}.`,
      left,
      footerY + 26,
      { width, lineBreak: false }
    );
  doc.rect(0, doc.page.height - 8, doc.page.width, 8).fill(BRAND);

  doc.end();
  return doc;
}
