"use strict";

const SAFE_CONTRIBUTOR_ID = /^[A-Za-z0-9_-]{1,128}$/;

function normalizeContributor(value) {
    const uid = typeof value?.uid === "string" ? value.uid.trim() : "";
    const username = typeof value?.username === "string" ?
        value.username.trim().slice(0, 30) : "";
    if (!SAFE_CONTRIBUTOR_ID.test(uid)) return null;
    return {uid, username: username || "Unknown contributor"};
}

function mergeCollaborationContributors(...sources) {
    const contributors = new Map();
    sources.flat().forEach((candidate) => {
        const contributor = normalizeContributor(candidate);
        if (!contributor) return;
        const existing = contributors.get(contributor.uid);
        if (!existing || existing.username === "Unknown contributor") {
            contributors.set(contributor.uid, contributor);
        }
    });
    return [...contributors.values()];
}

function hasAllMemberPublishConsent(memberIds, members) {
    const membersById = new Map((members || []).map((member) => [
        member.uid,
        member,
    ]));
    const activeMemberIds = [...new Set(memberIds || [])];
    return activeMemberIds.length > 0 && activeMemberIds.every((uid) =>
        membersById.get(uid)?.publishConsent?.agreed === true);
}

function getCollaborationRevokeVoteState(
    memberIds,
    existingVoterIds,
    nextVoterId = null,
) {
    const activeMemberIds = [...new Set((memberIds || []).filter((uid) =>
        typeof uid === "string" && uid))];
    const activeMemberSet = new Set(activeMemberIds);
    const voterIds = [...new Set([
        ...(existingVoterIds || []),
        nextVoterId,
    ].filter((uid) => activeMemberSet.has(uid)))];
    return {
        voterIds,
        voteCount: voterIds.length,
        requiredCount: activeMemberIds.length,
        unanimous: activeMemberIds.length > 0 &&
            voterIds.length === activeMemberIds.length,
    };
}

function selectCollaborationPublicationCategory(fileKind, categoryNames) {
    const categories = (categoryNames || [])
        .filter((category) => typeof category === "string" && category.trim())
        .map((category) => category.trim());
    const preferredPattern = fileKind === "blueprint" ?
        /blueprint/i :
        fileKind === "autosave" ? /auto.?save/i : /park|zoo/i;
    return categories.find((category) => preferredPattern.test(category)) ||
        categories[0] ||
        "Collaboration";
}

module.exports = {
    getCollaborationRevokeVoteState,
    hasAllMemberPublishConsent,
    mergeCollaborationContributors,
    normalizeContributor,
    selectCollaborationPublicationCategory,
};
