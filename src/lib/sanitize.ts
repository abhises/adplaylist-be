import sanitizeHtml from "sanitize-html";

// Admin-written HTML for public pages (brand pages, blog posts). Only admins
// write it, but it's still sanitized before it's stored so a pasted template
// can't smuggle scripts or event handlers onto a public page. Layout markup,
// images, links and inline styles are kept.
export function cleanHtml(html: string) {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "h1",
      "h2",
      "figure",
      "figcaption",
      "section",
      "span",
      "video",
      "source",
    ]),
    allowedAttributes: {
      "*": ["class", "style", "id", "align"],
      // Placeholder for an embedded library ad; see adplaylist-fe/src/lib/adEmbed.ts
      div: ["data-ad"],
      a: ["href", "target", "rel", "title"],
      img: ["src", "alt", "width", "height", "loading", "title"],
      video: ["src", "poster", "controls", "autoplay", "muted", "loop", "playsinline", "width", "height"],
      source: ["src", "type"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs:
          attribs.target === "_blank"
            ? { ...attribs, rel: "noopener noreferrer" }
            : attribs,
      }),
    },
  });
}
