// Keep these UI limits aligned with Firestore rules, Cloud Functions and native validation.
export const TEXT_LIMITS = Object.freeze({
    username: 30, bio: 500, creationTitle: 200, creationDescription: 5000,
    communityName: 100, communityDescription: 2000, rankName: 50,
    eventAnswer: 2000, backupNote: 1000, streamUrl: 300,
    showcaseName: 80, showcaseVideoUrl: 2000, policyTerm: 100,
    collaborationTodo: 300, collaborationComment: 1000, checkoutNote: 100,
    reviewReason: 1000, reportReason: 2000, imageUrl: 2048,
    parkMetadata: 500, parkArea: 60, parkRide: 100, communityPassword: 128,
});

// Match HTML maxLength and JS backend validation (UTF-16 code units).
// This is conservative for Firestore string limits; never truncate saved values.
export function textLengthError(value, maximum, label = 'Text', minimum = 0) {
    const length = String(value ?? '').length;
    if (length > maximum) return label + ' must be ' + maximum + ' characters or fewer.';
    if (length < minimum) return label + ' must be at least ' + minimum + ' characters.';
    return '';
}
