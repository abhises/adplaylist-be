import Joi from "joi";

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

export const createAdSchema = Joi.object({
  title: Joi.string().trim().min(1).required(),
  format: Joi.string().trim().allow(""),
  variant: Joi.string().trim().valid("overlay", "lockup"),
  eyebrow: Joi.string().trim().allow(null, ""),
  headline: Joi.string().trim().min(1).required(),
  sub: Joi.string().trim().allow(null, ""),
  cta: Joi.string().trim().allow(null, ""),
  badge: Joi.string().trim().allow(null, ""),
  description: Joi.string().trim().allow(null, ""),
  mediaType: Joi.string().trim().valid("image", "video"),
  swatch: Joi.string().trim().allow(""),
  light: Joi.boolean(),
  category: Joi.string().trim().min(1).required(),
  market: Joi.string().trim().min(1).required(),
  language: Joi.string().trim().allow(""),
  photo: Joi.string().uri().allow(null, ""),
  platforms: Joi.array().items(Joi.string()),
  editable: Joi.boolean(),
  canvaUrl: Joi.string().uri().allow(null, ""),
  primaryText: Joi.string().trim().allow(null, ""),
  brandName: Joi.string().trim().max(255).allow(null, ""),
  creativeDescription: Joi.string().trim().allow(null, ""),
  tags: Joi.array().items(tagName),
  dominantColor: Joi.string().trim().allow(null, ""),
  videoLength: Joi.string().trim().allow(null, ""),
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

export const createRequestSchema = Joi.object({
  title: Joi.string().trim().min(1).required(),
  sizeNeeded: Joi.string().trim().allow(null, ""),
  neededBy: Joi.date().allow(null, ""),
  notes: Joi.string().trim().allow(null, ""),
  attachmentUrl: Joi.string().uri().allow(null, ""),
  attachmentName: Joi.string().trim().allow(null, ""),
});

export const deliverRequestSchema = Joi.object({
  adId: Joi.string().trim().min(1).required(),
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

export const ROLES = ["client", "designer", "admin"] as const;

export const updateUserRoleSchema = Joi.object({
  role: Joi.string()
    .valid(...ROLES)
    .required(),
});

export const updateUserDetailsSchema = Joi.object({
  fullName: Joi.string().trim().min(1).required(),
  email: Joi.string().trim().email().required(),
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
