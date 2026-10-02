import nodemailer, { type Transporter } from "nodemailer";

// Outgoing mail through the info@adplaylist.com mailbox (Namecheap Private
// Email: mail.privateemail.com, port 465 over SSL). Settings come from the
// environment only (SMTP_* and MAIL_FROM in .env); nothing here is secret.

let transporter: Transporter | null = null;

export function mailConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (!mailConfigured()) {
    throw new MailError("Email isn't set up on the server (SMTP settings are missing).");
  }
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 465);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

export class MailError extends Error {}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Plain text is the real message; the HTML part only keeps its line breaks.
function toHtml(text: string) {
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#201e1d">${escapeHtml(
    text
  ).replace(/\n/g, "<br>")}</div>`;
}

export async function sendMail({
  to,
  subject,
  text,
  replyTo,
  bccSelf = false,
}: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  // Also deliver a copy to the sending mailbox, so the conversation is in
  // its inbox too (SMTP doesn't file a "Sent" copy by itself).
  bccSelf?: boolean;
}) {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER!;
  try {
    await getTransporter().sendMail({
      from,
      to,
      subject,
      text,
      html: toHtml(text),
      replyTo,
      bcc: bccSelf ? process.env.SMTP_USER : undefined,
    });
  } catch (err) {
    if (err instanceof MailError) throw err;
    const e = err as { code?: string; response?: string; message?: string };
    console.error("Sending mail failed:", e.code, e.response ?? e.message);
    throw new MailError(
      e.code === "EAUTH"
        ? "The mail server rejected the email login. Check SMTP_USER and SMTP_PASS on the server."
        : `The email couldn't be sent (${e.code ?? "error"}). Please try again.`
    );
  }
}
