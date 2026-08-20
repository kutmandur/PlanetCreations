"use strict";

// Pure creation matcher used by the live-stream functions. Keeping it free of
// Firebase imports makes the weighting deterministic and straightforward to
// exercise with unit tests.

const STOP_WORDS = new Set([
    "a", "an", "and", "am", "auf", "aus", "beim", "bin", "building", "der",
    "die", "das", "den", "dem", "des", "ein", "eine", "einem", "einen", "einer",
    "for", "für", "heute", "i", "ich", "im", "in", "ist", "jetzt", "live", "mein",
    "meine", "meinem", "meinen", "meiner", "mit", "my", "on", "stream", "the",
    "und", "von", "we", "wir", "with", "zu", "zum", "zur",
]);

function normalizeText(value) {
    return String(value || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/ß/g, "ss")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function tokenize(value, {keepStopWords = false} = {}) {
    const normalized = normalizeText(value);
    if (!normalized) return [];
    return [...new Set(normalized.split(/\s+/).filter((word) => (
        word.length > 1 && (keepStopWords || !STOP_WORDS.has(word))
    )))];
}

function phraseIsPresent(haystack, needle) {
    if (!needle) return false;
    return ` ${haystack} `.includes(` ${needle} `);
}

function scoreCreations({title, tags = [], category = ""}, creations) {
    const streamText = normalizeText([title, ...tags, category].join(" "));
    const streamWords = new Set(tokenize(streamText));
    const eligible = (creations || []).filter((creation) => (
        creation && creation.id && !creation.sourceCollaborationId
    ));

    const titleWordFrequency = new Map();
    eligible.forEach((creation) => {
        tokenize(creation.title).forEach((word) => {
            titleWordFrequency.set(word, (titleWordFrequency.get(word) || 0) + 1);
        });
    });

    return eligible.map((creation) => {
        let score = 0;
        const reasons = [];
        const normalizedTitle = normalizeText(creation.title);
        const titleWords = tokenize(creation.title);

        if (normalizedTitle && phraseIsPresent(streamText, normalizedTitle)) {
            score += 180;
            reasons.push("creation-title");
        }

        let titleWordScore = 0;
        titleWords.forEach((word) => {
            if (!streamWords.has(word)) return;
            const frequency = titleWordFrequency.get(word) || 1;
            // A name that appears in only one of the user's creations is much
            // stronger evidence than a repeated generic word such as "park".
            titleWordScore += 38 + Math.round(42 / frequency);
        });
        if (titleWordScore) {
            score += Math.min(150, titleWordScore);
            reasons.push("title-words");
        }

        let matchedTags = 0;
        (creation.tags || []).forEach((tag) => {
            const normalizedTag = normalizeText(tag);
            if (normalizedTag && (phraseIsPresent(streamText, normalizedTag) ||
                tokenize(normalizedTag).some((word) => streamWords.has(word)))) {
                matchedTags++;
            }
        });
        if (matchedTags) {
            score += Math.min(90, matchedTags * 30);
            reasons.push("tags");
        }

        const normalizedCategory = normalizeText(creation.category);
        if (normalizedCategory && (phraseIsPresent(streamText, normalizedCategory) ||
            tokenize(normalizedCategory).some((word) => streamWords.has(word)))) {
            score += 34;
            reasons.push("creation-type");
        }

        const descriptionOverlap = tokenize(creation.description)
            .filter((word) => streamWords.has(word)).length;
        if (descriptionOverlap) {
            score += Math.min(12, descriptionOverlap * 2);
            reasons.push("description");
        }

        return {
            creationId: creation.id,
            title: String(creation.title || "Untitled creation").slice(0, 200),
            game: creation.game || "",
            category: creation.category || "",
            imageUrl: creation.imageUrls?.[0] || null,
            score,
            confidence: score > 0 ? Number((score / (score + 80)).toFixed(3)) : 0,
            reasons,
        };
    }).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

function getMatchDecision(input, creations, currentCreationId = null) {
    const ranked = scoreCreations(input, creations);
    const best = ranked[0] || null;
    const runnerUp = ranked[1] || null;
    const current = ranked.find((item) => item.creationId === currentCreationId) || null;
    const comparison = current && current.creationId !== best?.creationId ? current : runnerUp;
    const margin = best ? best.confidence - (comparison?.confidence || 0) : 0;
    const confident = Boolean(best && best.confidence >= 0.62 && margin >= 0.10);
    return {ranked, best, current, margin: Number(margin.toFixed(3)), confident};
}

module.exports = {
    getMatchDecision,
    normalizeText,
    scoreCreations,
    tokenize,
};
