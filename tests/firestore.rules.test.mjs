import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

const PROJECT_ID = "demo-planetcreations-rules";
const COLLABORATION_ID = "rules-collaboration";
const OWNER_ID = "rules-owner";
const MEMBER_ID = "rules-member";
const OUTSIDER_ID = "rules-outsider";
const MODERATOR_ID = "rules-moderator";
const ADMIN_ID = "rules-admin";
const PUBLISHED_CREATION_ID = "rules-published-creation";
const COMMUNITY_ID = "rules-community";

const emulatorAddress =
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const separatorIndex = emulatorAddress.lastIndexOf(":");
const emulatorHost = emulatorAddress.slice(0, separatorIndex);
const emulatorPort = Number(emulatorAddress.slice(separatorIndex + 1));

let testEnvironment;

function collaborationPath(...segments) {
  return ["collaborations", COLLABORATION_ID, ...segments].join("/");
}

function authenticatedFirestore(uid, tokenOptions = {}) {
  return testEnvironment.authenticatedContext(uid, tokenOptions).firestore();
}

async function seedCollaboration() {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const batch = writeBatch(db);

    batch.set(doc(db, collaborationPath()), {
      title: "Rules Test Collaboration",
      description: "Private collaboration used by the rules test suite.",
      game: "planet-coaster-2",
      status: "active",
      visibility: "unlisted",
      joinMode: "invite",
      inviteCode: "RULES001",
      ownerId: OWNER_ID,
      memberIds: [OWNER_ID, MEMBER_ID],
      updatedAt: 1,
      currentVersion: {
        versionId: "version-1",
        number: 1,
        storageKey: `${collaborationPath("versions", "version-1")}.PlanetCreations`,
      },
      latestChangelog: {
        entryId: "changelog-1",
        userId: OWNER_ID,
        hasSave: true,
        versionId: "version-1",
        versionNumber: 1,
      },
    });
    batch.set(doc(db, collaborationPath("members", OWNER_ID)), {
      role: "owner",
      username: "RulesOwner",
      publishConsent: { agreed: true, at: 1 },
    });
    batch.set(doc(db, collaborationPath("members", MEMBER_ID)), {
      role: "editor",
      username: "RulesMember",
      publishConsent: { agreed: true, at: 1 },
    });
    batch.set(doc(db, collaborationPath("files", "save")), {
      name: "Rules-Test.park2",
      latestVersionNumber: 1,
      currentVersion: {
        versionId: "version-1",
        number: 1,
        storageKey: `${collaborationPath("versions", "version-1")}.PlanetCreations`,
      },
    });
    batch.set(
      doc(db, collaborationPath("files", "save", "versions", "version-1")),
      {
        versionNumber: 1,
        uploadedBy: OWNER_ID,
        storageKey: `${collaborationPath("versions", "version-1")}.PlanetCreations`,
        isCurrentVersion: true,
      },
    );
    batch.set(doc(db, collaborationPath("uploads", "changelog-1")), {
      kind: "version",
      userId: OWNER_ID,
      versionId: "version-1",
      versionNumber: 1,
      hasSave: true,
      status: "complete",
    });
    batch.set(doc(db, `creations/${PUBLISHED_CREATION_ID}`), {
      title: "Published Collaboration",
      description: "A published rules fixture.",
      game: "planet-coaster-2",
      category: "Parks",
      status: "finished",
      platform: "pc",
      tags: ["collaboration"],
      userId: OWNER_ID,
      contributors: [
        { uid: OWNER_ID, username: "RulesOwner" },
        { uid: MEMBER_ID, username: "RulesMember" },
      ],
      contributorIds: [OWNER_ID, MEMBER_ID],
      sourceCollaborationId: COLLABORATION_ID,
      sourceCollaborationTitle: "Rules Test Collaboration",
      sourceCollaborationVersionId: "version-1",
      backupObjectKey:
        `creation-backups/${OWNER_ID}/${PUBLISHED_CREATION_ID}/version-1.PlanetCreations`,
      backupStorageProvider: "cloudflare-r2",
      backupIsSigned: true,
      verifiedGameMetadata: {
        schemaVersion: 1,
        source: "server-verified-backup",
        payloadSha256: "a".repeat(64),
        metadata: {kind: "park", name: "Verified Park"},
      },
      createdAt: 1,
      updatedAt: 1,
      likes: 0,
    });

    await batch.commit();
  });
}

async function seedCommunity() {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "communitys", COMMUNITY_ID), {
      name: "Rules Test Community",
      description: "Community used by the partner-status rules tests.",
      ownerId: OWNER_ID,
      isPartner: false,
    });
  });
}

before(async () => {
  const rules = await readFile(
    new URL("../firestore.rules", import.meta.url),
    "utf8",
  );
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: emulatorHost,
      port: emulatorPort,
      rules,
    },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await seedCollaboration();
  await seedCommunity();
});

after(async () => {
  await testEnvironment.cleanup();
});

describe("collaboration Firestore rules", { concurrency: false }, () => {
  test("members can read while outsiders and signed-out users cannot", async () => {
    const memberDb = authenticatedFirestore(MEMBER_ID);
    const outsiderDb = authenticatedFirestore(OUTSIDER_ID);
    const signedOutDb = testEnvironment.unauthenticatedContext().firestore();

    const memberSnapshot = await assertSucceeds(
      getDoc(doc(memberDb, collaborationPath())),
    );
    assert.equal(memberSnapshot.data().title, "Rules Test Collaboration");
    await assertFails(getDoc(doc(outsiderDb, collaborationPath())));
    await assertFails(getDoc(doc(signedOutDb, collaborationPath())));
  });

  test("clients cannot create collaborations or forge owner membership", async () => {
    const outsiderDb = authenticatedFirestore(OUTSIDER_ID);

    await assertFails(setDoc(doc(outsiderDb, "collaborations/forged"), {
      title: "Forged",
      ownerId: OUTSIDER_ID,
      memberIds: [OUTSIDER_ID],
    }));
    await assertFails(setDoc(
      doc(outsiderDb, collaborationPath("members", OUTSIDER_ID)),
      { role: "owner", username: "RulesOutsider" },
    ));
  });

  test("an outsider cannot add themselves to memberIds", async () => {
    const outsiderDb = authenticatedFirestore(OUTSIDER_ID);

    await assertFails(updateDoc(doc(outsiderDb, collaborationPath()), {
      memberIds: [OWNER_ID, MEMBER_ID, OUTSIDER_ID],
    }));
  });

  test("all collaboration role mutations are server-only", async () => {
    const memberDb = authenticatedFirestore(MEMBER_ID);
    const ownerDb = authenticatedFirestore(OWNER_ID);

    await assertFails(updateDoc(
      doc(memberDb, collaborationPath("members", MEMBER_ID)),
      { role: "owner" },
    ));
    await assertFails(updateDoc(
      doc(ownerDb, collaborationPath("members", MEMBER_ID)),
      { role: "owner" },
    ));
    await assertFails(updateDoc(
      doc(ownerDb, collaborationPath("members", MEMBER_ID)),
      { role: "viewer" },
    ));
  });

  test("membership consent is immutable through role-management writes", async () => {
    const ownerDb = authenticatedFirestore(OWNER_ID);

    await assertFails(updateDoc(
      doc(ownerDb, collaborationPath("members", MEMBER_ID)),
      { publishConsent: { agreed: false, at: 2 } },
    ));
  });

  test("all membership removals are server-only", async () => {
    const memberDb = authenticatedFirestore(MEMBER_ID);
    const memberLeave = writeBatch(memberDb);
    memberLeave.delete(doc(memberDb, collaborationPath("members", MEMBER_ID)));
    memberLeave.update(doc(memberDb, collaborationPath()), {
      memberIds: [OWNER_ID],
    });
    await assertFails(memberLeave.commit());

    const ownerDb = authenticatedFirestore(OWNER_ID);
    await assertFails(deleteDoc(
      doc(ownerDb, collaborationPath("members", OWNER_ID)),
    ));

    const ownerRemoval = writeBatch(ownerDb);
    ownerRemoval.delete(doc(ownerDb, collaborationPath("members", MEMBER_ID)));
    ownerRemoval.update(doc(ownerDb, collaborationPath()), {
      memberIds: [OWNER_ID],
    });
    await assertFails(ownerRemoval.commit());
  });

  test("direct collaboration version pointers remain server-only", async () => {
    const ownerDb = authenticatedFirestore(OWNER_ID);
    const memberDb = authenticatedFirestore(MEMBER_ID);

    await assertFails(updateDoc(doc(ownerDb, collaborationPath()), {
      currentVersion: { versionId: "forged", number: 999 },
    }));
    await assertFails(updateDoc(doc(memberDb, collaborationPath()), {
      latestChangelog: {
        entryId: "forged",
        userId: MEMBER_ID,
        hasSave: true,
        versionId: "forged",
        versionNumber: 999,
      },
    }));
  });

  test("file and version metadata can only be written by server code", async () => {
    const ownerDb = authenticatedFirestore(OWNER_ID);
    const moderatorDb = authenticatedFirestore(MODERATOR_ID, {
      role: "moderator",
    });
    const fileRef = doc(ownerDb, collaborationPath("files", "save"));
    const versionRef = doc(
      ownerDb,
      collaborationPath("files", "save", "versions", "version-1"),
    );

    await assertFails(updateDoc(fileRef, { latestVersionNumber: 999 }));
    await assertFails(updateDoc(versionRef, { storageKey: "forged" }));
    await assertFails(setDoc(
      doc(ownerDb, collaborationPath("files", "save", "versions", "forged")),
      { versionNumber: 999, storageKey: "forged" },
    ));
    await assertFails(deleteDoc(versionRef));
    await assertFails(updateDoc(
      doc(moderatorDb, collaborationPath("files", "save")),
      { latestVersionNumber: 999 },
    ));
  });

  test("upload and changelog entries cannot be forged by clients", async () => {
    const memberDb = authenticatedFirestore(MEMBER_ID);
    const moderatorDb = authenticatedFirestore(MODERATOR_ID, {
      role: "moderator",
    });

    await assertFails(setDoc(
      doc(memberDb, collaborationPath("uploads", "forged")),
      {
        kind: "version",
        userId: MEMBER_ID,
        versionId: "forged",
        versionNumber: 999,
        hasSave: true,
      },
    ));
    await assertFails(updateDoc(
      doc(moderatorDb, collaborationPath("uploads", "changelog-1")),
      { versionNumber: 999 },
    ));
  });

  test("all top-level collaboration mutations are server-only", async () => {
    const ownerDb = authenticatedFirestore(OWNER_ID);

    await assertFails(updateDoc(doc(ownerDb, collaborationPath()), {
      inviteCode: "RULES002",
      updatedAt: 2,
    }));
    await assertFails(updateDoc(doc(ownerDb, collaborationPath()), {
      title: "Direct client settings write",
      updatedAt: 3,
    }));
  });

  test("invitation grants and deprecated invite copies are server-only", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      const batch = writeBatch(adminDb);
      batch.set(doc(
        adminDb,
        `collaborationInvitationGrants/${COLLABORATION_ID}--${MEMBER_ID}`,
      ), {
        collaborationId: COLLABORATION_ID,
        targetUserId: MEMBER_ID,
        role: "editor",
        status: "pending",
      });
      batch.set(doc(
        adminDb,
        collaborationPath("invitations", "legacy-invite"),
      ), {
        targetUserId: MEMBER_ID,
        role: "editor",
        status: "pending",
      });
      batch.set(doc(
        adminDb,
        `users/${MEMBER_ID}/collaborationInvites/legacy-invite`,
      ), {
        collaborationId: COLLABORATION_ID,
        targetUserId: MEMBER_ID,
        role: "editor",
        status: "pending",
      });
      await batch.commit();
    });

    const memberDb = authenticatedFirestore(MEMBER_ID);
    const ownerDb = authenticatedFirestore(OWNER_ID);
    const grantPath =
      `collaborationInvitationGrants/${COLLABORATION_ID}--${MEMBER_ID}`;
    await assertFails(getDoc(doc(memberDb, grantPath)));
    await assertFails(getDoc(doc(ownerDb, grantPath)));
    await assertFails(getDoc(doc(
      memberDb,
      collaborationPath("invitations", "legacy-invite"),
    )));
    await assertFails(getDoc(doc(
      memberDb,
      `users/${MEMBER_ID}/collaborationInvites/legacy-invite`,
    )));
    await assertFails(setDoc(doc(
      memberDb,
      `collaborationInvitationGrants/${COLLABORATION_ID}--forged`,
    ), {
      collaborationId: COLLABORATION_ID,
      targetUserId: MEMBER_ID,
      role: "owner",
      status: "pending",
    }));
  });

  test("completed collaborations reject direct project mutations", async () => {
    const memberDb = authenticatedFirestore(MEMBER_ID);
    await assertSucceeds(setDoc(
      doc(memberDb, collaborationPath("todos", "active-todo")),
      {
        text: "Allowed while active",
        createdBy: MEMBER_ID,
        completed: false,
      },
    ));
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), collaborationPath()), {
        status: "completed",
      });
    });
    await assertFails(setDoc(
      doc(memberDb, collaborationPath("todos", "completed-todo")),
      {
        text: "Must stay read-only",
        createdBy: MEMBER_ID,
        completed: false,
      },
    ));
  });

  test("clients cannot forge collaboration publication credits", async () => {
    const ownerDb = authenticatedFirestore(OWNER_ID);
    await assertFails(setDoc(doc(ownerDb, "creations/forged-credit"), {
      title: "Forged credit",
      game: "planet-coaster-2",
      category: "Parks",
      userId: OWNER_ID,
      tags: ["collaboration"],
      contributors: [{ uid: OUTSIDER_ID, username: "Forged" }],
      contributorIds: [OUTSIDER_ID],
      sourceCollaborationId: COLLABORATION_ID,
    }));
  });

  test("published credits stay immutable while normal owner edits work", async () => {
    const ownerDb = authenticatedFirestore(OWNER_ID);
    const creationRef = doc(
      ownerDb,
      `creations/${PUBLISHED_CREATION_ID}`,
    );
    await assertSucceeds(updateDoc(creationRef, {
      title: "Edited published title",
    }));
    await assertFails(updateDoc(creationRef, {
      contributors: [{ uid: OWNER_ID, username: "RulesOwner" }],
      contributorIds: [OWNER_ID],
    }));
    await assertFails(updateDoc(creationRef, {
      sourceCollaborationId: null,
    }));
  });

  test("verified game metadata can only be written by server code", async () => {
    const ownerDb = authenticatedFirestore(OWNER_ID);
    const moderatorDb = authenticatedFirestore(MODERATOR_ID, {
      role: "moderator",
    });
    const verifiedGameMetadata = {
      schemaVersion: 1,
      source: "server-verified-backup",
      payloadSha256: "b".repeat(64),
      metadata: {kind: "blueprint", name: "Forged Blueprint"},
    };

    await assertFails(setDoc(doc(ownerDb, "creations/forged-metadata"), {
      title: "Forged metadata",
      game: "planet-coaster-2",
      category: "Blueprints",
      userId: OWNER_ID,
      tags: ["blueprint"],
      verifiedGameMetadata,
    }));
    await assertFails(updateDoc(
      doc(ownerDb, `creations/${PUBLISHED_CREATION_ID}`),
      {verifiedGameMetadata},
    ));
    await assertFails(updateDoc(
      doc(moderatorDb, `creations/${PUBLISHED_CREATION_ID}`),
      {verifiedGameMetadata},
    ));
    await assertFails(updateDoc(
      doc(ownerDb, `creations/${PUBLISHED_CREATION_ID}`),
      {rideAnalysisObjectKey: `creation-ride-analysis/${OWNER_ID}/${PUBLISHED_CREATION_ID}/forged.pcra`},
    ));
  });

  test("owners can edit bounded park ride presentation settings", async () => {
    const ownerDb = authenticatedFirestore(OWNER_ID);
    const creationRef = doc(ownerDb, `creations/${PUBLISHED_CREATION_ID}`);
    await assertSucceeds(updateDoc(creationRef, {
      parkRidePresentation: {
        version: 1,
        areas: [{id: "area-harbor", name: "Harbor", color: "#2563EB"}],
        customRides: [{id: "custom-laser", name: "Laser Show", rideCategoryKey: "dark-ride"}],
        hiddenRideKeys: ["save-hidden-0"],
        rideAreaAssignments: {"custom-laser": "area-harbor"},
        rideEfnOverrides: {
          "custom-laser": {excitement: 5.5, fear: 2.1, nausea: 0.4},
        },
        rideDisplayNames: {"custom-laser": "Harbor Laser Show"},
      },
    }));
    await assertFails(updateDoc(creationRef, {
      parkRidePresentation: {
        version: 1,
        areas: [],
        customRides: [],
        hiddenRideKeys: Array.from({length: 501}, (_, index) => `ride-${index}`),
        rideAreaAssignments: {},
        rideEfnOverrides: {},
        rideDisplayNames: {},
      },
    }));
    await assertFails(updateDoc(creationRef, {
      parkRidePresentation: {
        version: 1,
        areas: [],
        customRides: [],
        hiddenRideKeys: [],
        rideAreaAssignments: {},
        rideEfnOverrides: "not-a-map",
        rideDisplayNames: {},
      },
    }));
  });

  test("only staff can directly delete a published collaboration creation", async () => {
    const ownerDb = authenticatedFirestore(OWNER_ID);
    const moderatorDb = authenticatedFirestore(MODERATOR_ID, {
      role: "moderator",
    });
    await assertFails(deleteDoc(doc(
      ownerDb,
      `creations/${PUBLISHED_CREATION_ID}`,
    )));
    await assertSucceeds(deleteDoc(doc(
      moderatorDb,
      `creations/${PUBLISHED_CREATION_ID}`,
    )));
  });
});

describe("community partner-status Firestore rules", { concurrency: false }, () => {
  test("only admins can change an existing community's partner status", async () => {
    const ownerDb = authenticatedFirestore(OWNER_ID);
    const moderatorDb = authenticatedFirestore(MODERATOR_ID, {
      role: "moderator",
    });
    const adminDb = authenticatedFirestore(ADMIN_ID, { role: "admin" });
    const communityRef = db => doc(db, "communitys", COMMUNITY_ID);

    await assertSucceeds(updateDoc(communityRef(ownerDb), {
      description: "The owner can still edit normal community fields.",
    }));
    await assertFails(updateDoc(communityRef(ownerDb), { isPartner: true }));
    await assertFails(updateDoc(communityRef(moderatorDb), { isPartner: true }));
    await assertSucceeds(updateDoc(communityRef(adminDb), { isPartner: true }));

    const snapshot = await getDoc(communityRef(adminDb));
    assert.equal(snapshot.data().isPartner, true);
  });

  test("non-admin creators cannot mark a new community as a partner", async () => {
    const moderatorDb = authenticatedFirestore(MODERATOR_ID, {
      role: "moderator",
    });
    const adminDb = authenticatedFirestore(ADMIN_ID, { role: "admin" });

    await assertFails(setDoc(doc(moderatorDb, "communitys", "forged-partner"), {
      name: "Forged Partner Community",
      ownerId: MODERATOR_ID,
      isPartner: true,
    }));
    await assertSucceeds(setDoc(doc(adminDb, "communitys", "admin-partner"), {
      name: "Admin Partner Community",
      ownerId: ADMIN_ID,
      isPartner: true,
    }));
  });
});

describe("YouTube video index Firestore rules", { concurrency: false }, () => {
  test("everyone can read index state and shards", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, "youtubeVideoIndexState", "current"), {
        headShardId: "000001",
      });
      await setDoc(doc(adminDb, "youtubeVideoIndexShards", "000001"), {
        c: {},
        p: null,
      });
    });

    const anonymousDb = testEnvironment.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(
      anonymousDb,
      "youtubeVideoIndexState",
      "current",
    )));
    await assertSucceeds(getDoc(doc(
      anonymousDb,
      "youtubeVideoIndexShards",
      "000001",
    )));
  });

  test("even authenticated admins cannot write server-owned index data", async () => {
    const adminDb = authenticatedFirestore(ADMIN_ID, { role: "admin" });
    await assertFails(setDoc(doc(
      adminDb,
      "youtubeVideoIndexState",
      "current",
    ), {headShardId: "forged"}));
    await assertFails(setDoc(doc(
      adminDb,
      "youtubeVideoIndexShards",
      "000001",
    ), {c: {forged: true}}));
    await assertFails(setDoc(doc(
      adminDb,
      "youtubeChannelSubscriptions",
      "forged",
    ), {secret: "stolen"}));
  });
});

describe("live stream session Firestore rules", { concurrency: false }, () => {
  test("session state remains server-only even for its owner and admins", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "liveSessions", OWNER_ID), {
        uid: OWNER_ID,
        sessionId: "server-session",
        status: "active",
        creationId: "owned-creation",
      });
      await setDoc(doc(context.firestore(), "liveChannelClaims", "channel-claim"), {
        uid: OWNER_ID,
        sessionId: "server-session",
        platform: "twitch",
      });
    });

    for (const clientDb of [
      authenticatedFirestore(OWNER_ID),
      authenticatedFirestore(ADMIN_ID, {role: "admin"}),
    ]) {
      await assertFails(getDoc(doc(clientDb, "liveSessions", OWNER_ID)));
      await assertFails(setDoc(doc(clientDb, "liveSessions", OWNER_ID), {
        uid: OWNER_ID,
        sessionId: "forged-session",
        status: "active",
        creationId: "foreign-creation",
      }));
      await assertFails(getDoc(doc(clientDb, "liveChannelClaims", "channel-claim")));
      await assertFails(setDoc(doc(clientDb, "liveChannelClaims", "channel-claim"), {
        uid: OWNER_ID,
        sessionId: "forged-session",
        platform: "twitch",
      }));
    }
  });
});

describe("scalable map-index Firestore rules", { concurrency: false }, () => {
  const publicCollections = [
    ["searchIndexState", "planet-coaster-2"],
    ["searchIndexShards", "game-shard"],
    ["communitySearchIndexState", COMMUNITY_ID],
    ["communitySearchIndexShards", "community-shard"],
    ["userSearchIndexState", "all"],
    ["userSearchIndexShards", "user-shard"],
    ["showcaseIndexState", "showcase-id"],
    ["showcaseIndexShards", "showcase-shard"],
  ];

  test("anonymous clients can read every public state and shard family", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await Promise.all(publicCollections.map(([collectionName, documentId]) =>
        setDoc(doc(context.firestore(), collectionName, documentId), {
          e: {},
          shardIds: [],
        })));
    });
    const anonymousDb = testEnvironment.unauthenticatedContext().firestore();
    await Promise.all(publicCollections.map(([collectionName, documentId]) =>
      assertSucceeds(getDoc(doc(anonymousDb, collectionName, documentId)))));
  });

  test("even admin clients cannot mutate public shards or private locations", async () => {
    const adminDb = authenticatedFirestore(ADMIN_ID, {role: "admin"});
    await Promise.all(publicCollections.map(([collectionName, documentId]) =>
      assertFails(setDoc(doc(adminDb, collectionName, documentId), {
        e: {forged: true},
      }))));
    for (const collectionName of [
      "searchIndexLocations",
      "communitySearchIndexLocations",
      "userSearchIndexLocations",
      "showcaseIndexLocations",
    ]) {
      await assertFails(setDoc(doc(adminDb, collectionName, "forged"), {
        shardId: "forged",
      }));
    }
  });
});

describe("event submission Firestore rules", { concurrency: false }, () => {
  test("owners and moderators cannot bypass the atomic submission callable", async () => {
    for (const clientDb of [
      authenticatedFirestore(OWNER_ID),
      authenticatedFirestore(MODERATOR_ID, {role: "moderator"}),
    ]) {
      await assertFails(updateDoc(
        doc(clientDb, "creations", PUBLISHED_CREATION_ID),
        {
          eventIds: ["rules-event"],
          eventSubmissions: {"rules-event": {}},
        },
      ));
      await assertFails(setDoc(
        doc(clientDb, "events", "rules-event", "submissionClaims", OWNER_ID),
        {creationIds: [PUBLISHED_CREATION_ID], count: 1},
      ));
    }
  });

  test("a new creation cannot forge an initial event submission", async () => {
    const ownerDb = authenticatedFirestore(OWNER_ID);
    await assertFails(setDoc(doc(ownerDb, "creations", "forged-submission"), {
      category: "Coaster",
      eventIds: ["rules-event"],
      eventSubmissions: {"rules-event": {}},
      game: "planet-coaster-2",
      tags: ["wooden"],
      title: "Forged Event Submission",
      userId: OWNER_ID,
    }));
  });
});

describe("content report Firestore rules", { concurrency: false }, () => {
  test("users can submit a bounded generic content report and moderators can read it", async () => {
    const reporterDb = authenticatedFirestore(OWNER_ID);
    const moderatorDb = authenticatedFirestore(MODERATOR_ID, {role: "moderator"});
    const reportRef = doc(reporterDb, "reports", "event-report");
    await assertSucceeds(setDoc(reportRef, {
      markerId: "event%3Arules-event",
      reason: "This event contains inappropriate user-generated content.",
      reporterId: OWNER_ID,
      targetId: "rules-event",
      targetPath: "/event/rules-event",
      targetTitle: "Event content",
      targetType: "event",
      timestamp: serverTimestamp(),
    }));
    await assertFails(getDoc(reportRef));
    await assertSucceeds(getDoc(doc(moderatorDb, "reports", "event-report")));
  });

  test("reports reject forged reporters, unknown target types and extra fields", async () => {
    const reporterDb = authenticatedFirestore(OWNER_ID);
    const baseReport = {
      reason: "A sufficiently clear moderation reason.",
      reporterId: OWNER_ID,
      targetId: "rules-event",
      targetType: "event",
      timestamp: serverTimestamp(),
    };
    await assertFails(setDoc(doc(reporterDb, "reports", "forged-reporter"), {
      ...baseReport,
      reporterId: OUTSIDER_ID,
    }));
    await assertFails(setDoc(doc(reporterDb, "reports", "unknown-target"), {
      ...baseReport,
      targetType: "arbitrary-collection",
    }));
    await assertFails(setDoc(doc(reporterDb, "reports", "extra-field"), {
      ...baseReport,
      moderatorDecision: "forged",
    }));
  });
});
