const admin = require("../functions/node_modules/firebase-admin");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "demo-planetcreations";
const FIRESTORE_HOST =
    process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const AUTH_HOST =
    process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;

admin.initializeApp({ projectId: PROJECT_ID });

const db = admin.firestore();
const auth = admin.auth();
const Timestamp = admin.firestore.Timestamp;

const USERS = [
    {
        uid: "e2e-owner",
        email: "owner@example.test",
        password: "Owner-E2E-2026!",
        username: "OwnerE2E",
    },
    {
        uid: "e2e-builder",
        email: "builder@example.test",
        password: "Builder-E2E-2026!",
        username: "BuilderE2E",
    },
    {
        uid: "e2e-visitor",
        email: "visitor@example.test",
        password: "Visitor-E2E-2026!",
        username: "VisitorE2E",
    },
];

const COLLABORATION_ID = "e2e-collaboration";
const UNLISTED_COLLABORATION_ID = "e2e-unlisted";

const minutesAgo = (minutes) =>
    Timestamp.fromMillis(Date.now() - minutes * 60 * 1000);

async function resetEmulators() {
    const firestoreResponse = await fetch(
        `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}` +
        "/databases/(default)/documents",
        { method: "DELETE" },
    );
    if (!firestoreResponse.ok) {
        throw new Error(
            `Could not reset Firestore emulator: ${firestoreResponse.status}`,
        );
    }

    const authResponse = await fetch(
        `http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`,
        { method: "DELETE" },
    );
    if (!authResponse.ok) {
        throw new Error(
            `Could not reset Auth emulator: ${authResponse.status}`,
        );
    }
}

function memberData(role, username) {
    return {
        role,
        username,
        joinedAt: minutesAgo(180),
        publishConsent: {
            agreed: true,
            at: minutesAgo(180),
        },
    };
}

async function seedUsers(batch) {
    for (const user of USERS) {
        await auth.createUser({
            uid: user.uid,
            email: user.email,
            emailVerified: true,
            password: user.password,
            displayName: user.username,
        });
        batch.set(db.doc(`users/${user.uid}`), {
            role: "user",
            createdAt: minutesAgo(240),
        });
        batch.set(db.doc(`profiles/${user.uid}`), {
            username: user.username,
            username_lowercase: user.username.toLowerCase(),
            role: "user",
            bio: "",
            country: "",
            profilePictureUrl: "",
            profileBannerUrl: "",
            profileMobileBannerUrl: "",
            favoriteGame: "planet-coaster-2",
            ownedDlcs: {},
            needsProfileSetup: false,
        });
        batch.set(db.doc(`usernames/${user.username.toLowerCase()}`), {
            email: user.email,
        });
        batch.set(db.doc(`users/${user.uid}/meta/inbox`), {
            items: [],
            unreadCount: 0,
            prefs: {},
            pushTokens: [],
        });
    }
}

function versionData({
    id,
    number,
    userId,
    username,
    uploadedAt,
    changelogEntryId,
    isCurrentVersion,
}) {
    return {
        versionNumber: number,
        uploadedBy: userId,
        uploadedByUsername: username,
        uploadedAt,
        sizeBytes: 4_194_304 + number,
        storageKey:
            `collaborations/${COLLABORATION_ID}/versions/${id}` +
            ".PlanetCreations",
        originalFileName: "E2E-Coaster.park2",
        fileKind: "park",
        packageId: `e2e-package-${number}`,
        note: number === 1 ? "Initial save" : "Finished the station roof",
        changelogEntryId,
        buildEndedAt: uploadedAt,
        isCurrentVersion,
    };
}

async function seedPublicCollaboration(batch) {
    const owner = USERS[0];
    const builder = USERS[1];
    const createdAt = minutesAgo(180);
    const versionOneAt = minutesAgo(180);
    const versionTwoAt = minutesAgo(25);
    const currentVersion = {
        versionId: "e2e-version-2",
        number: 2,
        uploadedBy: builder.uid,
        uploadedByUsername: builder.username,
        uploadedAt: versionTwoAt,
        sizeBytes: 4_194_306,
        originalFileName: "E2E-Coaster.park2",
        note: "Finished the station roof",
        changelogEntryId: "e2e-changelog-2",
        buildEndedAt: versionTwoAt,
    };

    batch.set(db.doc(`collaborations/${COLLABORATION_ID}`), {
        title: "E2E Coaster Team",
        description: "Local multi-user collaboration test project.",
        game: "planet-coaster-2",
        visibility: "public",
        bannerImageUrl: "http://127.0.0.1:3100/logo.png",
        galleryImageUrls: [
            "http://127.0.0.1:3100/android-chrome-512x512.png",
        ],
        ownerId: owner.uid,
        memberIds: [owner.uid, builder.uid],
        createdAt,
        updatedAt: versionTwoAt,
        status: "active",
        joinMode: "invite",
        inviteCode: "E2EJOIN1",
        currentVersion,
        latestChangelog: {
            entryId: "e2e-changelog-2",
            userId: builder.uid,
            username: builder.username,
            createdAt: versionTwoAt,
            hasSave: true,
            versionId: "e2e-version-2",
            versionNumber: 2,
        },
    });
    batch.set(
        db.doc(`collaborations/${COLLABORATION_ID}/members/${owner.uid}`),
        memberData("owner", owner.username),
    );
    batch.set(
        db.doc(`collaborations/${COLLABORATION_ID}/members/${builder.uid}`),
        memberData("editor", builder.username),
    );
    batch.set(db.doc(`collaborations/${COLLABORATION_ID}/files/save`), {
        name: "E2E-Coaster.park2",
        type: "planet-coaster-2",
        updatedAt: versionTwoAt,
        latestVersionNumber: 2,
        currentVersion: {
            ...currentVersion,
            storageKey:
                `collaborations/${COLLABORATION_ID}/versions/` +
                "e2e-version-2.PlanetCreations",
        },
    });
    batch.set(
        db.doc(
            `collaborations/${COLLABORATION_ID}/files/save/versions/` +
            "e2e-version-1",
        ),
        versionData({
            id: "e2e-version-1",
            number: 1,
            userId: owner.uid,
            username: owner.username,
            uploadedAt: versionOneAt,
            changelogEntryId: "e2e-changelog-1",
            isCurrentVersion: false,
        }),
    );
    batch.set(
        db.doc(
            `collaborations/${COLLABORATION_ID}/files/save/versions/` +
            "e2e-version-2",
        ),
        versionData({
            id: "e2e-version-2",
            number: 2,
            userId: builder.uid,
            username: builder.username,
            uploadedAt: versionTwoAt,
            changelogEntryId: "e2e-changelog-2",
            isCurrentVersion: true,
        }),
    );
    batch.set(
        db.doc(
            `collaborations/${COLLABORATION_ID}/uploads/e2e-changelog-1`,
        ),
        {
            kind: "version",
            fileId: "save",
            versionId: "e2e-version-1",
            fileName: "E2E-Coaster.park2",
            userId: owner.uid,
            username: owner.username,
            changelog: "Initial save",
            imageUrls: [],
            completedTodos: [],
            versionNumber: 1,
            sizeBytes: 4_194_305,
            workDurationMinutes: null,
            hasSave: true,
            status: "complete",
            createdAt: versionOneAt,
            updatedAt: versionOneAt,
        },
    );
    batch.set(
        db.doc(
            `collaborations/${COLLABORATION_ID}/uploads/e2e-changelog-2`,
        ),
        {
            kind: "version",
            fileId: "save",
            versionId: "e2e-version-2",
            fileName: "E2E-Coaster.park2",
            userId: builder.uid,
            username: builder.username,
            changelog: "Finished the station roof",
            imageUrls: [
                "http://127.0.0.1:3100/apple-touch-icon-V2.png",
            ],
            completedTodos: [
                {
                    id: "e2e-todo-station",
                    text: "Finish the station roof",
                    completedBy: builder.uid,
                    completedByUsername: builder.username,
                },
            ],
            versionNumber: 2,
            sizeBytes: 4_194_306,
            workDurationMinutes: 42,
            hasSave: true,
            status: "complete",
            createdAt: versionTwoAt,
            updatedAt: versionTwoAt,
        },
    );
    batch.set(
        db.doc(
            `collaborations/${COLLABORATION_ID}/todos/e2e-todo-station`,
        ),
        {
            text: "Finish the station roof",
            completed: true,
            createdBy: owner.uid,
            createdByUsername: owner.username,
            createdAt: minutesAgo(120),
            completedAt: versionTwoAt,
            completedBy: builder.uid,
            completedByUsername: builder.username,
        },
    );
    batch.set(
        db.doc(`collaborations/${COLLABORATION_ID}/todos/e2e-todo-lights`),
        {
            text: "Add platform lighting",
            completed: false,
            createdBy: owner.uid,
            createdByUsername: owner.username,
            createdAt: minutesAgo(20),
            completedAt: null,
            completedBy: null,
            completedByUsername: null,
        },
    );
}

async function seedUnlistedCollaboration(batch) {
    const owner = USERS[0];
    const createdAt = minutesAgo(90);
    batch.set(db.doc(`collaborations/${UNLISTED_COLLABORATION_ID}`), {
        title: "Hidden E2E Workshop",
        description: "Findable by share code, not listed publicly.",
        game: "planet-zoo",
        visibility: "unlisted",
        bannerImageUrl: null,
        galleryImageUrls: [],
        ownerId: owner.uid,
        memberIds: [owner.uid],
        createdAt,
        updatedAt: createdAt,
        status: "active",
        joinMode: "invite",
        inviteCode: "E2EHIDE1",
        currentVersion: {
            versionId: "e2e-hidden-version-1",
            number: 1,
            uploadedBy: owner.uid,
            uploadedByUsername: owner.username,
            uploadedAt: createdAt,
            sizeBytes: 1_048_576,
            originalFileName: "Hidden-Zoo.zoo",
            note: "Initial save",
            changelogEntryId: "e2e-hidden-changelog-1",
            buildEndedAt: createdAt,
        },
        latestChangelog: {
            entryId: "e2e-hidden-changelog-1",
            userId: owner.uid,
            username: owner.username,
            createdAt,
            hasSave: true,
            versionId: "e2e-hidden-version-1",
            versionNumber: 1,
        },
    });
    batch.set(
        db.doc(
            `collaborations/${UNLISTED_COLLABORATION_ID}/members/${owner.uid}`,
        ),
        memberData("owner", owner.username),
    );
}

async function main() {
    await resetEmulators();
    const batch = db.batch();
    await seedUsers(batch);
    await seedPublicCollaboration(batch);
    await seedUnlistedCollaboration(batch);
    await batch.commit();

    console.log(JSON.stringify({
        projectId: PROJECT_ID,
        collaborationId: COLLABORATION_ID,
        publicInviteCode: "E2EJOIN1",
        unlistedInviteCode: "E2EHIDE1",
        users: USERS.map(({ uid, email, password, username }) => ({
            uid,
            email,
            password,
            username,
        })),
    }, null, 2));
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await admin.app().delete();
    });
