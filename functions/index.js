const functions = require("firebase-functions");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");
const crypto = require("crypto");
const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    CopyObjectCommand,
    DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const {
    MAX_BACKUP_SIZE_BYTES,
    buildSignedMetadata,
    validateUnsignedMetadata,
    validateUnsignedMediaMetadata,
    validateCreationArchive,
} = require("./backupFormat");

admin.initializeApp();
const db = admin.firestore();

// Shared notification fan-out (inbox doc + web push)
const { notifyUser } = require("./notify");

// --- Cloudflare R2 (S3-kompatibel) ---
// Lazy-Initialisierung: fehlende Konfiguration darf den Modul-Load nicht crashen,
// sonst sterben ALLE Functions in dieser Datei beim Cold Start.
let s3Instance = null;
function getS3() {
    if (!s3Instance) {
        const accountId = process.env.R2_ACCOUNT_ID;
        const jurisdiction = process.env.R2_JURISDICTION;
        const accessKeyId = r2AccessKeyId.value();
        const secretAccessKey = r2SecretAccessKey.value();
        if (!accountId || !accessKeyId || !secretAccessKey || !process.env.R2_BUCKET_NAME) {
            throw new Error("Cloudflare R2 is not configured.");
        }
        const endpointAccount = jurisdiction ? `${accountId}.${jurisdiction}` : accountId;
        s3Instance = new S3Client({
            endpoint: `https://${endpointAccount}.r2.cloudflarestorage.com`,
            region: "auto",
            credentials: { accessKeyId, secretAccessKey },
        });
    }
    return s3Instance;
}
const getR2Bucket = () => process.env.R2_BUCKET_NAME;

async function r2BodyToBuffer(body) {
    if (!body) throw new Error("Cloudflare R2 returned an empty object body.");
    if (typeof body.transformToByteArray === "function") {
        return Buffer.from(await body.transformToByteArray());
    }
    const chunks = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
}

// Secrets & Config
// Secrets liegen im Secret Manager (firebase functions:secrets:set <NAME>) und
// werden per runWith({ secrets: [...] }) an die jeweiligen Functions gebunden.
// .value() darf erst innerhalb eines Handlers aufgerufen werden.
const discordClientSecret = defineSecret("DISCORD_CLIENT_SECRET");
const backupSigningKey = defineSecret("BACKUP_SIGNING_KEY");
const r2AccessKeyId = defineSecret("R2_ACCESS_KEY_ID");
const r2SecretAccessKey = defineSecret("R2_SECRET_ACCESS_KEY");
// Nicht-geheime Werte kommen aus functions/.env
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;

const app = express();
app.use(cors({ origin: true }));

// Middleware to authenticate requests
const authenticate = async (req, res, next) => {
    if (!req.headers.authorization || !req.headers.authorization.startsWith('Bearer ')) {
        return res.status(403).send('Unauthorized');
    }
    const idToken = req.headers.authorization.split('Bearer ')[1];
    try {
        const decodedIdToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedIdToken;
        next();
    } catch (e) {
        res.status(403).send('Unauthorized');
    }
};

// --- API Endpoint for signing backups ---
app.post("/signBackup", authenticate, async (req, res) => {
    const unsignedMetadata = req.body.metadata;
    const userId = req.user.uid;
    
    const signingKey = backupSigningKey.value();
    if (!signingKey) {
        console.error("Backup signing key is not configured.");
        return res.status(500).json({ error: "Server configuration error: Signing key is missing." });
    }

    try {
        if (unsignedMetadata?.packageType === "media") {
            validateUnsignedMediaMetadata(unsignedMetadata, ALLOWED_GAME_EXTENSIONS);
        } else {
            validateUnsignedMetadata(unsignedMetadata, ALLOWED_GAME_EXTENSIONS, "creation");
        }
        if (unsignedMetadata.isSigned !== false || unsignedMetadata.signature ||
            unsignedMetadata.signerUid || unsignedMetadata.signerUsername) {
            return res.status(400).json({ error: "Unsigned metadata must not contain signer fields." });
        }

        const profileRef = db.doc(`profiles/${userId}`);
        const profileSnap = await profileRef.get();
        const username = profileSnap.exists ? (profileSnap.data().username || "Unknown User") : "Unknown User";
        const metadata = buildSignedMetadata(
            unsignedMetadata,
            userId,
            username,
            signingKey,
            process.env.BACKUP_SIGNING_KEY_ID || "backup-rsa-2026-01",
        );
        return res.status(200).json({ metadata });
    } catch (error) {
        console.error("Error creating signature:", error);
        return res.status(400).json({ error: error.message || "Could not sign this package." });
    }
});

app.get("/getPublicKey", (req, res) => {
    const publicKey = getPublicKeyFromPrivate(backupSigningKey.value());
    if (!publicKey) return res.status(500).send("Signing key is not configured.");
    res.set("Cache-Control", "public, max-age=3600");
    return res.type("text/plain").send(publicKey);
});

// --- HTTP Endpoint to handle the initial Discord auth redirect ---
app.get("/discordAuthRedirect", (req, res) => {
    const { appUserId } = req.query;
    if (!appUserId) {
        return res.status(400).send("Missing appUserId query parameter.");
    }

    if (!DISCORD_CLIENT_ID || !DISCORD_REDIRECT_URI) {
        console.error("Discord environment variables not set in Firebase config.");
        return res.status(500).send("Server configuration error.");
    }

    const state = appUserId;
    const scope = "identify guilds";

    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=${scope}&state=${state}`;
    
    res.redirect(authUrl);
});

// --- HTTP Endpoint to handle the callback from Discord ---
app.get("/discordCallback", async (req, res) => {
    const { code, state: appUserId } = req.query;

    if (!code || !appUserId) {
        return res.status(400).send("Missing code or state from Discord.");
    }

    try {
        const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: discordClientSecret.value(),
                grant_type: "authorization_code",
                code,
                redirect_uri: DISCORD_REDIRECT_URI,
            }),
        });

        const tokenData = await tokenResponse.json();
        if (!tokenData.access_token) {
            throw new Error("Failed to get access token from Discord.");
        }
        
        const { access_token, refresh_token } = tokenData;

        const userResponse = await fetch("https://discord.com/api/users/@me", {
            headers: { Authorization: `Bearer ${access_token}` },
        });
        const discordUser = await userResponse.json();
        if (!discordUser.id || !discordUser.username) {
            throw new Error("Failed to fetch user info from Discord.");
        }
        
        const guildsResponse = await fetch("https://discord.com/api/users/@me/guilds", {
            headers: { Authorization: `Bearer ${access_token}` },
        });
        const guildsData = await guildsResponse.json();
        const guildIds = Array.isArray(guildsData) ? guildsData.map(g => g.id) : [];

        const userRef = db.collection("users").doc(appUserId);
        await userRef.update({
            discordId: discordUser.id,
            discordUsername: discordUser.username,
            discordGuilds: guildIds,
            discordRefreshToken: refresh_token,
        });
        
        res.redirect("https://planetcreations.net/settings?discord-linked=success");

    } catch (error) {
        console.error("Error in Discord callback:", error);
        res.status(500).send("An error occurred while linking your Discord account.");
    }
});



// Export the single Express app as a Cloud Function
// (enthält /signBackup und /discordCallback → braucht beide Secrets)
exports.api = functions
    .runWith({ secrets: [discordClientSecret, backupSigningKey] })
    .https.onRequest(app);


// --- Konstanten für Backup-Validierung ---
// Fallback, wenn die Games-Registry (meta/games) fehlt oder leer ist
const ALLOWED_GAME_EXTENSIONS = ['.park2', '.zoo', '.blpr2', '.pzblueprint', '.prkauto2', '.zooauto'];

// --- Games-Registry (meta/games): Spiele als Laufzeit-Konfiguration ---
// Instanz-Cache mit TTL, damit Trigger nicht bei jedem Write das Doc lesen.
const FALLBACK_REGISTRY_GAMES = [
    { id: 'planet-coaster', fileExtensions: [] },
    { id: 'planet-coaster-2', fileExtensions: ['.park2', '.blpr2', '.prkauto2'] },
    { id: 'planet-zoo', fileExtensions: ['.zoo', '.pzblueprint', '.zooauto'] },
];
let gamesRegistryCache = { at: 0, games: FALLBACK_REGISTRY_GAMES };
async function getRegistryGames() {
    if (Date.now() - gamesRegistryCache.at < 5 * 60 * 1000) return gamesRegistryCache.games;
    try {
        const snap = await db.doc('meta/games').get();
        const games = (snap.exists && Array.isArray(snap.data().games) && snap.data().games.length > 0)
            ? snap.data().games
            : FALLBACK_REGISTRY_GAMES;
        gamesRegistryCache = { at: Date.now(), games };
    } catch (e) {
        console.warn('Games registry read failed, using cached/fallback:', e.message);
        gamesRegistryCache.at = Date.now();
    }
    return gamesRegistryCache.games;
}

async function getRegistryGameIds() {
    return (await getRegistryGames()).map((g) => g.id);
}

// Union aller Datei-Endungen der Registry (Backup-Validierung); Fallback alt.
async function getAllowedGameExtensions() {
    const games = await getRegistryGames();
    const exts = [...new Set(games.flatMap((g) => g.fileExtensions || []))];
    return exts.length > 0 ? exts : ALLOWED_GAME_EXTENSIONS;
}

function validateBackupBuffer(fileBuffer, publicKey, allowedExtensions = ALLOWED_GAME_EXTENSIONS) {
    try {
        const result = validateCreationArchive(fileBuffer, publicKey, allowedExtensions);
        return { valid: true, verificationStatus: "verified", ...result };
    } catch (error) {
        console.error("Backup validation error:", error);
        return { valid: false, error: error.message, verificationStatus: "invalid" };
    }
}

/**
 * Generiert den öffentlichen Schlüssel aus dem privaten Signing Key
 */
function getPublicKeyFromPrivate(privateKey) {
    try {
        const keyObject = crypto.createPublicKey(privateKey);
        return keyObject.export({ type: 'spki', format: 'pem' });
    } catch (error) {
        console.error('Failed to derive public key:', error);
        return null;
    }
}

// --- Callable Functions ---

const uploadFunctionOptions = { secrets: [r2AccessKeyId, r2SecretAccessKey] };
const uploadSessionCollection = db.collection("backupUploadSessions");
const uploadContentType = "application/zip";

function requireAuthenticated(context) {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
    }
    return context.auth.uid;
}

const MAX_DESKTOP_CLIENTS = 10;
const MAX_CLIENT_INSTALL_QUEUE = 5;
const CLIENT_COMMAND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CLIENT_COMMAND_LEASE_MS = 15 * 60 * 1000;
const clientIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const creationIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;

function requireClientId(value) {
    if (typeof value !== "string" || !clientIdPattern.test(value)) {
        throw new functions.https.HttpsError("invalid-argument", "A valid desktop client ID is required.");
    }
    return value;
}

function requireCreationId(value) {
    if (typeof value !== "string" || !creationIdPattern.test(value)) {
        throw new functions.https.HttpsError("invalid-argument", "A valid creation ID is required.");
    }
    return value;
}

function queueTimestampMillis(value) {
    if (value && typeof value.toMillis === "function") return value.toMillis();
    return 0;
}

function getClientQueueRef(uid, clientId) {
    return db.doc(`clientInstallQueues/${uid}/clients/${clientId}`);
}

exports.registerDesktopClient = functions.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const clientId = requireClientId(data && data.clientId);
    const displayName = typeof data?.displayName === "string" ?
        Array.from(data.displayName.trim())
            .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
            .join("").slice(0, 50) : "";
    const clientVersion = typeof data?.clientVersion === "string" ?
        data.clientVersion.trim().slice(0, 30) : "";
    if (!displayName || !clientVersion) {
        throw new functions.https.HttpsError("invalid-argument", "Client name and version are required.");
    }

    const userRef = db.doc(`users/${uid}`);
    const now = admin.firestore.Timestamp.now();
    await db.runTransaction(async (tx) => {
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) {
            throw new functions.https.HttpsError("failed-precondition", "The user profile does not exist.");
        }
        const storedClients = userSnap.data().clients;
        const clients = storedClients && typeof storedClients === "object" && !Array.isArray(storedClients) ?
            {...storedClients} : {};
        const existing = clients[clientId];
        if (!existing && Object.keys(clients).length >= MAX_DESKTOP_CLIENTS) {
            throw new functions.https.HttpsError(
                "resource-exhausted",
                `A maximum of ${MAX_DESKTOP_CLIENTS} desktop clients can be registered.`,
            );
        }
        // Skip the write when nothing changed, so a plain app start on an
        // already-registered client costs no Firestore write.
        if (existing && existing.displayName === displayName &&
            existing.clientVersion === clientVersion && existing.remoteInstall === true) {
            return;
        }
        clients[clientId] = {
            displayName,
            platform: "windows",
            clientVersion,
            remoteInstall: true,
            registeredAt: existing?.registeredAt || now,
        };
        tx.update(userRef, {clients});
    });
    return {success: true, clientId};
});

exports.enqueueClientInstall = functions.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const clientId = requireClientId(data && data.clientId);
    const creationId = requireCreationId(data && data.creationId);
    const userRef = db.doc(`users/${uid}`);
    const creationRef = db.doc(`creations/${creationId}`);
    const queueRef = getClientQueueRef(uid, clientId);
    const nowMs = Date.now();

    return db.runTransaction(async (tx) => {
        const userSnap = await tx.get(userRef);
        const creationSnap = await tx.get(creationRef);
        const queueSnap = await tx.get(queueRef);
        const client = userSnap.data()?.clients?.[clientId];
        if (!client || client.remoteInstall !== true) {
            throw new functions.https.HttpsError("not-found", "The selected desktop client is not registered.");
        }
        if (!creationSnap.exists) {
            throw new functions.https.HttpsError("not-found", "The creation does not exist.");
        }
        const creation = creationSnap.data();
        if (!isOwnedObjectKey(creation.backupObjectKey, creation.userId, "creation-backups") ||
            !creation.backupObjectKey.startsWith(`creation-backups/${creation.userId}/${creationId}/`)) {
            throw new functions.https.HttpsError("failed-precondition", "This creation has no verified R2 package.");
        }

        const currentItems = queueSnap.exists ? queueSnap.data().items || [] : [];
        const items = currentItems.filter((item) => queueTimestampMillis(item.expiresAt) > nowMs);
        if (items.some((item) => item.creationId === creationId)) {
            return {queued: false, duplicate: true, queueSize: items.length};
        }
        if (items.length >= MAX_CLIENT_INSTALL_QUEUE) {
            throw new functions.https.HttpsError(
                "resource-exhausted",
                `The selected client queue already contains ${MAX_CLIENT_INSTALL_QUEUE} creations.`,
            );
        }

        const commandId = crypto.randomUUID();
        items.push({
            id: commandId,
            type: "install_creation",
            creationId,
            creationTitle: String(creation.title || "Creation").slice(0, 200),
            requestedAt: admin.firestore.Timestamp.fromMillis(nowMs),
            expiresAt: admin.firestore.Timestamp.fromMillis(nowMs + CLIENT_COMMAND_TTL_MS),
            status: "pending",
            attempts: 0,
        });
        tx.set(queueRef, {
            uid,
            clientId,
            items,
            updatedAt: admin.firestore.Timestamp.fromMillis(nowMs),
        }, {merge: true});
        return {queued: true, commandId, queueSize: items.length};
    });
});

exports.claimClientInstall = functions.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const clientId = requireClientId(data && data.clientId);
    const userRef = db.doc(`users/${uid}`);
    const queueRef = getClientQueueRef(uid, clientId);
    const nowMs = Date.now();

    return db.runTransaction(async (tx) => {
        const userSnap = await tx.get(userRef);
        const queueSnap = await tx.get(queueRef);
        if (!userSnap.data()?.clients?.[clientId]?.remoteInstall) {
            throw new functions.https.HttpsError("permission-denied", "This desktop client is not registered.");
        }
        if (!queueSnap.exists) return {command: null};

        let changed = false;
        const items = (queueSnap.data().items || []).filter((item) => {
            const keep = queueTimestampMillis(item.expiresAt) > nowMs;
            if (!keep) changed = true;
            return keep;
        });
        const commandIndex = items.findIndex((item) => {
            const leaseExpired = item.status === "processing" && queueTimestampMillis(item.leaseUntil) <= nowMs;
            const retryReady = !item.retryAfter || queueTimestampMillis(item.retryAfter) <= nowMs;
            return retryReady && (item.status === "pending" || leaseExpired);
        });

        if (commandIndex < 0) {
            if (changed) tx.set(queueRef, {items, updatedAt: admin.firestore.Timestamp.now()}, {merge: true});
            const nextAttemptAt = items.reduce((next, item) => {
                const candidate = item.status === "processing" ? queueTimestampMillis(item.leaseUntil) :
                    queueTimestampMillis(item.retryAfter);
                return candidate > nowMs && (!next || candidate < next) ? candidate : next;
            }, 0);
            return {command: null, nextAttemptAt: nextAttemptAt || null};
        }

        const claimed = {
            ...items[commandIndex],
            status: "processing",
            attempts: Number(items[commandIndex].attempts || 0) + 1,
            claimedBy: clientId,
            claimedAt: admin.firestore.Timestamp.fromMillis(nowMs),
            leaseUntil: admin.firestore.Timestamp.fromMillis(nowMs + CLIENT_COMMAND_LEASE_MS),
            retryAfter: null,
        };
        items[commandIndex] = claimed;
        tx.set(queueRef, {items, updatedAt: admin.firestore.Timestamp.fromMillis(nowMs)}, {merge: true});
        return {
            command: {
                id: claimed.id,
                creationId: claimed.creationId,
                creationTitle: claimed.creationTitle,
                attempts: claimed.attempts,
            },
        };
    });
});

exports.completeClientInstall = functions.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const clientId = requireClientId(data && data.clientId);
    const commandId = typeof data?.commandId === "string" ? data.commandId : "";
    const success = data?.success === true;
    const permanent = data?.permanent === true;
    if (!creationIdPattern.test(commandId)) {
        throw new functions.https.HttpsError("invalid-argument", "A valid command ID is required.");
    }
    const queueRef = getClientQueueRef(uid, clientId);
    const nowMs = Date.now();

    return db.runTransaction(async (tx) => {
        const queueSnap = await tx.get(queueRef);
        if (!queueSnap.exists) return {removed: true};
        const items = queueSnap.data().items || [];
        const index = items.findIndex((item) => item.id === commandId && item.claimedBy === clientId);
        if (index < 0) return {removed: true};

        const item = items[index];
        if (success || permanent || Number(item.attempts || 0) >= 3) {
            items.splice(index, 1);
            tx.set(queueRef, {items, updatedAt: admin.firestore.Timestamp.fromMillis(nowMs)}, {merge: true});
            return {removed: true};
        }

        const retryDelayMs = Math.min(15, Math.max(1, Number(item.attempts || 1) * 2)) * 60 * 1000;
        const retryAt = nowMs + retryDelayMs;
        items[index] = {
            ...item,
            status: "pending",
            claimedBy: null,
            claimedAt: null,
            leaseUntil: null,
            retryAfter: admin.firestore.Timestamp.fromMillis(retryAt),
            lastError: String(data?.message || "Install failed").slice(0, 300),
        };
        tx.set(queueRef, {items, updatedAt: admin.firestore.Timestamp.fromMillis(nowMs)}, {merge: true});
        return {removed: false, retryAt};
    });
});

function sanitizeBackupFileName(fileName) {
    if (typeof fileName !== "string" || path.extname(fileName).toLowerCase() !== ".planetcreations") {
        throw new functions.https.HttpsError(
            "invalid-argument",
            "Only .PlanetCreations creation packages can be uploaded.",
        );
    }
    const baseName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
    return baseName.slice(-180) || "creation.PlanetCreations";
}

function isOwnedObjectKey(objectKey, uid, prefix) {
    return typeof objectKey === "string" && objectKey.startsWith(`${prefix}/${uid}/`) &&
        !objectKey.includes("..") && !objectKey.includes("\\");
}

function encodeCopySource(bucket, objectKey) {
    const encodedKey = objectKey.split("/").map(encodeURIComponent).join("/");
    return `/${encodeURIComponent(bucket)}/${encodedKey}`;
}

exports.getUploadUrl = functions
    .runWith(uploadFunctionOptions)
    .https.onCall(async (data, context) => {
        const uid = requireAuthenticated(context);
        const fileName = sanitizeBackupFileName(data && data.fileName);
        const fileSize = data && data.fileSize;
        if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MAX_BACKUP_SIZE_BYTES) {
            throw new functions.https.HttpsError(
                "invalid-argument",
                "The package size must be between 1 byte and 300 MB.",
            );
        }

        const uploadId = crypto.randomUUID();
        const objectKey = `temp-uploads/${uid}/${uploadId}.PlanetCreations`;
        const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + (10 * 60 * 1000));
        await uploadSessionCollection.doc(uploadId).set({
            uid,
            objectKey,
            originalFileName: fileName,
            expectedSize: fileSize,
            contentType: uploadContentType,
            status: "pending",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt,
        });

        try {
            const uploadUrl = await getSignedUrl(
                getS3(),
                new PutObjectCommand({
                    Bucket: getR2Bucket(),
                    Key: objectKey,
                    ContentType: uploadContentType,
                }),
                { expiresIn: 60 * 10, signableHeaders: new Set(["content-type"]) },
            );
            return {
                uploadId,
                uploadUrl,
                contentType: uploadContentType,
                expiresAt: expiresAt.toMillis(),
                maxSizeBytes: MAX_BACKUP_SIZE_BYTES,
            };
        } catch (error) {
            await uploadSessionCollection.doc(uploadId).delete().catch(() => null);
            console.error("Error creating a Cloudflare R2 upload URL:", error);
            throw new functions.https.HttpsError("internal", "Could not create the upload URL.");
        }
    });

exports.abortBackupUpload = functions
    .runWith(uploadFunctionOptions)
    .https.onCall(async (data, context) => {
        const uid = requireAuthenticated(context);
        const uploadId = data && data.uploadId;
        if (typeof uploadId !== "string") {
            throw new functions.https.HttpsError("invalid-argument", "An upload ID is required.");
        }
        const sessionRef = uploadSessionCollection.doc(uploadId);
        const sessionSnap = await sessionRef.get();
        if (!sessionSnap.exists || sessionSnap.data().uid !== uid) {
            throw new functions.https.HttpsError("not-found", "Upload session not found.");
        }
        const session = sessionSnap.data();
        if (!isOwnedObjectKey(session.objectKey, uid, "temp-uploads")) {
            throw new functions.https.HttpsError("permission-denied", "The upload session is invalid.");
        }
        await getS3().send(new DeleteObjectCommand({ Bucket: getR2Bucket(), Key: session.objectKey }))
            .catch((error) => console.warn("R2 temp cleanup failed:", error.message));
        await sessionRef.delete();
        return { success: true };
    });

exports.finalizeBackupUpload = functions
    .runWith({ memory: "1GB", timeoutSeconds: 300, secrets: [
        backupSigningKey, r2AccessKeyId, r2SecretAccessKey,
    ] })
    .https.onCall(async (data, context) => {
        const uid = requireAuthenticated(context);
        const uploadId = data && data.uploadId;
        const creationId = data && data.creationId;
        if (typeof uploadId !== "string" || typeof creationId !== "string") {
            throw new functions.https.HttpsError("invalid-argument", "Upload and creation IDs are required.");
        }

        const sessionRef = uploadSessionCollection.doc(uploadId);
        const creationRef = db.doc(`creations/${creationId}`);
        const [sessionSnap, creationSnap] = await Promise.all([sessionRef.get(), creationRef.get()]);
        if (!sessionSnap.exists || sessionSnap.data().uid !== uid) {
            throw new functions.https.HttpsError("not-found", "Upload session not found.");
        }
        if (!creationSnap.exists || creationSnap.data().userId !== uid) {
            throw new functions.https.HttpsError("permission-denied", "You do not own this creation.");
        }
        const session = sessionSnap.data();
        if (session.status === "completed" && session.creationId === creationId) {
            return { success: true, alreadyFinalized: true };
        }
        if (session.status !== "pending" || !session.expiresAt || session.expiresAt.toMillis() < Date.now()) {
            throw new functions.https.HttpsError("failed-precondition", "The upload session expired or was already used.");
        }
        if (!isOwnedObjectKey(session.objectKey, uid, "temp-uploads")) {
            throw new functions.https.HttpsError("permission-denied", "The upload session is invalid.");
        }

        await db.runTransaction(async (transaction) => {
            const latestSessionSnap = await transaction.get(sessionRef);
            const latestSession = latestSessionSnap.data();
            if (!latestSessionSnap.exists || latestSession.uid !== uid || latestSession.status !== "pending") {
                throw new functions.https.HttpsError("aborted", "The upload session is already being processed.");
            }
            transaction.update(sessionRef, {
                status: "processing",
                creationId,
                processingAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        });
        const bucket = getR2Bucket();
        let destinationKey = null;
        try {
            const head = await getS3().send(new HeadObjectCommand({ Bucket: bucket, Key: session.objectKey }));
            if (head.ContentLength !== session.expectedSize || head.ContentLength > MAX_BACKUP_SIZE_BYTES ||
                head.ContentType !== uploadContentType) {
                throw new Error("The uploaded object size or content type does not match the upload session.");
            }
            const object = await getS3().send(new GetObjectCommand({ Bucket: bucket, Key: session.objectKey }));
            const fileBuffer = await r2BodyToBuffer(object.Body);
            const publicKey = getPublicKeyFromPrivate(backupSigningKey.value());
            const validation = validateBackupBuffer(fileBuffer, publicKey, await getAllowedGameExtensions());
            if (!validation.valid) throw new Error(validation.error);
            if (validation.metadata.signerUid !== uid) {
                throw new Error("The package signer does not match the upload owner.");
            }
            if (validation.metadata.gameId !== creationSnap.data().game) {
                throw new Error("The game in the package does not match the creation.");
            }

            destinationKey = `creation-backups/${uid}/${creationId}/${uploadId}.PlanetCreations`;
            await getS3().send(new CopyObjectCommand({
                Bucket: bucket,
                CopySource: encodeCopySource(bucket, session.objectKey),
                Key: destinationKey,
                ContentType: uploadContentType,
                MetadataDirective: "REPLACE",
            }));
            const oldObjectKey = creationSnap.data().backupObjectKey;
            await creationRef.update({
                backupObjectKey: destinationKey,
                backupStorageProvider: "cloudflare-r2",
                backupUrl: null,
                backupFileSize: head.ContentLength,
                backupIsSigned: true,
                backupSignerUid: validation.metadata.signerUid,
                backupSignerUsername: validation.metadata.signerUsername || null,
                backupOriginalFileName: validation.metadata.originalFileName,
                backupPackageId: validation.metadata.packageId,
                backupMediaSetId: validation.metadata.mediaSetId,
                backupProcessingError: null,
                backupUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            await sessionRef.update({
                status: "completed",
                destinationKey,
                completedAt: admin.firestore.FieldValue.serverTimestamp(),
            }).catch((error) => console.warn("Upload-session completion write failed:", error.message));
            await getS3().send(new DeleteObjectCommand({ Bucket: bucket, Key: session.objectKey }))
                .catch((error) => console.warn("R2 temp cleanup after finalization failed:", error.message));

            if (oldObjectKey && oldObjectKey !== destinationKey &&
                isOwnedObjectKey(oldObjectKey, uid, "creation-backups") &&
                oldObjectKey.startsWith(`creation-backups/${uid}/${creationId}/`)) {
                await getS3().send(new DeleteObjectCommand({ Bucket: bucket, Key: oldObjectKey }))
                    .catch((error) => console.warn("Old R2 object cleanup failed:", error.message));
            }
            return { success: true };
        } catch (error) {
            console.error(`Backup finalization failed for ${uploadId}:`, error);
            await getS3().send(new DeleteObjectCommand({ Bucket: bucket, Key: session.objectKey })).catch(() => null);
            if (destinationKey) {
                await getS3().send(new DeleteObjectCommand({ Bucket: bucket, Key: destinationKey })).catch(() => null);
            }
            await Promise.all([
                sessionRef.set({ status: "rejected", error: error.message }, { merge: true }),
                creationRef.update({ backupProcessingError: error.message }),
            ]);
            throw new functions.https.HttpsError("failed-precondition", error.message);
        }
    });

exports.getBackupDownloadUrl = functions
    .runWith(uploadFunctionOptions)
    .https.onCall(async (data) => {
        const creationId = data && data.creationId;
        if (typeof creationId !== "string") {
            throw new functions.https.HttpsError("invalid-argument", "A creation ID is required.");
        }
        const creationSnap = await db.doc(`creations/${creationId}`).get();
        if (!creationSnap.exists) throw new functions.https.HttpsError("not-found", "Creation not found.");
        const creation = creationSnap.data();
        const objectKey = creation.backupObjectKey;
        if (!isOwnedObjectKey(objectKey, creation.userId, "creation-backups") ||
            !objectKey.startsWith(`creation-backups/${creation.userId}/${creationId}/`)) {
            throw new functions.https.HttpsError("not-found", "This creation has no R2 backup.");
        }
        const downloadUrl = await getSignedUrl(
            getS3(),
            new GetObjectCommand({ Bucket: getR2Bucket(), Key: objectKey }),
            { expiresIn: 60 * 10 },
        );
        return { downloadUrl, expiresInSeconds: 600 };
    });

exports.removeCreationBackup = functions
    .runWith(uploadFunctionOptions)
    .https.onCall(async (data, context) => {
        const uid = requireAuthenticated(context);
        const creationId = data && data.creationId;
        const creationRef = db.doc(`creations/${creationId}`);
        const creationSnap = await creationRef.get();
        if (!creationSnap.exists || creationSnap.data().userId !== uid) {
            throw new functions.https.HttpsError("permission-denied", "You do not own this creation.");
        }
        const objectKey = creationSnap.data().backupObjectKey;
        if (objectKey && objectKey.startsWith(`creation-backups/${uid}/${creationId}/`)) {
            await getS3().send(new DeleteObjectCommand({ Bucket: getR2Bucket(), Key: objectKey }));
        }
        await creationRef.update({
            backupObjectKey: null,
            backupStorageProvider: null,
            backupUrl: null,
            backupFileSize: null,
            backupIsSigned: false,
            backupSignerUid: null,
            backupSignerUsername: null,
            backupOriginalFileName: null,
            backupPackageId: null,
            backupMediaSetId: null,
            backupProcessingError: null,
            backupUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { success: true };
    });


 exports.voteOnCreation = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to vote.');
    }
    const userId = context.auth.uid;
    const { creationId, voteType } = data;

    if (!creationId || !['like', 'dislike'].includes(voteType)) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid creationId and voteType must be provided.');
    }
    
    const creationRef = db.doc(`creations/${creationId}`);
    const voteRef = db.doc(`creations/${creationId}/votes/${userId}`);

    try {
        await db.runTransaction(async (transaction) => {
            const voteDoc = await transaction.get(voteRef);
            const creationDoc = await transaction.get(creationRef);

            if (!creationDoc.exists) { 
                throw new functions.https.HttpsError('not-found', 'This creation does not exist.');
            }

            const creationData = creationDoc.data();
            const { likes = 0, dislikes = 0 } = creationData;
            
            const currentVote = voteDoc.exists ? voteDoc.data().type : null;

            let newLikes = likes;
            let newDislikes = dislikes;

            if (currentVote === voteType) {
                if (voteType === 'like') newLikes--;
                if (voteType === 'dislike') newDislikes--;
                transaction.delete(voteRef);
            } else {
                if (currentVote === 'like') newLikes--;
                if (currentVote === 'dislike') newDislikes--;

                if (voteType === 'like') newLikes++;
                if (voteType === 'dislike') newDislikes++;
                transaction.set(voteRef, { type: voteType, userId: userId });
            }

            transaction.update(creationRef, { 
                likes: Math.max(0, newLikes), 
                dislikes: Math.max(0, newDislikes) 
            });
        });
        return { success: true };
    } catch (error) {
        console.error("Error processing vote transaction:", error);
        if (error.code) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'An unexpected error occurred while processing your vote.');
    }
});

exports.refreshDiscordGuilds = functions
    .runWith({ secrets: [discordClientSecret] })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to perform this action.');
    }
    const userId = context.auth.uid;

    try {
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists || !userDoc.data().discordRefreshToken) {
            throw new functions.https.HttpsError('not-found', 'No Discord refresh token found for this user. Please re-link your account.');
        }

        const refreshToken = userDoc.data().discordRefreshToken;

        const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: discordClientSecret.value(),
                grant_type: "refresh_token",
                refresh_token: refreshToken,
            }),
        });

        const tokenData = await tokenResponse.json();
        if (!tokenData.access_token) {
            console.error("Failed to refresh token from Discord for user:", userId, tokenData);
            await userRef.update({ discordRefreshToken: null, discordGuilds: [] });
            throw new functions.https.HttpsError('permission-denied', 'Could not refresh Discord token. Please re-link your account in the settings.');
        }

        const { access_token: new_access_token, refresh_token: new_refresh_token } = tokenData;

        const guildsResponse = await fetch("https://discord.com/api/users/@me/guilds", {
            headers: { Authorization: `Bearer ${new_access_token}` },
        });

        if (!guildsResponse.ok) {
            throw new Error(`Discord API returned an error: ${guildsResponse.status}`);
        }

        const guildsData = await guildsResponse.json();
        const guildIds = Array.isArray(guildsData) ? guildsData.map(g => g.id) : [];

        await userRef.update({
            discordGuilds: guildIds,
            discordRefreshToken: new_refresh_token,
        });

        return { success: true, message: `Successfully refreshed and updated ${guildIds.length} guilds.` };

    } catch (error) {
        console.error(`Error refreshing Discord guilds for user ${userId}:`, error);
        if (error.code) throw error;
        throw new functions.https.HttpsError('internal', 'An unexpected error occurred while refreshing your Discord servers.');
    }
});

exports.deleteOwnAccount = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to perform this action.');
    }
    const userId = context.auth.uid;
    console.log(`User ${userId} initiating self-deletion.`);

    try {
        const batch = db.batch();
        const profileRef = db.doc(`profiles/${userId}`);
        const profileSnap = await profileRef.get();
        const username = profileSnap.exists ? profileSnap.data().username.toLowerCase() : null;
        
        const membershipsRef = db.collection(`profiles/${userId}/communityMemberships`);
        const membershipsSnap = await membershipsRef.get();
        const communityIds = membershipsSnap.docs.map(doc => doc.id);

        const creationsRef = db.collection('creations').where('userId', '==', userId);
        const creationsSnap = await creationsRef.get();
        creationsSnap.forEach(doc => batch.delete(doc.ref));
        const clientQueuesSnap = await db.collection(`clientInstallQueues/${userId}/clients`).get();
        clientQueuesSnap.forEach(doc => batch.delete(doc.ref));

        communityIds.forEach(communityId => {
            const memberRef = db.doc(`communitys/${communityId}/members/${userId}`);
            batch.delete(memberRef);
        });

        batch.delete(profileRef);
        batch.delete(db.doc(`users/${userId}`));
        // Subcollections werden vom Doc-Delete NICHT erfasst — Interessen-Map
        // (Personalisierung) und Inbox explizit mitlöschen.
        batch.delete(db.doc(`users/${userId}/meta/interests`));
        batch.delete(db.doc(`users/${userId}/meta/inbox`));
        if (username) {
            batch.delete(db.doc(`usernames/${username}`));
        }

        await batch.commit();
        await admin.auth().deleteUser(userId);

        return { success: true, message: `User ${userId} and all their content has been deleted.` };
    } catch (error) {
        console.error(`Failed to delete user ${userId}:`, error);
        throw new functions.https.HttpsError('internal', 'An error occurred during the account deletion process.');
    }
});

exports.deleteUserAndContent = functions.https.onCall(async (data, context) => {
    if (!context.auth || context.auth.token.role !== 'admin') {
        throw new functions.https.HttpsError('permission-denied', 'Only admins can perform this action.');
    }
    const { userIdToDelete } = data;
    if (!userIdToDelete) {
        throw new functions.https.HttpsError('invalid-argument', 'A userIdToDelete must be provided.');
    }
    if (userIdToDelete === context.auth.uid) {
        throw new functions.https.HttpsError('invalid-argument', 'Admins cannot delete their own accounts.');
    }

    console.log(`Admin ${context.auth.uid} initiating deletion for user ${userIdToDelete}.`);

    try {
        const batch = db.batch();
        const profileRef = db.doc(`profiles/${userIdToDelete}`);
        const profileSnap = await profileRef.get();
        const username = profileSnap.exists ? profileSnap.data().username.toLowerCase() : null;
        
        const membershipsRef = db.collection(`profiles/${userIdToDelete}/communityMemberships`);
        const membershipsSnap = await membershipsRef.get();
        const communityIds = membershipsSnap.docs.map(doc => doc.id);

        const creationsRef = db.collection('creations').where('userId', '==', userIdToDelete);
        const creationsSnap = await creationsRef.get();
        creationsSnap.forEach(doc => batch.delete(doc.ref));
        const clientQueuesSnap = await db.collection(`clientInstallQueues/${userIdToDelete}/clients`).get();
        clientQueuesSnap.forEach(doc => batch.delete(doc.ref));
        console.log(`Deleting ${creationsSnap.size} creations...`);

        communityIds.forEach(communityId => {
            const memberRef = db.doc(`communitys/${communityId}/members/${userIdToDelete}`);
            batch.delete(memberRef);
        });
        console.log(`Deleting from ${communityIds.length} community member lists...`);

        batch.delete(profileRef);
        batch.delete(db.doc(`users/${userIdToDelete}`));
        // Subcollections werden vom Doc-Delete NICHT erfasst — Interessen-Map
        // (Personalisierung) und Inbox explizit mitlöschen.
        batch.delete(db.doc(`users/${userIdToDelete}/meta/interests`));
        batch.delete(db.doc(`users/${userIdToDelete}/meta/inbox`));
        if (username) {
            batch.delete(db.doc(`usernames/${username}`));
        }
        console.log("Deleting main user documents...");

        await batch.commit();
        console.log("Firestore data deleted successfully.");

        await admin.auth().deleteUser(userIdToDelete);
        console.log(`Successfully deleted user ${userIdToDelete} from Firebase Auth.`);

        return { success: true, message: `User ${userIdToDelete} and all their content has been deleted.` };
    } catch (error) {
        console.error(`Failed to delete user ${userIdToDelete}:`, error);
        throw new functions.https.HttpsError('internal', 'An error occurred during the deletion process.');
    }
});

exports.getAllUserEmails = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.token.role !== 'admin') {
    throw new functions.https.HttpsError(
      'permission-denied',
      'This function can only be called by an administrator.'
    );
  }
  const emails = [];
  let nextPageToken;
  try {
    do {
      const listUsersResult = await admin.auth().listUsers(1000, nextPageToken);
      listUsersResult.users.forEach((userRecord) => { if (userRecord.email) { emails.push(userRecord.email); } });
      nextPageToken = listUsersResult.pageToken;
    } while (nextPageToken);
    return { emails };
  } catch (error) {
    console.error("Error listing users:", error);
    throw new functions.https.HttpsError('internal', 'An error occurred while fetching user emails.');
  }
});

exports.deleteEventAsStaff = functions.https.onCall(async (data, context) => {
    if (!context.auth) { throw new functions.https.HttpsError('unauthenticated', 'You must be logged in.'); }
    const { eventId } = data;
    if (!eventId) { throw new functions.https.HttpsError('invalid-argument', 'An eventId must be provided.'); }
    const userId = context.auth.uid;
    const userRole = context.auth.token.role;
    try {
        const eventRef = db.collection('events').doc(eventId);
        const eventDoc = await eventRef.get();
        if (!eventDoc.exists) { throw new functions.https.HttpsError('not-found', 'Event does not exist.'); }
        const eventData = eventDoc.data();
        const communityId = eventData.communityId;
        const isSiteStaff = userRole === 'admin' || userRole === 'moderator';
        let isCommunityStaff = false;
        if (!isSiteStaff) {
            const memberRef = db.collection('communitys').doc(communityId).collection('members').doc(userId);
            const memberDoc = await memberRef.get();
            if (memberDoc.exists) {
                const memberRoles = memberDoc.data().roles || [];
                isCommunityStaff = memberRoles.includes('owner') || memberRoles.includes('moderator');
            }
        }
        if (!isSiteStaff && !isCommunityStaff) { throw new functions.https.HttpsError('permission-denied', 'You do not have permission to delete this event.'); }
        const batch = db.batch();
        batch.delete(eventRef);
        const creationsQuery = db.collection('creations').where('eventIds', 'array-contains', eventId);
        const creationsSnapshot = await creationsQuery.get();
        creationsSnapshot.forEach(creationDoc => {
            batch.update(creationDoc.ref, { eventIds: admin.firestore.FieldValue.arrayRemove(eventId) });
        });
        const votersRef = db.collection('events').doc(eventId).collection('voters');
        const votersSnapshot = await votersRef.get();
        votersSnapshot.forEach(voterDoc => { batch.delete(voterDoc.ref); });
        await batch.commit();
        return { success: true, message: "Event deleted successfully." };
    } catch (error) {
        console.error("Error deleting event:", error);
        if (error.code) { throw error; }
        throw new functions.https.HttpsError('internal', 'An unexpected error occurred while deleting the event.');
    }
});




// --- Trigger Functions (Alles Gen 1) ---


exports.onCreationDelete = functions
    .runWith(uploadFunctionOptions)
    .firestore
    .document('creations/{creationId}')
    .onDelete(async (snap, context) => {
        const creationId = context.params.creationId;
        const deletedData = snap.data();

        // --- Cascade-Cleanup: sonst bleiben verwaiste Referenzen zurück ---
        // 1) Community-Link-Docs (sonst erscheint die Creation weiter in Community-
        //    Seiten/Index; die Link-Doc-Trigger bereinigen danach die Indexe).
        const communityIds = deletedData.communityIds || [];
        await Promise.all(communityIds.map(cid =>
            db.doc(`communitys/${cid}/creations/${creationId}`).delete()
                .catch(e => console.error(`Failed to delete community link ${cid}/${creationId}:`, e.message))
        ));

        // 2) Follower-Subcollection (creationFollowers/{id}/followers/*)
        try {
            const followersSnap = await db.collection(`creationFollowers/${creationId}/followers`).get();
            if (!followersSnap.empty) {
                const fBatch = db.batch();
                followersSnap.docs.forEach(d => fBatch.delete(d.ref));
                await fBatch.commit();
            }
        } catch (e) { console.error(`Failed to clean followers for ${creationId}:`, e.message); }

        // 3) Votes-Subcollection (creations/{id}/votes/*)
        try {
            const votesSnap = await db.collection(`creations/${creationId}/votes`).get();
            if (!votesSnap.empty) {
                const vBatch = db.batch();
                votesSnap.docs.forEach(d => vBatch.delete(d.ref));
                await vBatch.commit();
            }
        } catch (e) { console.error(`Failed to clean votes for ${creationId}:`, e.message); }

        const objectKey = deletedData.backupObjectKey;
        const expectedPrefix = `creation-backups/${deletedData.userId}/${creationId}/`;
        if (typeof objectKey === "string" && objectKey.startsWith(expectedPrefix) &&
            !objectKey.includes("..") && !objectKey.includes("\\")) {
            await getS3().send(new DeleteObjectCommand({ Bucket: getR2Bucket(), Key: objectKey }))
                .catch((error) => console.error(`Failed to delete R2 object ${objectKey}:`, error));
        }
        return null;
    });

exports.onMemberJoin = functions.firestore
    .document('communitys/{communityId}/members/{userId}')
    .onCreate(async (snap, context) => {
        const communityId = context.params.communityId;
        const communityRef = db.doc(`communitys/${communityId}`);
        return communityRef.update({ memberCount: admin.firestore.FieldValue.increment(1) });
    });

exports.onMemberLeave = functions.firestore
    .document('communitys/{communityId}/members/{userId}')
    .onDelete(async (snap, context) => {
        const communityId = context.params.communityId;
        const communityRef = db.doc(`communitys/${communityId}`);
        return communityRef.update({ memberCount: admin.firestore.FieldValue.increment(-1) });
    });

// Keep the denormalized profile membership in sync with the authoritative member
// document. This lets read-heavy UI paths load ranks together with memberships
// without one additional member-document read per community.
exports.syncCommunityMembershipRoles = functions.firestore
    .document('communitys/{communityId}/members/{userId}')
    .onWrite(async (change, context) => {
        const { communityId, userId } = context.params;
        const membershipRef = db.doc(`profiles/${userId}/communityMemberships/${communityId}`);

        if (!change.after.exists) {
            await membershipRef.delete().catch(error => {
                if (error.code !== 5 && error.code !== 'not-found') throw error;
            });
            return null;
        }

        const afterData = change.after.data() || {};
        const roles = Array.isArray(afterData.roles)
            ? afterData.roles
            : (typeof afterData.role === 'string' ? [afterData.role] : []);
        await membershipRef.set({ roles }, { merge: true });
        return null;
    });

exports.onProfileWrite = functions.firestore.document("profiles/{userId}").onWrite(async (change, context) => {
    const afterData = change.after.data();
    const beforeData = change.before.data();
    if (afterData && (!beforeData || beforeData.username !== afterData.username)) {
        const username = afterData.username;
        const usernameLowercase = username.toLowerCase();
        return change.after.ref.set({ username_lowercase: usernameLowercase }, { merge: true });
    }
    return null;
});

exports.setCustomClaims = functions.firestore.document("users/{userId}").onWrite(async (change, context) => {
    const userId = context.params.userId;
    const userData = change.after.data();
    if (!userData || !userData.role) { return null; }
    const previousRole = change.before.data()?.role;
    const newRole = userData.role;
    if (previousRole === newRole) return null;
    try {
        await admin.auth().setCustomUserClaims(userId, { role: newRole });
        const profileRef = db.collection('profiles').doc(userId);
        await profileRef.set({ role: newRole }, { merge: true });
        console.log(`Custom claim and profile role set for user ${userId}: { role: '${newRole}' }`);
        return null;
    } catch (error) {
      console.error(`Error setting custom claim/profile role for ${userId}:`, error);
      return null;
    }
});

exports.onProfileUpdate = functions.firestore.document('profiles/{userId}').onUpdate(async (change, context) => {
    const userId = context.params.userId;
    const beforeData = change.before.data();
    const afterData = change.after.data();

    const usernameChanged = beforeData.username !== afterData.username;
    const profilePicChanged = beforeData.profilePictureUrl !== afterData.profilePictureUrl;

    if (!usernameChanged && !profilePicChanged) {
        console.log(`No relevant profile changes for user ${userId}.`);
        return null;
    }

    const dataToUpdate = {};
    if (usernameChanged) {
        dataToUpdate.username = afterData.username;
    }
    if (profilePicChanged) {
        dataToUpdate.userProfilePictureUrl = afterData.profilePictureUrl || null;
    }

    const batch = db.batch();

    try {
        const creationsQuery = db.collection('creations').where('userId', '==', userId);
        const creationsSnapshot = await creationsQuery.get();
        creationsSnapshot.forEach(doc => {
            batch.update(doc.ref, dataToUpdate);
        });
        console.log(`Found ${creationsSnapshot.size} creations to update for user ${userId}.`);

        const membershipsQuery = db.collection('profiles').doc(userId).collection('communityMemberships');
        const membershipsSnapshot = await membershipsQuery.get();
        membershipsSnapshot.forEach(doc => {
            const communityId = doc.id;
            const memberRef = db.doc(`communitys/${communityId}/members/${userId}`);
            if (usernameChanged) {
                batch.update(memberRef, { username: afterData.username });
            }
        });
        console.log(`Found ${membershipsSnapshot.size} community memberships to update for user ${userId}.`);
        
        if (usernameChanged) {
            const ownedCommunitiesQuery = db.collection('communitys').where('ownerId', '==', userId);
            const ownedCommunitiesSnapshot = await ownedCommunitiesQuery.get();
            ownedCommunitiesSnapshot.forEach(doc => {
                batch.update(doc.ref, { ownerUsername: afterData.username });
            });
            console.log(`Found ${ownedCommunitiesSnapshot.size} owned communities to update for user ${userId}.`);
        }

        await batch.commit();
        console.log(`Successfully synchronized profile updates for user ${userId}.`);
        return null;

    } catch (error) {
        console.error(`Error synchronizing profile for user ${userId}:`, error);
        return null;
    }
});

// --- Live-Streaming (server-authoritativ) ---
// Das liveStream-Feld auf Creations wird ausschließlich hier geschrieben; die
// Firestore-Rules pinnen es für Clients (wie activityScore). goLive verifiziert
// über die Twitch-/YouTube-API, dass der Stream tatsächlich läuft — ein
// modifizierter Client kann sich den Feed-Boost also nicht erschleichen.
// sweepLiveStreams re-verifiziert alle 15 Min nur die aktuell geflaggten
// Creations und beendet Sessions, deren Stream offline ging.

const twitchClientId = defineSecret("TWITCH_CLIENT_ID");
const twitchClientSecret = defineSecret("TWITCH_CLIENT_SECRET");
const youtubeApiKey = defineSecret("YOUTUBE_API_KEY");
const LIVE_SECRETS = {secrets: [twitchClientId, twitchClientSecret, youtubeApiKey]};

const LIVE_STREAM_TTL_MS = 12 * 60 * 60 * 1000;
const LIVE_PLATFORM_HOSTS = {
    twitch: ["twitch.tv", "www.twitch.tv", "m.twitch.tv"],
    youtube: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"],
};

// Validiert die Stream-URL und extrahiert das API-Ziel (Twitch-Login bzw.
// YouTube-Video-ID). YouTube braucht die konkrete Video-/Stream-URL, weil nur
// videos.list (1 Quota-Unit) billig prüfbar ist — Kanal-URLs wären teuer.
function parseStreamUrl(platform, rawUrl) {
    if (typeof rawUrl !== "string" || rawUrl.length > 300) return null;
    let url;
    try {
        url = new URL(rawUrl);
    } catch (error) {
        return null;
    }
    const hosts = LIVE_PLATFORM_HOSTS[platform];
    if (!hosts || url.protocol !== "https:" || !hosts.includes(url.hostname.toLowerCase())) return null;
    if (platform === "twitch") {
        const login = url.pathname.split("/").filter(Boolean)[0] || "";
        return /^[a-zA-Z0-9_]{3,25}$/.test(login) ? {url: rawUrl, twitchLogin: login.toLowerCase()} : null;
    }
    let videoId = null;
    if (url.hostname.toLowerCase() === "youtu.be") {
        videoId = url.pathname.split("/").filter(Boolean)[0] || null;
    } else if (url.pathname === "/watch") {
        videoId = url.searchParams.get("v");
    } else if (url.pathname.startsWith("/live/")) {
        videoId = url.pathname.split("/").filter(Boolean)[1] || null;
    }
    return videoId && /^[a-zA-Z0-9_-]{6,20}$/.test(videoId) ? {url: rawUrl, youtubeVideoId: videoId} : null;
}

// Twitch-App-Access-Token (Client Credentials), im Modul-Scope gecacht —
// überlebt warme Function-Instanzen und spart den Token-Roundtrip.
let twitchTokenCache = {token: null, expiresAt: 0};
async function getTwitchAppToken() {
    if (twitchTokenCache.token && twitchTokenCache.expiresAt > Date.now() + 60 * 1000) {
        return twitchTokenCache.token;
    }
    const response = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: {"Content-Type": "application/x-www-form-urlencoded"},
        body: new URLSearchParams({
            client_id: twitchClientId.value(),
            client_secret: twitchClientSecret.value(),
            grant_type: "client_credentials",
        }).toString(),
    });
    if (!response.ok) throw new Error(`Twitch token request failed (${response.status}).`);
    const tokenData = await response.json();
    twitchTokenCache = {
        token: tokenData.access_token,
        expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
    };
    return twitchTokenCache.token;
}

async function verifyStreamIsLive(platform, parsed) {
    if (platform === "twitch") {
        const token = await getTwitchAppToken();
        const response = await fetch(
            `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(parsed.twitchLogin)}`,
            {headers: {"Client-ID": twitchClientId.value(), "Authorization": `Bearer ${token}`}},
        );
        if (!response.ok) throw new Error(`Twitch API request failed (${response.status}).`);
        const body = await response.json();
        return Array.isArray(body.data) && body.data.length > 0;
    }
    if (platform === "youtube") {
        const response = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(parsed.youtubeVideoId)}` +
            `&key=${encodeURIComponent(youtubeApiKey.value())}`,
        );
        if (!response.ok) throw new Error(`YouTube API request failed (${response.status}).`);
        const body = await response.json();
        return body.items?.[0]?.snippet?.liveBroadcastContent === "live";
    }
    return false;
}

exports.goLive = functions.runWith(LIVE_SECRETS).https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const creationId = requireCreationId(data && data.creationId);
    const platform = data?.platform;
    if (!LIVE_PLATFORM_HOSTS[platform]) {
        throw new functions.https.HttpsError("invalid-argument", "Platform must be 'twitch' or 'youtube'.");
    }
    const parsed = parseStreamUrl(platform, data?.url);
    if (!parsed) {
        throw new functions.https.HttpsError("invalid-argument",
            platform === "youtube" ?
                "A valid https YouTube video/stream URL is required (watch?v=... or youtu.be/...)." :
                "A valid https Twitch channel URL is required.");
    }

    const creationRef = db.doc(`creations/${creationId}`);
    const creationSnap = await creationRef.get();
    if (!creationSnap.exists) {
        throw new functions.https.HttpsError("not-found", "The creation does not exist.");
    }
    if (creationSnap.data().userId !== uid) {
        throw new functions.https.HttpsError("permission-denied", "You can only go live with your own creations.");
    }

    let isLive;
    try {
        isLive = await verifyStreamIsLive(platform, parsed);
    } catch (error) {
        console.error("Live verification failed:", error);
        throw new functions.https.HttpsError("unavailable", "Stream verification is temporarily unavailable. Please try again.");
    }
    if (!isLive) {
        throw new functions.https.HttpsError("failed-precondition", "No live stream was found on this channel.");
    }

    const now = admin.firestore.Timestamp.now();
    const liveStream = {
        platform,
        url: parsed.url,
        startedAt: now,
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + LIVE_STREAM_TTL_MS),
        verifiedAt: now,
    };

    // Max. 1 Live-Creation pro User: die alte Session (Pointer auf users/{uid})
    // wird in derselben Transaktion beendet.
    const userRef = db.doc(`users/${uid}`);
    await db.runTransaction(async (tx) => {
        const userSnap = await tx.get(userRef);
        const previousId = userSnap.data()?.liveCreationId;
        let previousRef = null;
        if (previousId && previousId !== creationId) {
            previousRef = db.doc(`creations/${previousId}`);
            const previousSnap = await tx.get(previousRef);
            if (!previousSnap.exists) previousRef = null;
        }
        if (previousRef) tx.update(previousRef, {liveStream: admin.firestore.FieldValue.delete()});
        tx.update(creationRef, {liveStream});
        tx.set(userRef, {liveCreationId: creationId}, {merge: true});
    });
    return {success: true, expiresAt: liveStream.expiresAt.toMillis()};
});

// Beendet die Live-Session des Aufrufers (idempotent). Räumt sowohl das
// Pointer-Ziel als auch eine optional explizit genannte eigene Creation ab —
// so lassen sich auch abgelaufene Altlasten ohne gültigen Pointer entfernen.
exports.endLive = functions.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const requestedId = data?.creationId ? requireCreationId(data.creationId) : null;
    const userRef = db.doc(`users/${uid}`);
    await db.runTransaction(async (tx) => {
        const userSnap = await tx.get(userRef);
        const pointerId = userSnap.data()?.liveCreationId || null;
        const targetIds = [...new Set([pointerId, requestedId].filter(Boolean))];
        const clearRefs = [];
        for (const targetId of targetIds) {
            const ref = db.doc(`creations/${targetId}`);
            const snap = await tx.get(ref);
            if (snap.exists && snap.data().userId === uid && snap.data().liveStream) clearRefs.push(ref);
        }
        for (const ref of clearRefs) tx.update(ref, {liveStream: admin.firestore.FieldValue.delete()});
        if (pointerId) tx.set(userRef, {liveCreationId: admin.firestore.FieldValue.delete()}, {merge: true});
    });
    return {success: true};
});

// Setzt/löscht den Overlay-QR eines registrierten Desktop-Clients remote.
// Zustellung über das clientInstallQueues-Doc, auf dem der Client sowieso einen
// Listener hat — 0 zusätzliche Reads auf Empfängerseite.
exports.setClientOverlayQr = functions.https.onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const clientId = requireClientId(data && data.clientId);
    const entry = data?.entry || null;

    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.data()?.clients?.[clientId]?.remoteInstall) {
        throw new functions.https.HttpsError("not-found", "The selected desktop client is not registered.");
    }

    let payload = null;
    if (entry) {
        const creationId = requireCreationId(entry.creationId);
        const creationSnap = await db.doc(`creations/${creationId}`).get();
        if (!creationSnap.exists || creationSnap.data().userId !== uid) {
            throw new functions.https.HttpsError("permission-denied", "You can only show the QR of your own creations.");
        }
        payload = {
            creationId,
            title: String(creationSnap.data().title || "").slice(0, 200),
            setAt: admin.firestore.Timestamp.now(),
        };
    }

    await getClientQueueRef(uid, clientId).set({
        uid,
        clientId,
        overlayQr: payload || admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.Timestamp.now(),
    }, {merge: true});
    return {success: true};
});

// Re-verifiziert alle 15 Min ausschließlich die aktuell geflaggten Creations
// (meist 0–2) und beendet Sessions, deren Stream offline ging — begrenzt auch
// unterschlagene OBS-Enden (modifizierter Client) auf max. ~15 Minuten.
// Räumt zusätzlich abgelaufene liveStream-Felder ab, damit keine Altlasten
// in den Dokumenten (und im Suchindex) liegen bleiben.
exports.sweepLiveStreams = functions.runWith(LIVE_SECRETS).pubsub
    .schedule("every 15 minutes")
    .onRun(async () => {
        const now = admin.firestore.Timestamp.now();

        const clearLive = async (docSnap) => {
            const userId = docSnap.data().userId;
            const batch = db.batch();
            batch.update(docSnap.ref, {liveStream: admin.firestore.FieldValue.delete()});
            if (userId) {
                const userRef = db.doc(`users/${userId}`);
                const userSnap = await userRef.get();
                if (userSnap.data()?.liveCreationId === docSnap.id) {
                    batch.set(userRef, {liveCreationId: admin.firestore.FieldValue.delete()}, {merge: true});
                }
            }
            await batch.commit();
        };

        // Abgelaufene Sessions (Client-Expiry längst erreicht): direkt aufräumen.
        const expired = await db.collection("creations").where("liveStream.expiresAt", "<=", now).get();
        for (const docSnap of expired.docs) {
            await clearLive(docSnap);
            console.log(`Cleared expired live session on creation ${docSnap.id}.`);
        }

        // Aktive Sessions: gegen die Plattform-API re-verifizieren.
        const active = await db.collection("creations").where("liveStream.expiresAt", ">", now).get();
        for (const docSnap of active.docs) {
            const liveStream = docSnap.data().liveStream || {};
            const parsed = parseStreamUrl(liveStream.platform, liveStream.url);
            let stillLive = false;
            try {
                stillLive = parsed ? await verifyStreamIsLive(liveStream.platform, parsed) : false;
            } catch (error) {
                // API-Ausfall: lieber bis zum nächsten Sweep live lassen als
                // eine echte Session fälschlich zu beenden.
                console.warn(`Live re-verification failed for ${docSnap.id}, keeping:`, error.message);
                continue;
            }
            if (!stillLive) {
                await clearLive(docSnap);
                console.log(`Ended live session on creation ${docSnap.id} (stream offline).`);
            }
        }
        return null;
    });

// --- Search Index Sync Functions ---
// Kompakter Suchindex in Firestore: ein Dokument pro Spiel unter searchIndex/{game},
// mit einer entries-Map (creationId -> kompakter Eintrag). Der Client lädt das Doc
// mit 1 Read und sucht lokal (Fuse.js) — Ersatz für den gelöschten Algolia-Account.
// Kapazität: ~700-1000 Bytes/Eintrag -> ~1000+ Einträge pro Doc unter dem 1-MiB-Limit.
// Sollte ein Spiel dem Limit nahekommen (count als Frühwarnung beobachten), auf
// Shards umstellen: searchIndex/{game}-0, -1, ... per hash(creationId) % shardCount.

// Welche Spiele indexiert werden, bestimmt jetzt die Games-Registry
// (getRegistryGameIds, meta/games) — inkl. deaktivierter Spiele, da
// Deaktivieren nur die UI ausblendet und keine Daten zerstört.

// Kurze Feldnamen halten das Index-Dokument klein. Muss zu
// src/firebase/searchIndexService.js (entryToCreation) passen.
const buildIndexEntry = (data) => ({
    t: data.title || '',
    d: (data.description || '').slice(0, 200),
    tg: data.tags || [],
    c: data.category || '',
    p: data.platform || 'pc',
    m: data.modStatus || 'NoMods',
    dlc: data.requiredDlcs || [],
    img: data.imageUrls?.[0] || null,
    vid: data.videoUrls?.[0] || null,
    l: data.likes || 0,
    dl: data.dislikes || 0,
    v: data.views || 0,
    ca: data.createdAt?.toMillis?.() || Date.now(),
    u: data.userId || '',
    un: data.username || '',
    up: data.userProfilePictureUrl || null,
    s: data.status || 'wip',
    // Activity-Score fürs Feed-Ranking (gepflegt von onCreationActivityScore)
    as: data.activityScore || 0,
    aa: data.activityAt?.toMillis?.() || null,
    // Live-Status (gepflegt von goLive/endLive/sweepLiveStreams): Plattform +
    // live-bis. Karten/Feed brauchen keine Stream-URL — die liefert die
    // Detailseite aus dem vollen Dokument.
    lp: data.liveStream?.platform || null,
    lu: data.liveStream?.expiresAt?.toMillis?.() || null,
});

/**
 * Hält searchIndex/{game} synchron mit der creations-Collection.
 * Bewusst eigener Trigger: leichtgewichtig und ohne R2-Kopplung oder das
 * 1GB/300s-Profil der expliziten ZIP-Finalisierung.
 */
exports.syncCreationToSearchIndex = functions.firestore
    .document('creations/{creationId}')
    .onWrite(async (change, context) => {
        const creationId = context.params.creationId;
        const before = change.before.exists ? change.before.data() : null;
        const after = change.after.exists ? change.after.data() : null;
        const entryField = new admin.firestore.FieldPath('entries', creationId);

        const gameBefore = before?.game;
        const gameAfter = after?.game;
        const indexGames = await getRegistryGameIds();

        // Aus dem alten Index entfernen bei Löschung oder Spiel-Wechsel
        if (gameBefore && indexGames.includes(gameBefore) && gameBefore !== gameAfter) {
            await db.doc(`searchIndex/${gameBefore}`)
                .update(entryField, admin.firestore.FieldValue.delete(),
                    'count', admin.firestore.FieldValue.increment(-1))
                .catch(() => null); // Index-Doc existiert evtl. noch nicht
        }

        if (!after) return null;
        if (!indexGames.includes(gameAfter)) {
            console.warn(`Creation ${creationId} has unknown game "${gameAfter}", not indexed.`);
            return null;
        }

        // No-Op-Guard: finalizeBackupUpload schreibt Backup-Felder aufs Doc zurück —
        // ohne diesen Vergleich würde jeder dieser Writes einen Index-Write auslösen.
        if (before && gameBefore === gameAfter) {
            if (JSON.stringify(buildIndexEntry(before)) === JSON.stringify(buildIndexEntry(after))) {
                return null;
            }
        }

        const isNewEntry = !before || gameBefore !== gameAfter;

        // set + merge: atomarer Upsert ohne Vorab-Read, legt das Doc bei Bedarf an
        return db.doc(`searchIndex/${gameAfter}`).set({
            entries: { [creationId]: buildIndexEntry(after) },
            ...(isNewEntry ? { count: admin.firestore.FieldValue.increment(1) } : {}),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    });

// --- Community Search Index ---
// Analog zum Spiel-Index: ein Dokument pro Community unter
// communitySearchIndex/{communityId} mit einer entries-Map (creationId ->
// kompakter Eintrag inkl. Link-Metadaten, Custom-Field-Daten und Creator-Rang).
// Versorgt die Community-Seite (Suche/Filter), das Add-Creations-Popup und
// die Showcase-Applications-Liste mit 1 Read.

const buildCommunityIndexEntry = (creationData, linkData, memberRoles) => ({
    ...buildIndexEntry(creationData),
    g: creationData.game || '',
    sc: creationData.shareCode || null,
    csd: creationData.communitySpecificData?.[linkData.__communityId] || {},
    pin: linkData.pinned || false,
    m4s: linkData.markedForShowcase || false,
    nt: linkData.showcaseNote || '',
    app: linkData.appliedForShowcase || false,
    appAt: linkData.appliedAt?.toMillis?.() || null,
    svu: linkData.showcaseVideoUrl || null,
    snm: linkData.showcaseName || null,
    grp: linkData.showcaseGroupId || null,
    rk: memberRoles || [],
    la: linkData.linkedAt?.toMillis?.() || null,
});

/**
 * Baut den Index einer einzelnen Community komplett neu auf.
 * creationsById kann als Vorlade-Cache übergeben werden (Gesamt-Rebuild).
 */
const rebuildCommunityIndex = async (communityId, creationsById = null) => {
    const [linksSnap, membersSnap] = await Promise.all([
        db.collection(`communitys/${communityId}/creations`).get(),
        db.collection(`communitys/${communityId}/members`).get(),
    ]);
    const rolesByUser = new Map(membersSnap.docs.map(m => [m.id, m.data().roles || []]));

    const entries = {};
    for (const linkDoc of linksSnap.docs) {
        let creationData = creationsById ? creationsById.get(linkDoc.id) : null;
        if (!creationData) {
            const snap = await db.doc(`creations/${linkDoc.id}`).get();
            if (!snap.exists) continue; // verwaister Link
            creationData = snap.data();
        }
        const linkData = { ...linkDoc.data(), __communityId: communityId };
        entries[linkDoc.id] = buildCommunityIndexEntry(
            creationData, linkData, rolesByUser.get(creationData.userId));
    }

    await db.doc(`communitySearchIndex/${communityId}`).set({
        entries,
        count: Object.keys(entries).length,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return Object.keys(entries).length;
};

// --- Showcase index ---
// Self-contained doc per showcase (showcaseIndex/{showcaseId}) so a public
// showcase page loads in one read. A showcase is identified by the durable
// showcaseGroupId stamped on community link docs. Shape:
// { communityId, name, videoUrl, entries: { creationId: <community entry> }, count, updatedAt }.
const rebuildShowcaseIndex = async (communityId, showcaseId) => {
    if (!communityId || !showcaseId) return;
    const showcaseRef = db.doc(`showcaseIndex/${showcaseId}`);
    const linksSnap = await db.collection(`communitys/${communityId}/creations`)
        .where('showcaseGroupId', '==', showcaseId).get();
    if (linksSnap.empty) {
        await showcaseRef.delete().catch(() => null);
        return;
    }
    const membersSnap = await db.collection(`communitys/${communityId}/members`).get();
    const rolesByUser = new Map(membersSnap.docs.map(m => [m.id, m.data().roles || []]));

    const entries = {};
    let name = null, videoUrl = null;
    for (const linkDoc of linksSnap.docs) {
        const link = linkDoc.data();
        if (!name && link.showcaseName) name = link.showcaseName;
        if (!videoUrl && link.showcaseVideoUrl) videoUrl = link.showcaseVideoUrl;
        const creationSnap = await db.doc(`creations/${linkDoc.id}`).get();
        if (!creationSnap.exists) continue; // verwaister Link
        const creationData = creationSnap.data();
        const linkData = { ...link, __communityId: communityId };
        entries[linkDoc.id] = buildCommunityIndexEntry(creationData, linkData, rolesByUser.get(creationData.userId));
    }
    if (Object.keys(entries).length === 0) {
        await showcaseRef.delete().catch(() => null);
        return;
    }
    // Pre-finalize the name lives on the community's showcaseGroups array entry.
    if (!name) {
        const commSnap = await db.doc(`communitys/${communityId}`).get();
        const grp = (commSnap.exists ? (commSnap.data().showcaseGroups || []) : []).find(g => g.id === showcaseId);
        name = (grp && grp.name) || null;
    }
    await showcaseRef.set({
        communityId,
        name: name || null,
        videoUrl: videoUrl || null,
        entries,
        count: Object.keys(entries).length,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
};

// Rebuild every showcase index of a community (used by the admin rebuild path).
const rebuildCommunityShowcaseIndexes = async (communityId) => {
    const linksSnap = await db.collection(`communitys/${communityId}/creations`).get();
    const showcaseIds = new Set();
    linksSnap.docs.forEach(d => { const g = d.data().showcaseGroupId; if (g) showcaseIds.add(g); });
    for (const sid of showcaseIds) {
        await rebuildShowcaseIndex(communityId, sid);
    }
    return showcaseIds.size;
};

/**
 * Hält communitySearchIndex/{communityId} synchron mit den Link-Docs
 * communitys/{communityId}/creations/{creationId} (Quelle für Zuordnung,
 * pinned/showcase/application-Status).
 */
exports.syncCommunityLinkToIndex = functions.firestore
    .document('communitys/{communityId}/creations/{creationId}')
    .onWrite(async (change, context) => {
        const { communityId, creationId } = context.params;
        const indexRef = db.doc(`communitySearchIndex/${communityId}`);
        const entryField = new admin.firestore.FieldPath('entries', creationId);

        // Link gelöscht → Eintrag entfernen
        if (!change.after.exists) {
            return indexRef.update(entryField, admin.firestore.FieldValue.delete(),
                'count', admin.firestore.FieldValue.increment(-1))
                .catch(() => null);
        }

        const linkData = { ...change.after.data(), __communityId: communityId };

        const creationSnap = await db.doc(`creations/${creationId}`).get();
        if (!creationSnap.exists) {
            console.warn(`Link ${communityId}/${creationId} points to missing creation, not indexed.`);
            return null;
        }
        const creationData = creationSnap.data();

        const memberSnap = await db.doc(`communitys/${communityId}/members/${creationData.userId}`).get();
        const memberRoles = memberSnap.exists ? (memberSnap.data().roles || []) : [];

        return indexRef.set({
            entries: { [creationId]: buildCommunityIndexEntry(creationData, linkData, memberRoles) },
            ...(change.before.exists ? {} : { count: admin.firestore.FieldValue.increment(1) }),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    });

/**
 * Baut showcaseIndex/{showcaseId} neu, wenn sich die Showcase-Zugehörigkeit eines
 * Link-Docs ändert (assign/finalize/edit/remove). Läuft parallel zu
 * syncCommunityLinkToIndex auf demselben Pfad.
 */
exports.syncShowcaseIndex = functions.firestore
    .document('communitys/{communityId}/creations/{creationId}')
    .onWrite(async (change, context) => {
        const { communityId } = context.params;
        const before = change.before.exists ? change.before.data() : null;
        const after = change.after.exists ? change.after.data() : null;
        const ids = new Set();
        if (before && before.showcaseGroupId) ids.add(before.showcaseGroupId);
        if (after && after.showcaseGroupId) ids.add(after.showcaseGroupId);
        if (ids.size === 0) return null;
        await Promise.all([...ids].map(sid => rebuildShowcaseIndex(communityId, sid)));
        return null;
    });

/**
 * Zieht Creation-Änderungen (Titel, Tags, Likes, Custom Fields, ...) in alle
 * Community-Indexe nach, in denen die Creation verlinkt ist. Löschungen
 * räumen die Einträge ebenfalls ab (Link-Docs können verwaisen, z.B. bei
 * Account-Löschung).
 */
exports.syncCreationToCommunityIndexes = functions.firestore
    .document('creations/{creationId}')
    .onWrite(async (change, context) => {
        const creationId = context.params.creationId;
        const before = change.before.exists ? change.before.data() : null;
        const after = change.after.exists ? change.after.data() : null;
        const entryField = new admin.firestore.FieldPath('entries', creationId);

        const idsBefore = before?.communityIds || [];
        const idsAfter = after?.communityIds || [];

        // Aus Indexen entfernen, wo die Creation nicht mehr verlinkt ist
        const removed = idsBefore.filter(id => !idsAfter.includes(id));
        await Promise.all(removed.map(cid =>
            db.doc(`communitySearchIndex/${cid}`)
                .update(entryField, admin.firestore.FieldValue.delete(),
                    'count', admin.firestore.FieldValue.increment(-1))
                .catch(() => null)
        ));

        if (!after || idsAfter.length === 0) return null;

        // No-Op-Guard analog zum Spiel-Index (Backup-Rückschreiber etc.)
        if (before) {
            const relevantChanged =
                JSON.stringify(buildIndexEntry(before)) !== JSON.stringify(buildIndexEntry(after)) ||
                JSON.stringify(before.communitySpecificData || {}) !== JSON.stringify(after.communitySpecificData || {}) ||
                (before.shareCode || null) !== (after.shareCode || null) ||
                JSON.stringify(idsBefore) !== JSON.stringify(idsAfter);
            if (!relevantChanged) return null;
        }

        // set+merge merged die nested entry-Map feldweise — Link-Felder
        // (pin/m4s/app/...) bleiben unberührt, da hier nicht enthalten.
        const creationFields = (cid) => ({
            ...buildIndexEntry(after),
            g: after.game || '',
            sc: after.shareCode || null,
            csd: after.communitySpecificData?.[cid] || {},
        });

        await Promise.all(idsAfter.map(cid =>
            db.doc(`communitySearchIndex/${cid}`).set({
                entries: { [creationId]: creationFields(cid) },
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true })
        ));
        return null;
    });

/**
 * Rang-Änderungen eines Mitglieds in die Index-Einträge seiner Creations
 * dieser Community nachziehen.
 */
exports.syncMemberRolesToCommunityIndex = functions.firestore
    .document('communitys/{communityId}/members/{userId}')
    .onUpdate(async (change, context) => {
        const { communityId, userId } = context.params;
        const rolesBefore = change.before.data().roles || [];
        const rolesAfter = change.after.data().roles || [];
        if (JSON.stringify(rolesBefore) === JSON.stringify(rolesAfter)) return null;

        const indexRef = db.doc(`communitySearchIndex/${communityId}`);
        const indexSnap = await indexRef.get();
        if (!indexSnap.exists) return null;

        const entries = indexSnap.data().entries || {};
        const updates = [];
        for (const [creationId, entry] of Object.entries(entries)) {
            if (entry.u === userId) {
                updates.push(new admin.firestore.FieldPath('entries', creationId, 'rk'), rolesAfter);
            }
        }
        if (updates.length === 0) return null;
        return indexRef.update(updates[0], updates[1], ...updates.slice(2));
    });

/**
 * Benachrichtigt alle Admins im In-App-Benachrichtigungssystem,
 * wenn ein neuer Bug-Report eingeht.
 */
exports.onBugReportCreated = functions.firestore
    .document('bugReports/{reportId}')
    .onCreate(async (snap, context) => {
        const report = snap.data();
        const adminsSnap = await db.collection('users').where('role', '==', 'admin').get();
        if (adminsSnap.empty) return null;

        const desc = report.description || '';
        const message = desc.slice(0, 120) + (desc.length > 120 ? '…' : '');
        const title = `New bug report from ${report.username || 'a user'}`;
        const link = `/admin?tab=bug-reports&id=${context.params.reportId}`;
        await Promise.all(adminsSnap.docs.map(a =>
            notifyUser(a.id, 'bugReport', { title, message, link })));
        return null;
    });

// --- Follow / event notifications (inbox doc + web push) ---

// A followed creator posted a new creation → notify their followers.
exports.notifyFollowersOnNewCreation = functions.firestore
    .document('creations/{creationId}')
    .onCreate(async (snap, context) => {
        const creation = snap.data();
        const authorId = creation.userId;
        if (!authorId) return null;
        const authorProfile = await db.doc(`profiles/${authorId}`).get();
        const followers = authorProfile.exists ? (authorProfile.data().followers || []) : [];
        if (followers.length === 0) return null;
        const title = `${creation.username || 'A creator you follow'} posted a new creation`;
        const message = creation.title || '';
        const link = `/creation/${context.params.creationId}`;
        await Promise.all(followers.map(f =>
            notifyUser(f, 'newCreation', { title, message, link })));
        return null;
    });

// --- Activity-Score fürs Feed-Ranking ---
// Akkumulierender Score, der regelmäßiges Pflegen belohnt: +1 pro Changelog-
// Update, max. 1×/Tag (20h-Gate). Abklingen (−30 %/Monat, zusätzlich −80 %/Jahr)
// ist reine Lese-Mathematik — dieselbe Formel wie in src/utils/feedRanking.js;
// gespeichert wird nur der Rohwert zum Zeitpunkt des letzten Inkrements.
// Clients können die Felder nicht schreiben (firestore.rules, isValidCreationUpdate).
const ACTIVITY_GATE_MS = 20 * 60 * 60 * 1000;
const decayActivityScore = (score, activityAtMs, nowMs) => {
    if (!score || score <= 0 || !activityAtMs) return 0;
    const elapsed = Math.max(0, nowMs - activityAtMs);
    const months = elapsed / (30 * 24 * 60 * 60 * 1000);
    const years = elapsed / (365 * 24 * 60 * 60 * 1000);
    return score * Math.pow(0.7, months) * Math.pow(0.2, years);
};

exports.onCreationActivityScore = functions.firestore
    .document('creations/{creationId}')
    .onUpdate(async (change) => {
        const before = change.before.data();
        const after = change.after.data();
        // Nur echte Updates zählen (neuer Changelog-Eintrag)
        if ((after.changelog || []).length <= (before.changelog || []).length) return null;
        const now = Date.now();
        const lastAt = after.activityAt?.toMillis?.() || 0;
        if (now - lastAt < ACTIVITY_GATE_MS) return null; // max. 1×/Tag
        const decayed = decayActivityScore(after.activityScore || 0, lastAt, now);
        await change.after.ref.update({
            activityScore: Math.round((decayed + 1) * 100) / 100,
            activityAt: admin.firestore.Timestamp.fromMillis(now),
        });
        return null;
    });

// Eine Creation wurde bei einem Event eingereicht (eventIds gewachsen) →
// Bestätigung an den Einreicher (Inbox + Push). Läuft serverseitig, damit
// jede Submission-Route (Modal, künftige Flows) abgedeckt ist.
exports.notifyOnEventSubmission = functions.firestore
    .document('creations/{creationId}')
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();
        const beforeIds = before.eventIds || [];
        const newIds = (after.eventIds || []).filter(id => !beforeIds.includes(id));
        if (newIds.length === 0 || !after.userId) return null;
        await Promise.all(newIds.map(async (eventId) => {
            const eventSnap = await db.doc(`events/${eventId}`).get();
            if (!eventSnap.exists) return;
            const event = eventSnap.data();
            await notifyUser(after.userId, 'eventSubmission', {
                title: `Submission accepted: ${event.title}`,
                message: `Your creation "${after.title}" has been submitted to the event.`,
                link: `/event/${eventId}`,
            });
        }));
        return null;
    });

// A followed creation gained a new changelog entry → notify its followers
// (creationFollowers/{creationId}/followers/{uid}).
exports.notifyOnCreationUpdate = functions.firestore
    .document('creations/{creationId}')
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();
        const beforeLen = (before.changelog || []).length;
        const afterLen = (after.changelog || []).length;
        if (afterLen <= beforeLen) return null; // only fire on a new changelog entry
        const creationId = context.params.creationId;
        const followersSnap = await db.collection(`creationFollowers/${creationId}/followers`).get();
        if (followersSnap.empty) return null;
        const latest = after.changelog[after.changelog.length - 1];
        const title = `Update to "${after.title}"`;
        const message = latest && latest.text ? String(latest.text).slice(0, 140) : 'A creation you follow was updated.';
        const link = `/creation/${creationId}`;
        // Autor nicht über sein eigenes Update benachrichtigen
        await Promise.all(followersSnap.docs
            .filter(d => d.id !== after.userId)
            .map(d => notifyUser(d.id, 'creationUpdate', { title, message, link })));
        return null;
    });

// Someone new followed a user → notify the followed user.
exports.notifyOnNewFollower = functions.firestore
    .document('profiles/{userId}')
    .onUpdate(async (change, context) => {
        const beforeFollowers = change.before.data().followers || [];
        const afterFollowers = change.after.data().followers || [];
        if (afterFollowers.length <= beforeFollowers.length) return null;
        const newFollowers = afterFollowers.filter(f => !beforeFollowers.includes(f));
        if (newFollowers.length === 0) return null;
        const followedUserId = context.params.userId;
        await Promise.all(newFollowers.map(async (followerId) => {
            const fProfile = await db.doc(`profiles/${followerId}`).get();
            const fName = fProfile.exists ? (fProfile.data().username || 'Someone') : 'Someone';
            await notifyUser(followedUserId, 'newFollower', {
                title: `${fName} started following you`,
                message: '',
                link: `/profile/${followerId}`,
            });
        }));
        return null;
    });

// --- Report-Zähler serverseitig pflegen (Client darf reportCount nicht mehr
//     direkt erhöhen → verhindert Manipulation/Harassment) ---
exports.onReportCreated = functions.firestore
    .document('reports/{reportId}')
    .onCreate(async (snap) => {
        const r = snap.data();
        if (!r || !r.targetId || !r.targetType) return null;
        const col = r.targetType === 'creation' ? 'creations'
            : (r.targetType === 'user' ? 'users' : null);
        if (!col) return null;
        await db.doc(`${col}/${r.targetId}`)
            .update({ reportCount: admin.firestore.FieldValue.increment(1) })
            .catch(e => console.error('reportCount increment failed:', e.message));
        return null;
    });

// --- Collaboration-Beitritt per Invite-Code (serverseitig, damit Clients nicht
//     mehr alle Collaborations inkl. Invite-Codes auflisten dürfen) ---
exports.joinCollaborationByInviteCode = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in.');
    }
    const userId = context.auth.uid;
    const code = ((data && data.inviteCode) || '').trim();
    if (!code) {
        throw new functions.https.HttpsError('invalid-argument', 'Invite code is required.');
    }

    const snap = await db.collection('collaborations')
        .where('inviteCode', '==', code)
        .where('status', '==', 'active')
        .limit(1)
        .get();
    if (snap.empty) {
        throw new functions.https.HttpsError('not-found', 'Invalid or expired invite code.');
    }

    const collaborationId = snap.docs[0].id;
    const memberRef = db.doc(`collaborations/${collaborationId}/members/${userId}`);
    const memberSnap = await memberRef.get();
    if (memberSnap.exists) {
        throw new functions.https.HttpsError('already-exists', 'You are already a member of this collaboration.');
    }

    const profileSnap = await db.doc(`profiles/${userId}`).get();
    const username = profileSnap.exists ? (profileSnap.data().username || 'Unknown') : 'Unknown';

    const batch = db.batch();
    batch.set(memberRef, {
        role: 'editor',
        joinedAt: admin.firestore.FieldValue.serverTimestamp(),
        username,
    });
    batch.update(db.doc(`collaborations/${collaborationId}`), {
        memberIds: admin.firestore.FieldValue.arrayUnion(userId),
    });
    await batch.commit();

    return { collaborationId };
});

// --- Benachrichtigung: Creation ins Showcase aufgenommen bzw. Bewerbung angenommen ---
exports.notifyOnShowcaseStatus = functions.firestore
    .document('communitys/{communityId}/creations/{creationId}')
    .onWrite(async (change, context) => {
        const before = change.before.exists ? change.before.data() : {};
        const after = change.after.exists ? change.after.data() : {};
        const ownerId = after.userId;
        if (!ownerId) return null;

        const nowShowcased = !!after.showcaseVideoUrl && !before.showcaseVideoUrl;
        const nowMarked = after.markedForShowcase === true &&
            before.markedForShowcase !== true && !after.showcaseVideoUrl;
        // Ablehnung: appliedForShowcase true→false, ohne dass markiert/showcased wurde
        // (grenzt sich von "aus Waitlist entfernen" ab, wo markedForShowcase true war).
        const nowDenied = change.after.exists &&
            before.appliedForShowcase === true && after.appliedForShowcase !== true &&
            before.markedForShowcase !== true && after.markedForShowcase !== true &&
            !after.showcaseVideoUrl && !after.showcaseGroupId;
        if (!nowShowcased && !nowMarked && !nowDenied) return null;

        const communityId = context.params.communityId;
        const comSnap = await db.doc(`communitys/${communityId}`).get();
        if (!comSnap.exists) return null;
        const comName = comSnap.data().name || 'a community';

        if (nowShowcased) {
            const label = after.showcaseName ? `"${after.showcaseName}"` : 'a showcase';
            await notifyUser(ownerId, 'showcased', {
                title: 'Your creation was showcased! 🎉',
                message: `${comName} featured your creation in ${label}.`,
                link: `/creation/${context.params.creationId}`,
            });
        } else if (nowMarked) {
            await notifyUser(ownerId, 'showcaseAccepted', {
                title: 'Showcase application accepted',
                message: `${comName} added your creation to the showcase waitlist.`,
                link: `/creation/${context.params.creationId}`,
            });
        } else if (nowDenied) {
            await notifyUser(ownerId, 'showcaseDenied', {
                title: 'Showcase application update',
                message: `${comName} didn't select your creation for a showcase this time.`,
                link: `/creation/${context.params.creationId}`,
            });
        }
        return null;
    });

// --- Benachrichtigung: Community-Rolle geändert ---
exports.notifyOnCommunityRoleChange = functions.firestore
    .document('communitys/{communityId}/members/{userId}')
    .onUpdate(async (change, context) => {
        const beforeRoles = change.before.data().roles || [];
        const afterRoles = change.after.data().roles || [];
        const same = beforeRoles.length === afterRoles.length &&
            beforeRoles.every(r => afterRoles.includes(r));
        if (same) return null;

        const userId = context.params.userId;
        const communityId = context.params.communityId;
        const comSnap = await db.doc(`communitys/${communityId}`).get();
        if (!comSnap.exists) return null;
        const comData = comSnap.data();
        const roleList = afterRoles.length ? afterRoles.join(', ') : 'member';
        await notifyUser(userId, 'communityRole', {
            title: `Your role changed in ${comData.name || 'a community'}`,
            message: `You are now: ${roleList}.`,
            link: `/community/${comData.slug || communityId}`,
        });
        return null;
    });

// --- Cascade-Cleanup beim Löschen einer Community (serverseitig, da Clients die
//     Index-Docs nicht schreiben/löschen dürfen). Alles best-effort (.catch). ---
exports.onCommunityDelete = functions.firestore
    .document('communitys/{communityId}')
    .onDelete(async (snap, context) => {
        const communityId = context.params.communityId;

        // 1) Community-Link-Docs entfernen (danach räumen die Link-Doc-Trigger die Indexe)
        try {
            const linkSnap = await db.collection(`communitys/${communityId}/creations`).get();
            if (!linkSnap.empty) {
                const b = db.batch();
                linkSnap.docs.forEach(d => b.delete(d.ref));
                await b.commit();
            }
        } catch (e) { console.error('community link cleanup failed:', e.message); }

        // 2) Community-Suchindex + zugehörige Showcase-Indexe löschen
        await db.doc(`communitySearchIndex/${communityId}`).delete().catch(() => {});
        try {
            const showcaseSnap = await db.collection('showcaseIndex')
                .where('communityId', '==', communityId).get();
            await Promise.all(showcaseSnap.docs.map(d => d.ref.delete().catch(() => {})));
        } catch (e) { console.error('showcaseIndex cleanup failed:', e.message); }

        // 3) Events der Community (inkl. voters-Subcollection) löschen
        try {
            const eventsSnap = await db.collection('events')
                .where('communityId', '==', communityId).get();
            for (const evDoc of eventsSnap.docs) {
                const votersSnap = await db.collection(`events/${evDoc.id}/voters`).get();
                const b = db.batch();
                votersSnap.docs.forEach(v => b.delete(v.ref));
                b.delete(evDoc.ref);
                await b.commit();
            }
        } catch (e) { console.error('events cleanup failed:', e.message); }

        return null;
    });

/**
 * Bug-Reports als JSON abrufen (nur Admins) — für Troubleshooting-Tools.
 * ?status=open|closed filtert optional.
 */
app.get("/bugReports", authenticate, async (req, res) => {
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'admin') {
        return res.status(403).json({ error: "Only admins can read bug reports." });
    }
    try {
        const snapshot = await db.collection('bugReports').orderBy('createdAt', 'desc').get();
        let reports = snapshot.docs.map(d => {
            const data = d.data();
            return {
                id: d.id,
                ...data,
                createdAt: data.createdAt?.toDate?.().toISOString() || null,
                closedAt: data.closedAt?.toDate?.().toISOString() || null,
            };
        });
        // In-Memory-Filter statt where+orderBy (spart den Composite-Index)
        if (req.query.status === 'open' || req.query.status === 'closed') {
            reports = reports.filter(r => r.status === req.query.status);
        }
        res.json({ count: reports.length, reports });
    } catch (error) {
        console.error("bugReports read error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- YouTube Channel Feed Proxy ---
// Der RSS-Feed eines Kanals (youtube.com/feeds/videos.xml) ist öffentlich,
// aber im Browser CORS-blockiert — daher dieser kleine Proxy. Kein API-Key nötig.
// Instanz-lokaler Cache reduziert Anfragen an YouTube.
const ytFeedCache = new Map(); // url -> { data, ts }
const YT_FEED_TTL_MS = 15 * 60 * 1000;

const extractChannelId = async (inputUrl) => {
    const parsed = new URL(inputUrl);
    const host = parsed.hostname.replace(/^www\./, '');
    // SSRF-Guard: nur YouTube-Hosts abrufen
    if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'youtu.be') {
        throw new Error('Only YouTube URLs are allowed.');
    }
    const channelMatch = parsed.pathname.match(/\/channel\/(UC[\w-]{22})/);
    if (channelMatch) return channelMatch[1];

    // @handle- oder /c/-URLs: Kanalseite laden und channelId extrahieren
    const pageResponse = await fetch(parsed.href, {
        headers: { 'User-Agent': 'Mozilla/5.0 (PlanetCreations feed fetcher)' },
    });
    if (!pageResponse.ok) throw new Error(`Could not load channel page (HTTP ${pageResponse.status}).`);
    const html = await pageResponse.text();
    const idMatch = html.match(/"channelId":"(UC[\w-]{22})"/) ||
        html.match(/channel_id=(UC[\w-]{22})/);
    if (!idMatch) throw new Error('Could not determine the channel ID from this URL.');
    return idMatch[1];
};

app.get("/youtubeChannelFeed", async (req, res) => {
    const inputUrl = req.query.url;
    if (!inputUrl) return res.status(400).json({ error: 'url query parameter is required.' });

    const cached = ytFeedCache.get(inputUrl);
    if (cached && Date.now() - cached.ts < YT_FEED_TTL_MS) {
        return res.json(cached.data);
    }

    try {
        const channelId = await extractChannelId(inputUrl);
        const feedResponse = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
        if (!feedResponse.ok) throw new Error(`Feed request failed (HTTP ${feedResponse.status}).`);
        const xml = await feedResponse.text();

        const channelTitle = (xml.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
        const videos = [];
        const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
        let entry;
        while ((entry = entryRegex.exec(xml)) !== null) {
            const block = entry[1];
            const id = (block.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1];
            const title = (block.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
            const published = (block.match(/<published>([^<]*)<\/published>/) || [])[1] || null;
            if (id) videos.push({ id, title, published });
        }

        const data = { channelId, channelTitle, videos };
        ytFeedCache.set(inputUrl, { data, ts: Date.now() });
        res.set('Cache-Control', 'public, max-age=900');
        res.json(data);
    } catch (error) {
        console.error('youtubeChannelFeed error:', error.message);
        res.status(502).json({ error: error.message });
    }
});

/**
 * Kompletter Neuaufbau des Suchindex aus der creations-Collection.
 * Einmalig nach dem Deploy aufrufen (Backfill) oder zur Reparatur.
 * Example: https://us-central1-YOUR-PROJECT.cloudfunctions.net/api/rebuildSearchIndex
 */
app.get("/rebuildSearchIndex", authenticate, async (req, res) => {
    // Only allow admins to run this
    const userId = req.user.uid;
    const userDoc = await db.collection('users').doc(userId).get();

    if (!userDoc.exists || userDoc.data().role !== 'admin') {
        return res.status(403).json({ error: "Only admins can rebuild the search index." });
    }

    // scope: 'all' (default) | 'general' (nur Spiel-Indexe) | 'community' (+communityId)
    const scope = req.query.scope || 'all';

    try {
        if (scope === 'community') {
            const communityId = req.query.communityId;
            if (!communityId) {
                return res.status(400).json({ error: "communityId query parameter is required for scope=community." });
            }
            const count = await rebuildCommunityIndex(communityId);
            const showcaseCount = await rebuildCommunityShowcaseIndexes(communityId);
            console.log(`Community index rebuilt for ${communityId}: ${count} entries, ${showcaseCount} showcases`);
            return res.json({ success: true, communityCounts: { [communityId]: count }, showcaseCounts: { [communityId]: showcaseCount } });
        }

        const snapshot = await db.collection('creations').get();

        const registryGameIds = await getRegistryGameIds();
        const perGame = {};
        registryGameIds.forEach(game => { perGame[game] = {}; });
        let skipped = 0;
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            if (perGame[data.game]) {
                perGame[data.game][doc.id] = buildIndexEntry(data);
            } else {
                skipped++;
            }
        });

        // Bewusst ohne merge: kompletter Rebuild entfernt verwaiste Einträge
        const batch = db.batch();
        for (const [game, entries] of Object.entries(perGame)) {
            batch.set(db.doc(`searchIndex/${game}`), {
                entries,
                count: Object.keys(entries).length,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
        // Verwaiste Index-Docs entfernter Spiele abräumen
        const existingIndexes = await db.collection('searchIndex').get();
        existingIndexes.docs.forEach(indexDoc => {
            if (!registryGameIds.includes(indexDoc.id)) {
                console.log(`Deleting orphaned search index for removed game: ${indexDoc.id}`);
                batch.delete(indexDoc.ref);
            }
        });
        await batch.commit();

        const counts = Object.fromEntries(
            Object.entries(perGame).map(([game, entries]) => [game, Object.keys(entries).length])
        );

        if (scope === 'general') {
            console.log("General search index rebuilt:", counts, `(${skipped} skipped)`);
            return res.json({ success: true, counts, skipped });
        }

        // scope=all: Community-Indexe ebenfalls komplett neu aufbauen
        const creationsById = new Map(snapshot.docs.map(doc => [doc.id, doc.data()]));
        const communitiesSnap = await db.collection('communitys').get();
        const communityCounts = {};
        for (const communityDoc of communitiesSnap.docs) {
            communityCounts[communityDoc.id] = await rebuildCommunityIndex(communityDoc.id, creationsById);
            await rebuildCommunityShowcaseIndexes(communityDoc.id);
        }

        console.log("Search index rebuilt:", counts, communityCounts, `(${skipped} skipped)`);
        res.json({ success: true, counts, communityCounts, skipped });
    } catch (error) {
        console.error("Search index rebuild failed:", error);
        res.status(500).json({ error: "Rebuild failed: " + error.message });
    }
});

/**
 * Scheduled function to clean up unverified user accounts after 48 hours.
 * Runs daily at 3:00 AM Europe/Berlin time.
 * Deletes users who haven't verified their email within 48 hours of account creation.
 */
exports.cleanupUnverifiedUsers = functions.pubsub
    .schedule('0 3 * * *')
    .timeZone('Europe/Berlin')
    .onRun(async (context) => {
        const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 hours ago

        console.log(`Starting cleanup of unverified users created before ${cutoff.toISOString()}`);

        let deletedCount = 0;
        let pageToken;

        // Paginate through all users (Firebase limits to 1000 per request)
        do {
            const listUsersResult = await admin.auth().listUsers(1000, pageToken);
            pageToken = listUsersResult.pageToken;

            for (const user of listUsersResult.users) {
                // Check: Not email verified AND created more than 48 hours ago
                if (!user.emailVerified && new Date(user.metadata.creationTime) < cutoff) {
                    console.log(`Deleting unverified user: ${user.email} (created: ${user.metadata.creationTime})`);

                    try {
                        // Delete user from Firebase Auth
                        await admin.auth().deleteUser(user.uid);

                        // Delete associated Firestore documents
                        await Promise.allSettled([
                            db.doc(`users/${user.uid}`).delete(),
                            db.doc(`profiles/${user.uid}`).delete()
                        ]);

                        deletedCount++;
                    } catch (error) {
                        console.error(`Failed to delete user ${user.uid}:`, error);
                    }
                }
            }
        } while (pageToken);

        console.log(`Cleanup completed. Deleted ${deletedCount} unverified users.`);
        return null;
    });
