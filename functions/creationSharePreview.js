"use strict";

const PUBLIC_ORIGIN = "https://www.planetcreations.net";
const FALLBACK_IMAGE_URL = `${PUBLIC_ORIGIN}/logo.png`;

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function safeCreationId(value) {
    const candidate = typeof value === "string" ? value.trim() : "";
    return /^[A-Za-z0-9_-]{1,128}$/.test(candidate) ? candidate : null;
}

function safeImageUrl(value) {
    if (typeof value !== "string" || value.length > 4096) return null;
    try {
        const parsed = new URL(value);
        return parsed.protocol === "https:" ? parsed.toString() : null;
    } catch {
        return null;
    }
}

function firstGalleryImage(creation) {
    if (!Array.isArray(creation?.imageUrls)) return FALLBACK_IMAGE_URL;
    return creation.imageUrls.map(safeImageUrl).find(Boolean) || FALLBACK_IMAGE_URL;
}

function buildCreationSharePreviewHtml({creationId, creation}) {
    const id = safeCreationId(creationId);
    if (!id) throw new Error("Invalid creation ID.");
    const titleValue = typeof creation?.title === "string" && creation.title.trim() ?
        creation.title.trim().slice(0, 160) : "PlanetCreations Creation";
    const username = typeof creation?.username === "string" && creation.username.trim() ?
        creation.username.trim().slice(0, 100) : "the PlanetCreations community";
    const descriptionValue = typeof creation?.description === "string" && creation.description.trim() ?
        creation.description.trim().replace(/\s+/g, " ").slice(0, 240) :
        `Discover ${titleValue} by ${username} on PlanetCreations.`;
    const shareUrl = `${PUBLIC_ORIGIN}/share/creation/${encodeURIComponent(id)}`;
    const creationUrl = `${PUBLIC_ORIGIN}/creation/${encodeURIComponent(id)}`;
    const imageUrl = firstGalleryImage(creation);
    const title = escapeHtml(`${titleValue} · PlanetCreations`);
    const description = escapeHtml(descriptionValue);
    const escapedShareUrl = escapeHtml(shareUrl);
    const escapedCreationUrl = escapeHtml(creationUrl);
    const escapedImageUrl = escapeHtml(imageUrl);
    const escapedImageAlt = escapeHtml(`First gallery image of ${titleValue}`);

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${escapedShareUrl}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="PlanetCreations">
  <meta property="og:url" content="${escapedShareUrl}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${escapedImageUrl}">
  <meta property="og:image:secure_url" content="${escapedImageUrl}">
  <meta property="og:image:alt" content="${escapedImageAlt}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${escapedImageUrl}">
  <meta name="twitter:image:alt" content="${escapedImageAlt}">
</head>
<body>
  <p>Opening <a href="${escapedCreationUrl}">${escapeHtml(titleValue)}</a>…</p>
  <script>window.location.replace(${JSON.stringify(creationUrl)});</script>
</body>
</html>`;
}

module.exports = {
    FALLBACK_IMAGE_URL,
    buildCreationSharePreviewHtml,
    firstGalleryImage,
    safeCreationId,
};
