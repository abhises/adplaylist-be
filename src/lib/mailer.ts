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
  html,
  replyTo,
  bccSelf = false,
}: {
  to: string;
  subject: string;
  text: string;
  // A designed HTML body; without one, the plain text is wrapped as HTML.
  html?: string;
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
      html: html ?? toHtml(text),
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

// Sent once, when a customer account is first created (email or Google
// sign-up). Fire-and-forget: a mail failure is logged, never surfaced, so it
// can't block or fail the sign-up itself.
export function sendWelcomeEmail(to: string, fullName: string, trialDays: number) {
  if (!mailConfigured()) return;
  const { subject, text, html } = welcomeEmail(fullName, trialDays);
  sendMail({ to, subject, text, html }).catch((err) =>
    console.error("Welcome email failed:", (err as Error).message)
  );
}

export function welcomeEmail(fullName: string, trialDays: number) {
  const site = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
  const firstName = fullName.trim().split(/\s+/)[0] || "there";
  const subject = "Welcome to Adplaylist. Your next ad is already made.";

  const text = `Hi ${firstName},

Welcome to Adplaylist! Your account is ready. Pick a plan and add your card to start your ${trialDays}-day free trial: ${site}/billing
You won't be charged until the trial ends, and you can cancel any time before then.

Here's how to get going:
1. Browse the library: ${site}/library
2. Open any creative as an editable copy and launch it in minutes.
3. Need something new? Request it from the creative team: ${site}/requests

Questions? Just reply to this email.

The Adplaylist team`;

  const font = "'Helvetica Neue',Helvetica,Arial,sans-serif";
  const step = (n: number, title: string, body: string) => `
            <tr>
              <td valign="top" width="44" style="padding:0 0 22px 0;">
                <div style="width:32px;height:32px;line-height:32px;text-align:center;background:#EC3016;color:#ffffff;font-family:${font};font-size:15px;font-weight:800;">${n}</div>
              </td>
              <td valign="top" style="padding:0 0 22px 0;font-family:${font};">
                <div style="font-size:16px;font-weight:700;color:#161514;line-height:1.3;">${title}</div>
                <div style="margin-top:4px;font-size:15px;color:#55524e;line-height:1.5;">${body}</div>
              </td>
            </tr>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#F3F2F0;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your account is ready. Start your ${trialDays}-day free trial: nothing is charged until it ends.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F3F2F0;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">

          <!-- Hero -->
          <tr>
            <td style="background:#EC3016;padding:36px 40px 44px 40px;font-family:${font};color:#ffffff;">
              <div style="font-size:13px;font-weight:800;letter-spacing:3px;text-transform:uppercase;">Adplaylist</div>
              <div style="margin-top:40px;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;opacity:0.9;">Welcome aboard, ${escapeHtml(firstName)}</div>
              <h1 style="margin:12px 0 0 0;font-size:44px;line-height:1;font-weight:800;letter-spacing:-1.5px;color:#ffffff;">Your next ad is already made.</h1>
              <p style="margin:20px 0 0 0;font-size:17px;line-height:1.5;color:#ffffff;">Your account is ready. Pick a plan and add your card to start your <strong>${trialDays}-day free trial</strong>. You won't be charged until it ends, and you can cancel any time before then.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;">
                <tr>
                  <td style="background:#161514;">
                    <a href="${site}/billing" style="display:inline-block;padding:16px 28px;font-family:${font};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;">Start your free trial &rarr;</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Steps -->
          <tr>
            <td style="background:#ffffff;padding:40px 40px 18px 40px;">
              <div style="font-family:${font};font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#8a8783;">Get going in 3 steps</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;">${step(
                1,
                "Find a creative",
                "Search and filter every ad by platform, brand and format."
              )}${step(
                2,
                "Open an editable copy",
                "Swap the copy, colors or product and launch in minutes. No design skills needed."
              )}${step(
                3,
                "Request something new",
                `Can't find it? <a href="${site}/requests" style="color:#EC3016;font-weight:700;text-decoration:none;">Ask the creative team</a> and they'll make it.`
              )}
              </table>
            </td>
          </tr>

          <!-- Reply note -->
          <tr>
            <td style="background:#ffffff;padding:0 40px 40px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="border-top:1px solid #e7e5e2;padding-top:24px;font-family:${font};font-size:15px;line-height:1.55;color:#55524e;">
                    Questions or ideas? Just reply to this email. A real person reads every one.<br><br>
                    <span style="color:#161514;font-weight:700;">The Adplaylist team</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:24px 40px;font-family:${font};font-size:12px;line-height:1.6;color:#8a8783;">
              You're receiving this because you created an account at <a href="${site}" style="color:#8a8783;">adplaylist.com</a>.<br>
              &copy; ${new Date().getFullYear()} Adplaylist
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
