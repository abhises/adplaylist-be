import { Router } from "express";
import type { ContactEnquiry, ContactReply, User } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { MailError, mailConfigured, sendMail } from "../lib/mailer.js";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import {
  contactReplySchema,
  contactSchema,
  contactStatusSchema,
  idParamSchema,
} from "../validation/schemas.js";

const router = Router();

// Enquiries per visitor allowed in the window below. The API sits behind a
// proxy, so the visitor is told apart by X-Forwarded-For where it's sent.
const CONTACT_LIMIT = 20;
const CONTACT_WINDOW_MS = 10 * 60 * 1000;
const contactHits = new Map<string, number[]>();

function contactAllowed(key: string) {
  const now = Date.now();
  const recent = (contactHits.get(key) ?? []).filter((t) => now - t < CONTACT_WINDOW_MS);
  if (recent.length >= CONTACT_LIMIT) {
    contactHits.set(key, recent);
    return false;
  }
  recent.push(now);
  contactHits.set(key, recent);
  return true;
}

type ReplyWithSender = ContactReply & { sentBy?: Pick<User, "fullName"> | null };

function toEnquiryResponse(
  enquiry: ContactEnquiry & { replies?: ReplyWithSender[]; _count?: { replies: number } }
) {
  return {
    id: enquiry.id,
    name: enquiry.name,
    email: enquiry.email,
    company: enquiry.company ?? undefined,
    volume: enquiry.volume ?? undefined,
    message: enquiry.message,
    status: enquiry.status,
    createdAt: enquiry.createdAt,
    replyCount: enquiry._count?.replies ?? enquiry.replies?.length ?? 0,
    replies: enquiry.replies?.map((r) => ({
      id: r.id,
      subject: r.subject,
      body: r.body,
      sentBy: r.sentBy?.fullName,
      sentAt: r.sentAt,
    })),
  };
}

// The enquiry quoted under a reply, like an email client does, so the
// client sees what they're being answered about.
function quoted(enquiry: ContactEnquiry) {
  const when = enquiry.createdAt.toUTCString();
  return `\n\n----\nOn ${when}, ${enquiry.name} <${enquiry.email}> wrote:\n> ${enquiry.message
    .split("\n")
    .join("\n> ")}`;
}

// Public: the landing page's "Talk to us" form. The team is told by email
// (reply-to the sender), and the enquiry waits in Admin → Contact.
router.post("/", validateBody(contactSchema), async (req, res) => {
  const { name, email, company, volume, message, website } = req.body;
  // A filled honeypot is a bot: answer as if it worked and keep nothing.
  if (website) return res.status(201).json({ ok: true });

  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim();
  if (!contactAllowed(forwarded || req.ip || "unknown")) {
    return res
      .status(429)
      .json({ error: "Too many messages. Please try again in a few minutes." });
  }

  const enquiry = await prisma.contactEnquiry.create({
    data: {
      name,
      email,
      company: company || null,
      volume: volume || null,
      message,
    },
  });
  res.status(201).json({ ok: true });

  // After answering: a slow or failing mail server mustn't hold up or fail
  // the visitor's request. The enquiry is saved either way.
  const notifyTo = process.env.CONTACT_NOTIFY_TO;
  if (notifyTo && mailConfigured()) {
    sendMail({
      to: notifyTo,
      replyTo: `${name} <${email}>`,
      subject: `New enquiry from ${name}${company ? ` (${company})` : ""}`,
      text: [
        "A new custom volume / custom price enquiry came in.",
        "",
        `Name: ${name}`,
        `Email: ${email}`,
        company ? `Company: ${company}` : null,
        volume ? `Ads per month: ${volume}` : null,
        "",
        message,
        "",
        `Reply from Admin → Contact (enquiry #${enquiry.id}), or reply to this email.`,
      ]
        .filter((l) => l !== null)
        .join("\n"),
    }).catch(() => {
      // Already logged by sendMail.
    });
  }
});

router.use(requireAuth, requireRole("admin"));

router.get("/", async (_req, res) => {
  const enquiries = await prisma.contactEnquiry.findMany({
    include: { _count: { select: { replies: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json({
    enquiries: enquiries.map(toEnquiryResponse),
    mailConfigured: mailConfigured(),
  });
});

router.get("/:id", validateParams(idParamSchema), async (req, res) => {
  const enquiry = await prisma.contactEnquiry.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      replies: { include: { sentBy: { select: { fullName: true } } }, orderBy: { sentAt: "asc" } },
    },
  });
  if (!enquiry) return res.status(404).json({ error: "Enquiry not found" });
  res.json({ enquiry: toEnquiryResponse(enquiry) });
});

// Emails the reply to the enquirer from info@adplaylist.com (their answer
// comes back to that inbox), then keeps it on the enquiry. Nothing is saved
// if the email can't be sent.
router.post(
  "/:id/reply",
  validateParams(idParamSchema),
  validateBody(contactReplySchema),
  async (req: AuthedRequest, res) => {
    const enquiry = await prisma.contactEnquiry.findUnique({
      where: { id: Number(req.params.id) },
    });
    if (!enquiry) return res.status(404).json({ error: "Enquiry not found" });

    const { subject, body } = req.body as { subject: string; body: string };
    try {
      await sendMail({
        to: `${enquiry.name} <${enquiry.email}>`,
        subject,
        text: body + quoted(enquiry),
        bccSelf: true,
      });
    } catch (err) {
      if (err instanceof MailError) return res.status(502).json({ error: err.message });
      throw err;
    }

    const [, updated] = await prisma.$transaction([
      prisma.contactReply.create({
        data: { enquiryId: enquiry.id, subject, body, sentById: req.userId ?? null },
      }),
      prisma.contactEnquiry.update({
        where: { id: enquiry.id },
        data: { status: enquiry.status === "closed" ? "closed" : "replied" },
        include: {
          replies: {
            include: { sentBy: { select: { fullName: true } } },
            orderBy: { sentAt: "asc" },
          },
        },
      }),
    ]);
    res.status(201).json({ enquiry: toEnquiryResponse(updated) });
  }
);

router.patch(
  "/:id",
  validateParams(idParamSchema),
  validateBody(contactStatusSchema),
  async (req, res) => {
    const { count } = await prisma.contactEnquiry.updateMany({
      where: { id: Number(req.params.id) },
      data: { status: req.body.status },
    });
    if (!count) return res.status(404).json({ error: "Enquiry not found" });
    res.json({ ok: true });
  }
);

router.delete("/:id", validateParams(idParamSchema), async (req, res) => {
  const { count } = await prisma.contactEnquiry.deleteMany({
    where: { id: Number(req.params.id) },
  });
  if (!count) return res.status(404).json({ error: "Enquiry not found" });
  res.status(204).send();
});

export default router;
