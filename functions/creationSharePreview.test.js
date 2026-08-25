"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
    FALLBACK_IMAGE_URL,
    buildCreationSharePreviewHtml,
    firstGalleryImage,
    safeCreationId,
} = require("./creationSharePreview");

test("uses the first valid gallery image in creation link previews", () => {
    const html = buildCreationSharePreviewHtml({
        creationId: "creation_123",
        creation: {
            title: "Boulder & Blast",
            username: "Builder",
            description: "A <wooden> coaster",
            imageUrls: [
                "https://cdn.example.com/gallery/first.jpg",
                "https://cdn.example.com/gallery/second.jpg",
            ],
        },
    });

    assert.match(html, /og:image" content="https:\/\/cdn\.example\.com\/gallery\/first\.jpg"/);
    assert.doesNotMatch(html, /og:image" content="https:\/\/cdn\.example\.com\/gallery\/second\.jpg"/);
    assert.match(html, /Boulder &amp; Blast · PlanetCreations/);
    assert.match(html, /A &lt;wooden&gt; coaster/);
    assert.match(
        html,
        /window\.location\.replace\("https:\/\/www\.planetcreations\.net\/creation\/creation_123"\)/
    );
    assert.doesNotMatch(html, /#\/creation\/creation_123/);
});

test("falls back safely when a creation has no public gallery image", () => {
    assert.equal(firstGalleryImage({imageUrls: ["javascript:alert(1)"]}), FALLBACK_IMAGE_URL);
    assert.match(buildCreationSharePreviewHtml({
        creationId: "safe-id",
        creation: {title: "No image", imageUrls: []},
    }), new RegExp(FALLBACK_IMAGE_URL.replaceAll(".", "\\.")));
});

test("accepts only bounded Firestore-safe creation IDs", () => {
    assert.equal(safeCreationId("GP61an1czVXbQYkVaenh"), "GP61an1czVXbQYkVaenh");
    assert.equal(safeCreationId("../profiles/admin"), null);
    assert.equal(safeCreationId("x".repeat(129)), null);
});
