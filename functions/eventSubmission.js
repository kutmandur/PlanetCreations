"use strict";

const MAX_CUSTOM_FIELDS = 50;
const MAX_CUSTOM_VALUE_LENGTH = 2000;
const MAX_SUBMISSIONS_PER_USER = 100;

class EventSubmissionError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "EventSubmissionError";
    }
}

const timestampToMillis = (value) => {
    if (typeof value?.toMillis === "function") return value.toMillis();
    if (value instanceof Date) return value.getTime();
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const getSubmissionLimit = (event) => {
    if (!event?.allowMultipleSubmissions) return 1;
    const requested = Math.floor(Number(event.submissionLimit) || 1);
    return Math.min(MAX_SUBMISSIONS_PER_USER, Math.max(1, requested));
};

const containsBlacklistedWord = (text, blacklist) => {
    if (!text || !Array.isArray(blacklist) || blacklist.length === 0) {
        return false;
    }
    const escaped = blacklist
        .filter(Boolean)
        .map(word => String(word).replace(
            /[-/\\^$*+?.()|[\]{}]/g, "\\$&"));
    if (escaped.length === 0) return false;
    return new RegExp(`\\b(${escaped.join("|")})\\b`, "i")
        .test(String(text));
};

const validateAndNormalizeSubmission = ({
    acceptedRuleIds,
    blacklist,
    canParticipate,
    creation,
    customFieldData,
    event,
    nowMs = Date.now(),
    uid,
}) => {
    if (!canParticipate) {
        throw new EventSubmissionError(
            "permission-denied",
            "Your community rank cannot participate in this event.",
        );
    }
    if (creation.userId !== uid) {
        throw new EventSubmissionError(
            "permission-denied",
            "You can only submit your own creation.",
        );
    }
    if (creation.game !== event.game) {
        throw new EventSubmissionError(
            "failed-precondition",
            "This creation is not eligible for the event's game.",
        );
    }

    const startsAt = timestampToMillis(event.startDate);
    const endsAt = timestampToMillis(event.endDate);
    if (startsAt === null || endsAt === null || nowMs < startsAt || nowMs > endsAt) {
        throw new EventSubmissionError(
            "failed-precondition",
            "The event is not accepting submissions.",
        );
    }
    if (event.blockOldCreations && event.creationCutoffDate) {
        const cutoff = timestampToMillis(event.creationCutoffDate);
        const createdAt = timestampToMillis(creation.createdAt);
        if (cutoff !== null && (createdAt === null || createdAt < cutoff)) {
            throw new EventSubmissionError(
                "failed-precondition",
                "This creation is older than the event allows.",
            );
        }
    }

    const rules = Array.isArray(event.rules) ? event.rules : [];
    const accepted = new Set(
        (Array.isArray(acceptedRuleIds) ? acceptedRuleIds : [])
            .map((id) => String(id)),
    );
    if (rules.some((rule) => !accepted.has(String(rule.id)))) {
        throw new EventSubmissionError(
            "failed-precondition",
            "All event rules must be accepted.",
        );
    }

    const fields = Array.isArray(event.customFields) ? event.customFields : [];
    if (fields.length > MAX_CUSTOM_FIELDS) {
        throw new EventSubmissionError(
            "failed-precondition",
            "This event has too many custom fields.",
        );
    }
    const submitted = customFieldData && typeof customFieldData === "object" &&
        !Array.isArray(customFieldData) ? customFieldData : {};
    const allowedIds = new Set(fields.map((field) => String(field.id)));
    if (Object.keys(submitted).some((id) => !allowedIds.has(id))) {
        throw new EventSubmissionError(
            "invalid-argument",
            "The submission contains an unknown custom field.",
        );
    }

    const normalizedFields = {};
    fields.forEach((field) => {
        const id = String(field.id);
        const value = submitted[id] == null ? "" : String(submitted[id]).trim();
        if (field.required && !value) {
            throw new EventSubmissionError(
                "failed-precondition",
                `The required field "${String(field.label || id)}" is empty.`,
            );
        }
        if (value.length > MAX_CUSTOM_VALUE_LENGTH) {
            throw new EventSubmissionError(
                "invalid-argument",
                `The field "${String(field.label || id)}" is too long.`,
            );
        }
        if (containsBlacklistedWord(value, blacklist)) {
            throw new EventSubmissionError(
                "invalid-argument",
                "Your submission contains a forbidden word. Please revise it.",
            );
        }
        if (value) normalizedFields[id] = value;
    });

    return normalizedFields;
};

module.exports = {
    EventSubmissionError,
    getSubmissionLimit,
    validateAndNormalizeSubmission,
};
