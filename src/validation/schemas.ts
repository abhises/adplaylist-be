import Joi from "joi";
import { PLAN_IDS, isValidVolume } from "../lib/plans.js";

// Only "client" and "designer" are selectable at signup — "admin" can only
// be granted later via the admin panel, never by a self-registering user.
export const registerSchema = Joi.object({
  fullName: Joi.string().trim().min(1).required(),
  email: Joi.string().trim().email().required(),
  password: Joi.string().min(8).required(),
  role: Joi.string().valid("client", "designer").default("client"),
});

export const loginSchema = Joi.object({
  email: Joi.string().trim().required(),
  password: Joi.string().required(),
});

export const googleAuthSchema = Joi.object({
  credential: Joi.string().required(),
});

// Ads store tags comma-separated, so a tag name can't contain a comma.
const tagName = Joi.string()
  .trim()
  .min(1)
  .max(100)
  .pattern(/^[^,]+$/)
  .messages({ "string.pattern.base": "Tag names can't contain commas" });

export const tagSchema = Joi.object({
  name: tagName.required(),
});

// URL slugs for ads and authors: lowercase words joined by single hyphens.
const urlSlug = Joi.string()
  .trim()
  .max(150)
  .pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .messages({
    "string.pattern.base": "Slugs can only use lowercase letters, numbers and hyphens",
  });

const longText = Joi.string().trim().allow("").max(5000);
const shortText = Joi.string().trim().allow("").max(1000);
const textList = Joi.array().items(Joi.string().trim().allow("").max(500)).max(20);

// The editorial sections of an ad page (see AdContent in lib/adContent.ts).
const adContentSchema = Joi.object({
  takeaways: Joi.object({
    format: shortText,
    bestFor: shortText,
    hook: shortText,
    reuse: shortText,
  }),
  whyItWorks: Joi.array()
    .items(Joi.object({ title: shortText, text: shortText }))
    .max(10),
  targets: longText,
  copywriting: longText,
  visualDesign: longText,
  adaptSteps: textList,
  platformTips: longText,
  headlineIdeas: textList,
  collections: textList,
  relatedGuides: textList,
  popularSearches: textList,
  relatedAds: textList,
});

// Column sizes come from the ads table, so a value that's too long is
// rejected with a clear message instead of failing in the database.
export const createAdSchema = Joi.object({
  slug: urlSlug.allow(null, ""),
  title: Joi.string().trim().min(1).max(255).required(),
  format: Joi.string().trim().allow("").max(100),
  variant: Joi.string().trim().valid("overlay", "lockup"),
  eyebrow: Joi.string().trim().allow(null, "").max(100),
  headline: Joi.string().trim().min(1).max(255).required(),
  sub: Joi.string().trim().allow(null, "").max(255),
  cta: Joi.string().trim().allow(null, "").max(100),
  badge: Joi.string().trim().allow(null, "").max(100),
  description: Joi.string().trim().allow(null, ""),
  mediaType: Joi.string().trim().valid("image", "video"),
  swatch: Joi.string().trim().allow("").max(255),
  light: Joi.boolean(),
  category: Joi.string().trim().min(1).max(100).required(),
  categories: Joi.array().items(Joi.string().trim().min(1).max(100)).max(3),
  market: Joi.string().trim().min(1).max(50).required(),
  markets: Joi.array().items(Joi.string().trim().min(1).max(50)).max(3),
  language: Joi.string().trim().allow("").max(50),
  photo: Joi.string().uri().allow(null, "").max(500),
  platforms: Joi.array().items(Joi.string()),
  editable: Joi.boolean(),
  canvaUrl: Joi.string().uri().allow(null, "").max(500),
  canvaPremium: Joi.boolean(),
  isLive: Joi.boolean(),
  primaryText: Joi.string().trim().allow(null, ""),
  brandName: Joi.string().trim().max(255).allow(null, ""),
  creativeDescription: Joi.string().trim().allow(null, ""),
  tags: Joi.array().items(tagName),
  dominantColor: Joi.string().trim().allow(null, "").max(30),
  videoLength: Joi.string().trim().allow(null, "").max(20),
  subcategory: Joi.string().trim().allow(null, "").max(100),
  adFormat: Joi.string().trim().allow(null, "").max(50),
  onImageText: Joi.string().trim().allow(null, "").max(5000),
  seoTitle: Joi.string().trim().allow(null, "").max(255),
  metaDescription: Joi.string().trim().allow(null, "").max(500),
  pageHeadline: Joi.string().trim().allow(null, "").max(255),
  introParagraph: Joi.string().trim().allow(null, "").max(5000),
  imageFileName: Joi.string().trim().allow(null, "").max(255),
  imageAlt: Joi.string().trim().allow(null, "").max(255),
  imageCaption: Joi.string().trim().allow(null, "").max(500),
  content: adContentSchema.allow(null),
  // Authors are named by slug; unknown ones are rejected by the route.
  authorSlug: Joi.string().trim().allow(null, "").max(150),
  reviewerSlug: Joi.string().trim().allow(null, "").max(150),
  dateAdded: Joi.date().iso().allow(null, ""),
  dateUpdated: Joi.date().iso().allow(null, ""),
});

export const authorSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).required(),
  slug: urlSlug.allow(null, ""),
  jobTitle: Joi.string().trim().allow(null, "").max(255),
  credentials: Joi.string().trim().allow(null, "").max(255),
  bio: Joi.string().trim().allow(null, "").max(5000),
  photoUrl: Joi.string().uri().allow(null, "").max(500),
  linkedinUrl: Joi.string().uri().allow(null, "").max(500),
  websiteUrl: Joi.string().uri().allow(null, "").max(500),
});

export const updateProfileSchema = Joi.object({
  fullName: Joi.string().trim().min(1),
  defaultLanguage: Joi.string().trim(),
  gridDensity: Joi.string().trim(),
  emailPreferences: Joi.object({
    onboarding: Joi.boolean(),
    product: Joi.boolean(),
    promotions: Joi.boolean(),
    brand: Joi.boolean(),
    newsletter: Joi.boolean(),
  }),
});

// The library's brand questionnaire, saved one step at a time. "complete"
// marks it finished; "skip" records a "Skip for now".
export const onboardingAnswersSchema = Joi.object({
  niche: Joi.string().trim().max(255).allow(""),
  product: Joi.string().trim().max(2000).allow(""),
  brand: Joi.string().trim().max(255).allow(""),
  website: Joi.string().trim().max(500).allow(""),
  libraryType: Joi.string().valid("meta", "google"),
  libraryUrl: Joi.string().trim().max(1000).allow(""),
  competitors: Joi.array().items(Joi.string().trim().min(1).max(255)).max(5),
  action: Joi.string().valid("complete", "skip"),
});

// A saved library filter. Lists are capped well above what the library
// offers, just to keep a row small.
const filterList = Joi.array().items(Joi.string().trim().min(1).max(100)).max(50);
export const savedFilterSchema = Joi.object({
  name: Joi.string().trim().min(1).max(60).required(),
  isDefault: Joi.boolean().default(false),
  filters: Joi.object({
    keyword: Joi.string().trim().max(200).allow(""),
    mediaTypes: filterList,
    platforms: filterList,
    categories: filterList,
    country: Joi.string().trim().max(100).allow(""),
    language: Joi.string().trim().max(100).allow(""),
    addedDays: Joi.number().integer().min(1).max(3650).allow(null),
    formats: filterList,
    canva: Joi.string().valid("", "editable", "non-editable"),
    premium: Joi.boolean(),
    adType: Joi.string().valid("", "live", "concept"),
    lengths: filterList,
    colors: filterList,
    tags: filterList,
  }).required(),
});

// Rename a saved filter and/or make it (or stop it being) the default.
export const updateSavedFilterSchema = Joi.object({
  name: Joi.string().trim().min(1).max(60),
  isDefault: Joi.boolean(),
}).min(1);

// "Delete account": why they're leaving. A comment is optional except for
// "Other", where it's the whole answer.
export const CANCEL_REASONS = [
  "Too expensive",
  "I'm not using it enough",
  "Missing features I need",
  "Found a better alternative",
  "Technical issues or bugs",
  "Other",
];
export const deleteAccountSchema = Joi.object({
  reason: Joi.string()
    .valid(...CANCEL_REASONS)
    .required(),
  details: Joi.when("reason", {
    is: "Other",
    then: Joi.string().trim().min(1).max(2000).required(),
    otherwise: Joi.string().trim().max(2000).allow(""),
  }),
});

export const createRequestSchema = Joi.object({
  title: Joi.string().trim().min(1).required(),
  adUrl: Joi.string().trim().uri({ scheme: ["http", "https"] }).max(1000).required(),
  sizeNeeded: Joi.string().trim().max(150).allow(null, ""),
  neededBy: Joi.date().allow(null, ""),
  notes: Joi.string().trim().allow(null, ""),
  attachmentUrl: Joi.string().uri().allow(null, ""),
  attachmentName: Joi.string().trim().allow(null, ""),
});

// One-click requests about an ad: "Request Canva Edit" on an ad with no
// Canva link yet, and "Request a similar design" on a live ad.
export const canvaRequestSchema = Joi.object({
  adId: Joi.string().trim().min(1).required(),
});

export const deliverRequestSchema = Joi.object({
  deliveredUrl: Joi.string().trim().uri({ scheme: ["http", "https"] }).max(1000).required(),
  note: Joi.string().trim().max(2000).allow(null, ""),
});

export const declineRequestSchema = Joi.object({
  reason: Joi.string().trim().min(1).required(),
});

export const idParamSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
});

export const uploadSignSchema = Joi.object({
  filename: Joi.string().trim().min(1).required(),
  contentType: Joi.string().trim().required(),
});

// "editor" is staff an admin creates to manage the blog and/or brand pages
// (see canManageBlog / canManageBrandPages on User).
export const ROLES = ["client", "designer", "editor", "admin"] as const;

export const updateUserRoleSchema = Joi.object({
  role: Joi.string()
    .valid(...ROLES)
    .required(),
});

export const updateUserDetailsSchema = Joi.object({
  fullName: Joi.string().trim().min(1).required(),
  email: Joi.string().trim().email().required(),
  canManageBlog: Joi.boolean(),
  canManageBrandPages: Joi.boolean(),
});

export const createUserSchema = Joi.object({
  fullName: Joi.string().trim().min(1).required(),
  email: Joi.string().trim().email().required(),
  password: Joi.string().min(8).required(),
  role: Joi.string()
    .valid(...ROLES)
    .default("client"),
  canManageBlog: Joi.boolean().default(false),
  canManageBrandPages: Joi.boolean().default(false),
});

export const brandPageSchema = Joi.object({
  brandName: Joi.string().trim().min(1).max(150).required(),
  slug: Joi.string()
    .trim()
    .lowercase()
    .pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(150)
    .allow(""),
  heading: Joi.string().trim().max(255).allow(""),
  bodyHtml: Joi.string().allow(""),
  ctaLabel: Joi.string().trim().max(100).allow(""),
  published: Joi.boolean(),
});

export const blogPostSchema = Joi.object({
  title: Joi.string().trim().min(1).max(255).required(),
  slug: Joi.string()
    .trim()
    .lowercase()
    .pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(150)
    .allow(""),
  excerpt: Joi.string().trim().max(500).allow(""),
  coverImageUrl: Joi.string().uri().max(500).allow(""),
  bodyHtml: Joi.string().allow(""),
  published: Joi.boolean(),
});

export const createFeedbackSchema = Joi.object({
  message: Joi.string().trim().min(1).max(5000).required(),
  email: Joi.string().trim().email().max(255).allow(null, ""),
  screenshotUrl: Joi.string().uri().max(500).allow(null, ""),
  screenshotName: Joi.string().trim().max(255).allow(null, ""),
  pageUrl: Joi.string().trim().max(500).allow(null, ""),
});

// The landing page's "Talk to us" form (custom volume / enterprise). Public,
// so `website` is a honeypot: a field people never see, which bots fill in.
export const contactSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).required(),
  email: Joi.string().trim().email().max(255).required(),
  company: Joi.string().trim().max(255).allow(null, ""),
  volume: Joi.string().trim().max(50).allow(null, ""),
  message: Joi.string().trim().min(1).max(5000).required(),
  website: Joi.string().allow(null, ""),
});

export const contactReplySchema = Joi.object({
  subject: Joi.string().trim().min(1).max(255).required(),
  body: Joi.string().trim().min(1).max(20000).required(),
});

export const contactStatusSchema = Joi.object({
  status: Joi.string().valid("new", "replied", "closed").required(),
});

export const updateFeedbackSchema = Joi.object({
  resolved: Joi.boolean().required(),
});

export const checkoutSchema = Joi.object({
  plan: Joi.string().valid(...PLAN_IDS).required(),
  volume: Joi.number().integer().min(0).required(),
  cycle: Joi.string().valid("monthly", "yearly").required(),
}).custom((value, helpers) =>
  isValidVolume(value.plan, value.volume)
    ? value
    : helpers.message({ custom: "That credit volume isn't offered on this plan" })
);

export const checkoutReturnSchema = Joi.object({
  sessionId: Joi.string().trim().pattern(/^cs_/).required(),
});

// Dollars with up to 2 decimal places. Starter can't be free: a $0 Stripe
// subscription would never collect a card.
const priceDollars = Joi.number().precision(2).min(0.5).max(100000);

export const planPriceParamsSchema = Joi.object({
  plan: Joi.string().valid(...PLAN_IDS).required(),
  volume: Joi.number().integer().min(0).required(),
});

export const planPriceSchema = Joi.object({
  monthly: priceDollars.required(),
  yearly: priceDollars.required(),
});

// Several prices saved together from the pricing admin's one Save button.
export const planPricesSchema = Joi.object({
  changes: Joi.array()
    .items(
      Joi.object({
        plan: Joi.string().valid(...PLAN_IDS).required(),
        volume: Joi.number().integer().min(0).required(),
        monthly: priceDollars.required(),
        yearly: priceDollars.required(),
        credits: Joi.number().integer().min(0).max(10000).required(),
      })
    )
    .min(1)
    .max(50)
    .required(),
});
