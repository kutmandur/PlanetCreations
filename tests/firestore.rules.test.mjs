import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  arrayRemove,
  deleteDoc,
  doc,
  getDoc,
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

    await batch.commit();
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

  test("members cannot promote themselves or be promoted to owner", async () => {
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
    await assertSucceeds(updateDoc(
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

  test("a member can leave atomically but the owner cannot orphan the project", async () => {
    const memberDb = authenticatedFirestore(MEMBER_ID);
    const memberLeave = writeBatch(memberDb);
    memberLeave.delete(doc(memberDb, collaborationPath("members", MEMBER_ID)));
    memberLeave.update(doc(memberDb, collaborationPath()), {
      memberIds: arrayRemove(MEMBER_ID),
    });
    await assertSucceeds(memberLeave.commit());

    await seedCollaboration();
    const ownerDb = authenticatedFirestore(OWNER_ID);
    await assertFails(deleteDoc(
      doc(ownerDb, collaborationPath("members", OWNER_ID)),
    ));

    const ownerRemoval = writeBatch(ownerDb);
    ownerRemoval.delete(doc(ownerDb, collaborationPath("members", MEMBER_ID)));
    ownerRemoval.update(doc(ownerDb, collaborationPath()), {
      memberIds: arrayRemove(MEMBER_ID),
    });
    await assertSucceeds(ownerRemoval.commit());
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

  test("legacy owner operations do not open server-managed metadata", async () => {
    const ownerDb = authenticatedFirestore(OWNER_ID);

    await assertSucceeds(updateDoc(doc(ownerDb, collaborationPath()), {
      inviteCode: "RULES002",
      updatedAt: 2,
    }));
    await assertFails(updateDoc(doc(ownerDb, collaborationPath()), {
      title: "Direct client settings write",
      updatedAt: 3,
    }));
  });
});
