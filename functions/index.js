const {
    callable: onCall,
    callableWith: onCallWith,
    documentCreated,
    documentDeleted,
    documentUpdated,
    documentWritten,
    enforceAppCheck: ENFORCE_APP_CHECK,
    functions,
    httpWith,
    scheduled,
} = require("./runtime");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const {
    FieldPath,
    FieldValue,
    Timestamp,
} = require("firebase-admin/firestore");
const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    CopyObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const {
    MAX_BACKUP_SIZE_BYTES,
    buildSignedMetadata,
    validateUnsignedMetadata,
    validateUnsignedMediaMetadata,
    validateCreationArchive,
} = require("./backupFormat");
const {
    getEffectiveCommunityPermissionKeys,
    hashCommunityPassword,
    verifyCommunityPassword,
} = require("./communityMembership");
const {
    DISCORD_OAUTH_PROVIDER,
    OAUTH_STATE_TTL_MS,
    buildDiscordAuthorizeUrl,
    getRateLimitDecision,
    hashOAuthState,
    isAllowedCorsOrigin,
    isValidOAuthStateRecord,
} = require("./security");
const {
    COLLABORATION_FILE_ID,
    buildCollaborationStoragePrefix,
    buildCollaborationVersionStorageKey,
    canDownloadCollaborationVersion,
    getCollaborationRetentionLimit,
    getNextVersionNumber,
    getVersionNumber,
    isCollaborationStorageObjectKey,
    isCollaborationVersionStorageKey,
    requireSafeId,
    selectPrunableVersions,
    shouldPromotePendingVersion,
} = require("./collaborationVersioning");
const {
    buildCollaborationReleaseNotification,
    calculateWorkDurationMinutes,
    getCollaborationReleaseRecipientIds,
    getMissingSaveWarning,
    isChangelogOwner,
    canAttachPendingSave,
} = require("./collaborationChangelogState");
const {
    PUBLIC_COLLABORATION_VISIBILITY,
    normalizeCollaborationVisibility,
    buildPublicCollaborationSummary,
    sanitizePublicMember,
    sanitizePublicVersion,
    sanitizePublicUpload,
    sanitizePublicTodo,
} = require("./collaborationPublicView");
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
// werden an die jeweiligen v2-Functions gebunden. .value() darf erst innerhalb
// eines Handlers aufgerufen werden.
const discordClientSecret = defineSecret("DISCORD_CLIENT_SECRET");
const backupSigningKey = defineSecret("BACKUP_SIGNING_KEY");
const r2AccessKeyId = defineSecret("R2_ACCESS_KEY_ID");
const r2SecretAccessKey = defineSecret("R2_SECRET_ACCESS_KEY");
// Nicht-geheime Werte kommen aus functions/.env
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
const app = express();
app.use(cors({
    origin(origin, callback) {
        if (isAllowedCorsOrigin(origin)) {
            return callback(null, true);
        }
        return callback(new Error("Origin is not allowed."));
    },
}));

class RateLimitExceededError extends Error {
    constructor(retryAfterMs) {
        super("Rate limit exceeded.");
        this.name = "RateLimitExceededError";
        this.retryAfterMs = retryAfterMs;
    }
}

async function enforceRateLimit({
    action,
    subject,
    limit,
    windowMs,
}) {
    const nowMs = Date.now();
    const key = crypto.createHash("sha256")
        .update(`${action}:${subject}`, "utf8")
        .digest("hex");
    const ref = db.doc(`securityRateLimits/${key}`);
    await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(ref);
        const current = snap.exists ? snap.data() : {};
        const decision = getRateLimitDecision({
            currentCount: Number(current.count) || 0,
            currentWindowStartedAtMs:
                current.windowStartedAt?.toMillis?.() || 0,
            limit,
            nowMs,
            windowMs,
        });
        if (!decision.allowed) {
            throw new RateLimitExceededError(decision.retryAfterMs);
        }
        transaction.set(ref, {
            action,
            count: decision.count,
            expiresAt: Timestamp.fromMillis(
                decision.windowStartedAtMs + (windowMs * 2),
            ),
            updatedAt: Timestamp.fromMillis(nowMs),
            windowStartedAt: Timestamp.fromMillis(
                decision.windowStartedAtMs,
            ),
        });
    });
}

async function enforceCallableRateLimit(options) {
    try {
        await enforceRateLimit(options);
    } catch (error) {
        if (error instanceof RateLimitExceededError) {
            const retryAfterSeconds = Math.ceil(error.retryAfterMs / 1000);
            throw new functions.https.HttpsError(
                "resource-exhausted",
                `Too many requests. Try again in ${retryAfterSeconds} seconds.`,
                {retryAfterSeconds},
            );
        }
        throw error;
    }
}

const expressRateLimit = (options) => async (req, res, next) => {
    try {
        await enforceRateLimit({
            ...options,
            subject: req.user.uid,
        });
        return next();
    } catch (error) {
        if (error instanceof RateLimitExceededError) {
            const retryAfterSeconds = Math.ceil(error.retryAfterMs / 1000);
            res.set("Retry-After", String(retryAfterSeconds));
            return res.status(429).json({
                error: "Too many requests.",
                retryAfterSeconds,
            });
        }
        return next(error);
    }
};

const verifyAppCheckWhenEnabled = async (req, res, next) => {
    if (!ENFORCE_APP_CHECK) return next();
    const token = req.header("X-Firebase-AppCheck");
    if (!token) {
        return res.status(401).json({error: "Missing App Check token."});
    }
    try {
        req.appCheck = await admin.appCheck().verifyToken(token);
        return next();
    } catch {
        return res.status(401).json({error: "Invalid App Check token."});
    }
};

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
    } catch {
        res.status(403).send('Unauthorized');
    }
};

// --- API Endpoint for signing backups ---
app.post(
    "/signBackup",
    authenticate,
    verifyAppCheckWhenEnabled,
    expressRateLimit({
        action: "sign-backup",
        limit: 60,
        windowMs: 15 * 60 * 1000,
    }),
    async (req, res) => {
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
    },
);

app.get("/getPublicKey", (req, res) => {
    const publicKey = getPublicKeyFromPrivate(backupSigningKey.value());
    if (!publicKey) return res.status(500).send("Signing key is not configured.");
    res.set("Cache-Control", "public, max-age=3600");
    return res.type("text/plain").send(publicKey);
});

// The old endpoint accepted a caller-controlled uid and must never be used again.
app.get("/discordAuthRedirect", (req, res) => res.status(410).send(
    "This Discord linking flow is no longer available. Please start it from PlanetCreations.",
));

exports.startDiscordLink = onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    await enforceCallableRateLimit({
        action: "start-discord-link",
        subject: uid,
        limit: 10,
        windowMs: 60 * 60 * 1000,
    });
    if (!DISCORD_CLIENT_ID || !DISCORD_REDIRECT_URI) {
        console.error("Discord OAuth configuration is incomplete.");
        throw new functions.https.HttpsError(
            "failed-precondition",
            "Discord linking is temporarily unavailable.",
        );
    }
    const state = crypto.randomBytes(32).toString("base64url");
    const nowMs = Date.now();
    await db.doc(`oauthStates/${hashOAuthState(state)}`).create({
        createdAt: Timestamp.fromMillis(nowMs),
        expiresAt: Timestamp.fromMillis(nowMs + OAUTH_STATE_TTL_MS),
        provider: DISCORD_OAUTH_PROVIDER,
        uid,
    });
    return {
        authUrl: buildDiscordAuthorizeUrl({
            clientId: DISCORD_CLIENT_ID,
            redirectUri: DISCORD_REDIRECT_URI,
            state,
        }),
        expiresInSeconds: Math.floor(OAUTH_STATE_TTL_MS / 1000),
    };
});

async function consumeDiscordOAuthState(state) {
    const stateRef = db.doc(`oauthStates/${hashOAuthState(state)}`);
    return db.runTransaction(async (transaction) => {
        const snap = await transaction.get(stateRef);
        const record = snap.exists ? snap.data() : null;
        if (!isValidOAuthStateRecord(record)) {
            throw new Error("Invalid or expired OAuth state.");
        }
        transaction.delete(stateRef);
        return record.uid;
    });
}

async function storeDiscordConnection({
    uid,
    discordUser,
    guildIds,
    refreshToken,
}) {
    const duplicateUsers = await db.collection("users")
        .where("discordId", "==", discordUser.id)
        .limit(2)
        .get();
    if (duplicateUsers.docs.some((doc) => doc.id !== uid)) {
        throw new Error("This Discord account is already linked.");
    }

    const userRef = db.doc(`users/${uid}`);
    const credentialRef = db.doc(`privateOAuthCredentials/${uid}`);
    const accountLinkRef = db.doc(`discordAccountLinks/${discordUser.id}`);
    await db.runTransaction(async (transaction) => {
        const userSnap = await transaction.get(userRef);
        if (!userSnap.exists) throw new Error("PlanetCreations user not found.");
        const accountLinkSnap = await transaction.get(accountLinkRef);
        if (accountLinkSnap.exists &&
            accountLinkSnap.data().uid !== uid) {
            throw new Error("This Discord account is already linked.");
        }

        const previousDiscordId = userSnap.data().discordId;
        let previousLinkRef = null;
        let previousLinkSnap = null;
        if (previousDiscordId && previousDiscordId !== discordUser.id) {
            previousLinkRef = db.doc(
                `discordAccountLinks/${previousDiscordId}`,
            );
            previousLinkSnap = await transaction.get(previousLinkRef);
        }

        if (previousLinkRef && previousLinkSnap.exists &&
            previousLinkSnap.data().uid === uid) {
            transaction.delete(previousLinkRef);
        }
        transaction.set(accountLinkRef, {
            linkedAt: Timestamp.now(),
            uid,
        });
        transaction.set(credentialRef, {
            provider: DISCORD_OAUTH_PROVIDER,
            refreshToken,
            updatedAt: Timestamp.now(),
        });
        transaction.update(userRef, {
            discordGuilds: guildIds,
            discordId: discordUser.id,
            discordLinkedAt: Timestamp.now(),
            discordRefreshToken: FieldValue.delete(),
            discordUsername: discordUser.username,
        });
    });
}

// --- HTTP Endpoint to handle the callback from Discord ---
app.get("/discordCallback", async (req, res) => {
    const {code, state} = req.query;

    if (typeof code !== "string" || code.length > 2048 ||
        typeof state !== "string" || state.length > 256) {
        return res.status(400).send("Missing code or state from Discord.");
    }

    try {
        const uid = await consumeDiscordOAuthState(state);
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
        if (!tokenResponse.ok || !tokenData.access_token ||
            !tokenData.refresh_token) {
            throw new Error("Failed to get access token from Discord.");
        }
        
        const { access_token, refresh_token } = tokenData;

        const userResponse = await fetch("https://discord.com/api/users/@me", {
            headers: { Authorization: `Bearer ${access_token}` },
        });
        const discordUser = await userResponse.json();
        if (!userResponse.ok || !discordUser.id || !discordUser.username) {
            throw new Error("Failed to fetch user info from Discord.");
        }
        
        const guildsResponse = await fetch("https://discord.com/api/users/@me/guilds", {
            headers: { Authorization: `Bearer ${access_token}` },
        });
        const guildsData = await guildsResponse.json();
        if (!guildsResponse.ok) {
            throw new Error("Failed to fetch Discord servers.");
        }
        const guildIds = Array.isArray(guildsData) ? guildsData.map(g => g.id) : [];

        await storeDiscordConnection({
            uid,
            discordUser,
            guildIds,
            refreshToken: refresh_token,
        });
        
        res.redirect("https://www.planetcreations.net/settings?discord-linked=success");

    } catch (error) {
        console.error("Error in Discord callback:", error);
        res.redirect("https://www.planetcreations.net/settings?discord-linked=error");
    }
});



// Export the single Express app as a Cloud Function
// (enthält /signBackup und /discordCallback → braucht beide Secrets)
exports.api = httpWith(
    {secrets: [discordClientSecret, backupSigningKey]},
    app,
);


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

exports.registerDesktopClient = onCall(async (data, context) => {
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
    const now = Timestamp.now();
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

exports.enqueueClientInstall = onCall(async (data, context) => {
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
            requestedAt: Timestamp.fromMillis(nowMs),
            expiresAt: Timestamp.fromMillis(nowMs + CLIENT_COMMAND_TTL_MS),
            status: "pending",
            attempts: 0,
        });
        tx.set(queueRef, {
            uid,
            clientId,
            items,
            updatedAt: Timestamp.fromMillis(nowMs),
        }, {merge: true});
        return {queued: true, commandId, queueSize: items.length};
    });
});

exports.claimClientInstall = onCall(async (data, context) => {
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
            if (changed) tx.set(queueRef, {items, updatedAt: Timestamp.now()}, {merge: true});
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
            claimedAt: Timestamp.fromMillis(nowMs),
            leaseUntil: Timestamp.fromMillis(nowMs + CLIENT_COMMAND_LEASE_MS),
            retryAfter: null,
        };
        items[commandIndex] = claimed;
        tx.set(queueRef, {items, updatedAt: Timestamp.fromMillis(nowMs)}, {merge: true});
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

exports.completeClientInstall = onCall(async (data, context) => {
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
            tx.set(queueRef, {items, updatedAt: Timestamp.fromMillis(nowMs)}, {merge: true});
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
            retryAfter: Timestamp.fromMillis(retryAt),
            lastError: String(data?.message || "Install failed").slice(0, 300),
        };
        tx.set(queueRef, {items, updatedAt: Timestamp.fromMillis(nowMs)}, {merge: true});
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

exports.getUploadUrl = onCallWith(
    uploadFunctionOptions,
    async (data, context) => {
        const uid = requireAuthenticated(context);
        await enforceCallableRateLimit({
            action: "create-upload-url",
            subject: uid,
            limit: 60,
            windowMs: 15 * 60 * 1000,
        });
        const fileName = sanitizeBackupFileName(data && data.fileName);
        const fileSize = data && data.fileSize;
        const ownershipConfirmed = data && data.ownershipConfirmed === true;
        const hostingAccepted = data && data.hostingAccepted === true;
        if (!ownershipConfirmed || !hostingAccepted) {
            throw new functions.https.HttpsError(
                "failed-precondition",
                "You must confirm ownership and accept hosting before uploading a creation package.",
            );
        }
        if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MAX_BACKUP_SIZE_BYTES) {
            throw new functions.https.HttpsError(
                "invalid-argument",
                "The package size must be between 1 byte and 300 MB.",
            );
        }

        const uploadId = crypto.randomUUID();
        const objectKey = `temp-uploads/${uid}/${uploadId}.PlanetCreations`;
        const expiresAt = Timestamp.fromMillis(Date.now() + (10 * 60 * 1000));
        await uploadSessionCollection.doc(uploadId).set({
            uid,
            objectKey,
            originalFileName: fileName,
            expectedSize: fileSize,
            contentType: uploadContentType,
            status: "pending",
            uploadConsent: {
                ownershipConfirmed,
                hostingAccepted,
                confirmedBy: uid,
                confirmedAt: FieldValue.serverTimestamp(),
                version: 1,
            },
            createdAt: FieldValue.serverTimestamp(),
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

exports.abortBackupUpload = onCallWith(
    uploadFunctionOptions,
    async (data, context) => {
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

exports.finalizeBackupUpload = onCallWith(
    {
        concurrency: 2,
        maxInstances: 5,
        memory: "1GiB",
        timeoutSeconds: 300,
        secrets: [backupSigningKey, r2AccessKeyId, r2SecretAccessKey],
    },
    async (data, context) => {
        const uid = requireAuthenticated(context);
        await enforceCallableRateLimit({
            action: "finalize-backup-upload",
            subject: uid,
            limit: 60,
            windowMs: 15 * 60 * 1000,
        });
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
        if (!session.uploadConsent || session.uploadConsent.ownershipConfirmed !== true ||
            session.uploadConsent.hostingAccepted !== true || session.uploadConsent.confirmedBy !== uid) {
            throw new functions.https.HttpsError(
                "failed-precondition",
                "The required upload consent is missing or invalid.",
            );
        }
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
                processingAt: FieldValue.serverTimestamp(),
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
                backupUpdatedAt: FieldValue.serverTimestamp(),
                backupUploadConsent: session.uploadConsent,
            });
            await sessionRef.update({
                status: "completed",
                destinationKey,
                completedAt: FieldValue.serverTimestamp(),
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

exports.getBackupDownloadUrl = onCallWith(
    uploadFunctionOptions,
    async (data) => {
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

exports.removeCreationBackup = onCallWith(
    uploadFunctionOptions,
    async (data, context) => {
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
            backupUpdatedAt: FieldValue.serverTimestamp(),
        });
        return { success: true };
    });


 exports.voteOnCreation = onCall(async (data, context) => {
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

exports.refreshDiscordGuilds = onCallWith(
    {secrets: [discordClientSecret]},
    async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to perform this action.');
    }
    const userId = context.auth.uid;
    await enforceCallableRateLimit({
        action: "refresh-discord-guilds",
        subject: userId,
        limit: 20,
        windowMs: 60 * 60 * 1000,
    });

    try {
        const userRef = db.collection('users').doc(userId);
        const credentialRef = db.doc(`privateOAuthCredentials/${userId}`);
        const [userDoc, credentialDoc] = await Promise.all([
            userRef.get(),
            credentialRef.get(),
        ]);
        const refreshToken = credentialDoc.data()?.refreshToken ||
            userDoc.data()?.discordRefreshToken;

        if (!userDoc.exists || !refreshToken) {
            throw new functions.https.HttpsError('not-found', 'No Discord refresh token found for this user. Please re-link your account.');
        }

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
        if (!tokenResponse.ok || !tokenData.access_token) {
            console.error("Failed to refresh token from Discord for user:", userId, tokenData);
            await Promise.all([
                credentialRef.delete(),
                userRef.update({
                    discordGuilds: [],
                    discordRefreshToken: FieldValue.delete(),
                }),
            ]);
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

        await Promise.all([
            credentialRef.set({
                provider: DISCORD_OAUTH_PROVIDER,
                refreshToken: new_refresh_token || refreshToken,
                updatedAt: Timestamp.now(),
            }),
            userRef.update({
                discordGuilds: guildIds,
                discordRefreshToken: FieldValue.delete(),
            }),
        ]);

        return { success: true, message: `Successfully refreshed and updated ${guildIds.length} guilds.` };

    } catch (error) {
        console.error(`Error refreshing Discord guilds for user ${userId}:`, error);
        if (error.code) throw error;
        throw new functions.https.HttpsError('internal', 'An unexpected error occurred while refreshing your Discord servers.');
    }
    },
);

exports.unlinkDiscordAccount = onCallWith(
    {secrets: [discordClientSecret]},
    async (data, context) => {
        const userId = requireAuthenticated(context);
        await enforceCallableRateLimit({
            action: "unlink-discord-account",
            subject: userId,
            limit: 10,
            windowMs: 60 * 60 * 1000,
        });

        const userRef = db.doc(`users/${userId}`);
        const credentialRef = db.doc(`privateOAuthCredentials/${userId}`);
        const [userSnap, credentialSnap] = await Promise.all([
            userRef.get(),
            credentialRef.get(),
        ]);
        const refreshToken = credentialSnap.data()?.refreshToken ||
            userSnap.data()?.discordRefreshToken;

        if (refreshToken) {
            try {
                const revokeResponse = await fetch(
                    "https://discord.com/api/oauth2/token/revoke",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/x-www-form-urlencoded",
                        },
                        body: new URLSearchParams({
                            client_id: DISCORD_CLIENT_ID,
                            client_secret: discordClientSecret.value(),
                            token: refreshToken,
                            token_type_hint: "refresh_token",
                        }),
                    },
                );
                if (!revokeResponse.ok) {
                    console.warn(
                        "Discord token revocation returned",
                        revokeResponse.status,
                        "for user",
                        userId,
                    );
                }
            } catch (error) {
                console.warn(
                    "Discord token revocation failed for user",
                    userId,
                    error.message,
                );
            }
        }

        await db.runTransaction(async (transaction) => {
            const currentUserSnap = await transaction.get(userRef);
            const discordId = currentUserSnap.data()?.discordId;
            let accountLinkRef = null;
            let accountLinkSnap = null;
            if (discordId) {
                accountLinkRef = db.doc(`discordAccountLinks/${discordId}`);
                accountLinkSnap = await transaction.get(accountLinkRef);
            }
            transaction.delete(credentialRef);
            if (currentUserSnap.exists) {
                transaction.update(userRef, {
                    discordGuilds: FieldValue.delete(),
                    discordId: FieldValue.delete(),
                    discordLinkedAt: FieldValue.delete(),
                    discordRefreshToken: FieldValue.delete(),
                    discordUsername: FieldValue.delete(),
                });
            }
            if (accountLinkRef && accountLinkSnap.exists &&
                accountLinkSnap.data().uid === userId) {
                transaction.delete(accountLinkRef);
            }
        });
        return {success: true};
    },
);

exports.deleteOwnAccount = onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to perform this action.');
    }
    const userId = context.auth.uid;
    console.log(`User ${userId} initiating self-deletion.`);

    try {
        const batch = db.batch();
        const profileRef = db.doc(`profiles/${userId}`);
        const userRef = db.doc(`users/${userId}`);
        const [profileSnap, userSnap] = await Promise.all([
            profileRef.get(),
            userRef.get(),
        ]);
        const username = profileSnap.exists ? profileSnap.data().username.toLowerCase() : null;
        const discordId = userSnap.data()?.discordId;
        const accountLinkRef = discordId ?
            db.doc(`discordAccountLinks/${discordId}`) :
            null;
        const accountLinkSnap = accountLinkRef ?
            await accountLinkRef.get() :
            null;
        
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
        batch.delete(userRef);
        batch.delete(db.doc(`privateOAuthCredentials/${userId}`));
        if (accountLinkRef && accountLinkSnap.exists &&
            accountLinkSnap.data().uid === userId) {
            batch.delete(accountLinkRef);
        }
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

exports.deleteUserAndContent = onCall(async (data, context) => {
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
        const userRef = db.doc(`users/${userIdToDelete}`);
        const [profileSnap, userSnap] = await Promise.all([
            profileRef.get(),
            userRef.get(),
        ]);
        const username = profileSnap.exists ? profileSnap.data().username.toLowerCase() : null;
        const discordId = userSnap.data()?.discordId;
        const accountLinkRef = discordId ?
            db.doc(`discordAccountLinks/${discordId}`) :
            null;
        const accountLinkSnap = accountLinkRef ?
            await accountLinkRef.get() :
            null;
        
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
        batch.delete(userRef);
        batch.delete(db.doc(`privateOAuthCredentials/${userIdToDelete}`));
        if (accountLinkRef && accountLinkSnap.exists &&
            accountLinkSnap.data().uid === userIdToDelete) {
            batch.delete(accountLinkRef);
        }
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

exports.getAllUserEmails = onCall(async (data, context) => {
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

exports.deleteEventAsStaff = onCall(async (data, context) => {
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
        let canManageAllEvents = false;
        let canDeleteOwnEvent = false;
        if (!isSiteStaff) {
            const memberRef = db.collection('communitys').doc(communityId).collection('members').doc(userId);
            const communityRef = db.collection('communitys').doc(communityId);
            const [memberDoc, communityDoc] = await Promise.all([
                memberRef.get(),
                communityRef.get(),
            ]);
            if (memberDoc.exists && communityDoc.exists) {
                const memberData = memberDoc.data();
                const permissions = getEffectiveCommunityPermissionKeys(
                    communityDoc.data(),
                    memberData
                );
                canManageAllEvents = permissions.includes('manageEvents');
                canDeleteOwnEvent = eventData.creatorId === userId &&
                    permissions.includes('createEvents');
            }
        }
        if (!isSiteStaff && !canManageAllEvents && !canDeleteOwnEvent) {
            throw new functions.https.HttpsError(
                'permission-denied', 'You do not have permission to delete this event.');
        }
        const batch = db.batch();
        batch.delete(eventRef);
        const creationsQuery = db.collection('creations').where('eventIds', 'array-contains', eventId);
        const creationsSnapshot = await creationsQuery.get();
        creationsSnapshot.forEach(creationDoc => {
            batch.update(creationDoc.ref, { eventIds: FieldValue.arrayRemove(eventId) });
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




// --- Firestore trigger functions ---


exports.onCreationDelete = documentDeleted(
    'creations/{creationId}',
    async (snap, context) => {
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
    },
    uploadFunctionOptions,
);

exports.onMemberJoin = documentCreated(
    'communitys/{communityId}/members/{userId}',
    async (snap, context) => {
        const communityId = context.params.communityId;
        const communityRef = db.doc(`communitys/${communityId}`);
        return communityRef.update({ memberCount: FieldValue.increment(1) });
    });

exports.onMemberLeave = documentDeleted(
    'communitys/{communityId}/members/{userId}',
    async (snap, context) => {
        const communityId = context.params.communityId;
        const communityRef = db.doc(`communitys/${communityId}`);
        return communityRef.update({ memberCount: FieldValue.increment(-1) });
    });

const buildCommunityMembershipData = (communityId, communityData, profileData) => {
    const defaultRank = String(communityData.defaultRankName || 'member').toLowerCase();
    const roles = [defaultRank];
    const perms = getEffectiveCommunityPermissionKeys(communityData, { roles });
    return {
        member: {
            roles,
            perms,
            username: profileData.username || 'Unknown User',
            joinedAt: FieldValue.serverTimestamp(),
        },
        profileMembership: {
            communityId,
            communityName: communityData.name || 'Community',
            roles,
            perms,
            joinedAt: FieldValue.serverTimestamp(),
        },
    };
};

const addCommunityMemberWithAdmin = async (communityId, userId, communityData, profileData) => {
    const membershipData = buildCommunityMembershipData(
        communityId, communityData, profileData);
    const batch = db.batch();
    batch.set(db.doc(`communitys/${communityId}/members/${userId}`),
        membershipData.member);
    batch.set(db.doc(`profiles/${userId}/communityMemberships/${communityId}`),
        membershipData.profileMembership);
    await batch.commit();
};

const canManageCommunityMembership = async (
    communityId,
    context,
    permission = null,
    ownerOnly = false
) => {
    if (!context.auth) return false;
    const uid = context.auth.uid;
    const siteRole = context.auth.token?.role;
    if (siteRole === 'admin' || (!ownerOnly && siteRole === 'moderator')) return true;

    const [communitySnap, memberSnap] = await Promise.all([
        db.doc(`communitys/${communityId}`).get(),
        db.doc(`communitys/${communityId}/members/${uid}`).get(),
    ]);
    if (!communitySnap.exists) return false;
    if (communitySnap.data().ownerId === uid) return true;
    if (ownerOnly || !memberSnap.exists) return false;
    if (!permission) return false;
    return getEffectiveCommunityPermissionKeys(
        communitySnap.data(),
        memberSnap.data()
    ).includes(permission);
};

exports.removeCommunityCreation = onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'You must be signed in.'
        );
    }
    const communityId = String(data?.communityId || '');
    const creationId = String(data?.creationId || '');
    if (!communityId || !creationId) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'A communityId and creationId are required.'
        );
    }
    if (!await canManageCommunityMembership(
        communityId,
        context,
        'manageCreations'
    )) {
        throw new functions.https.HttpsError(
            'permission-denied',
            'You do not have permission to manage community creations.'
        );
    }

    const creationRef = db.doc(`creations/${creationId}`);
    const linkRef = db.doc(`communitys/${communityId}/creations/${creationId}`);
    const [creationSnap, linkSnap] = await Promise.all([
        creationRef.get(),
        linkRef.get(),
    ]);
    if (!linkSnap.exists) {
        throw new functions.https.HttpsError(
            'not-found',
            'The creation is not linked to this community.'
        );
    }

    const batch = db.batch();
    if (creationSnap.exists) {
        const creationData = creationSnap.data();
        const assignments = Array.isArray(creationData.communityAssignments)
            ? creationData.communityAssignments
            : [];
        batch.set(creationRef, {
            communityIds: FieldValue.arrayRemove(communityId),
            communityAssignments: assignments.filter(
                assignment => assignment?.communityId !== communityId
            ),
        }, { merge: true });
    }
    batch.delete(linkRef);
    const reportRef = db.collection('reports').doc();
    batch.set(reportRef, {
        targetId: creationId,
        targetType: 'creation',
        targetTitle: creationSnap.exists
            ? creationSnap.data().title || linkSnap.data().title || ''
            : linkSnap.data().title || '',
        reason: 'Removed from community by a community manager.',
        reporterId: context.auth.uid,
        timestamp: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    return { ok: true };
});

// Keep the denormalized profile membership in sync with the authoritative member
// document. This lets read-heavy UI paths load ranks together with memberships
// without one additional member-document read per community.
exports.syncCommunityMembershipRoles = documentWritten(
    'communitys/{communityId}/members/{userId}',
    async (change, context) => {
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
        const communitySnap = await db.doc(`communitys/${communityId}`).get();
        const perms = getEffectiveCommunityPermissionKeys(
            communitySnap.exists ? communitySnap.data() : {},
            { ...afterData, roles });

        const existingPerms = Array.isArray(afterData.perms) ? afterData.perms : [];
        if (JSON.stringify(existingPerms) !== JSON.stringify(perms)) {
            await change.after.ref.set({ perms }, { merge: true });
        }
        await membershipRef.set({ roles, perms }, { merge: true });
        return null;
    });

// Kompakter Eintrag fürs Nutzer-Such-Dokument (userSearchIndex/all). Kurze
// Feldnamen halten das Doc klein und müssen zu src/firebase/userIndexService.js
// (entryToUser) passen. ul fällt auf username.toLowerCase() zurück, falls das
// denormalisierte username_lowercase-Feld (noch) fehlt.
// Recompute every member when rank definitions or permission toggles change.
// Writes are chunked below Firestore's 500-operation batch limit.
exports.syncCommunityRankPermissions = documentUpdated(
    'communitys/{communityId}',
    async (change, context) => {
        const beforeRanks = change.before.data().ranks || [];
        const afterData = change.after.data();
        const afterRanks = afterData.ranks || [];
        if (JSON.stringify(beforeRanks) === JSON.stringify(afterRanks)) return null;

        const membersSnap = await db.collection(
            `communitys/${context.params.communityId}/members`).get();
        const pending = membersSnap.docs.filter(memberDoc => {
            const current = Array.isArray(memberDoc.data().perms) ? memberDoc.data().perms : [];
            const next = getEffectiveCommunityPermissionKeys(afterData, memberDoc.data());
            return JSON.stringify(current) !== JSON.stringify(next);
        });

        for (let offset = 0; offset < pending.length; offset += 400) {
            const batch = db.batch();
            pending.slice(offset, offset + 400).forEach(memberDoc => {
                batch.set(memberDoc.ref, {
                    perms: getEffectiveCommunityPermissionKeys(afterData, memberDoc.data()),
                }, { merge: true });
            });
            await batch.commit();
        }
        return null;
    });

exports.decideJoinRequest = onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be signed in.');
    }
    const communityId = String(data?.communityId || '');
    const userId = String(data?.userId || '');
    const decision = String(data?.decision || '');
    if (!communityId || !userId || !['approve', 'decline'].includes(decision)) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid join-request decision.');
    }
    if (!await canManageCommunityMembership(
        communityId,
        context,
        'manageJoinRequests'
    )) {
        throw new functions.https.HttpsError(
            'permission-denied', 'Only community staff can decide join requests.');
    }

    const requestRef = db.doc(`communitys/${communityId}/joinRequests/${userId}`);
    const communityRef = db.doc(`communitys/${communityId}`);
    const profileRef = db.doc(`profiles/${userId}`);
    const memberRef = db.doc(`communitys/${communityId}/members/${userId}`);
    const profileMembershipRef =
        db.doc(`profiles/${userId}/communityMemberships/${communityId}`);
    let communityData;

    await db.runTransaction(async transaction => {
        const [requestSnap, communitySnap, profileSnap, memberSnap] = await Promise.all([
            transaction.get(requestRef),
            transaction.get(communityRef),
            transaction.get(profileRef),
            transaction.get(memberRef),
        ]);
        if (!requestSnap.exists) {
            throw new functions.https.HttpsError('not-found', 'Join request not found.');
        }
        if (!communitySnap.exists || !profileSnap.exists) {
            throw new functions.https.HttpsError(
                'not-found', 'Community or user profile not found.');
        }
        if (decision === 'approve' && memberSnap.exists) {
            throw new functions.https.HttpsError(
                'already-exists', 'This user is already a community member.');
        }

        communityData = communitySnap.data();
        if (decision === 'approve') {
            const membershipData = buildCommunityMembershipData(
                communityId, communityData, profileSnap.data());
            transaction.set(memberRef, membershipData.member);
            transaction.set(profileMembershipRef, membershipData.profileMembership);
        }
        transaction.delete(requestRef);
    });

    const communityName = communityData.name || 'Community';
    await notifyUser(userId, 'communityJoinRequest', {
        title: decision === 'approve' ? 'Join request approved' : 'Join request declined',
        message: decision === 'approve'
            ? `You are now a member of ${communityName}.`
            : `Your request to join ${communityName} was declined.`,
        link: `/community/${communityData.slug || ''}`,
    });
    return { ok: true };
});

exports.onCommunityJoinRequestCreated = documentCreated(
    'communitys/{communityId}/joinRequests/{userId}',
    async (snap, context) => {
        const { communityId, userId } = context.params;
        const communitySnap = await db.doc(`communitys/${communityId}`).get();
        if (!communitySnap.exists) return null;

        const membersRef = db.collection(`communitys/${communityId}/members`);
        const [fixedStaffSnap, permittedStaffSnap] = await Promise.all([
            membersRef.where(
                'roles',
                'array-contains-any',
                ['owner', 'moderator']
            ).get(),
            membersRef.where(
                'perms',
                'array-contains',
                'manageJoinRequests'
            ).get(),
        ]);
        const staffDocs = new Map();
        [...fixedStaffSnap.docs, ...permittedStaffSnap.docs]
            .forEach(staffDoc => staffDocs.set(staffDoc.id, staffDoc));
        const communityData = communitySnap.data();
        const applicant = snap.data().username || 'A user';
        await Promise.all([...staffDocs.values()]
            .filter(staffDoc => staffDoc.id !== userId)
            .map(staffDoc => notifyUser(staffDoc.id, 'communityJoinRequest', {
                title: 'New community join request',
                message: `${applicant} wants to join ${communityData.name || 'your community'}.`,
                link: `/manager/${communityId}?tab=Requests`,
            })));
        return null;
    });

exports.setCommunityJoinPassword = onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be signed in.');
    }
    const communityId = String(data?.communityId || '');
    const action = String(data?.action || 'set');
    if (!communityId || !['set', 'clear'].includes(action)) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid password action.');
    }
    if (!await canManageCommunityMembership(
        communityId,
        context,
        null,
        true
    )) {
        throw new functions.https.HttpsError(
            'permission-denied', 'Only the community owner can change the join password.');
    }

    const privateRef = db.doc(`communitys/${communityId}/private/joinConfig`);
    const communityRef = db.doc(`communitys/${communityId}`);
    if (action === 'clear') {
        const batch = db.batch();
        batch.delete(privateRef);
        batch.set(communityRef, {
            hasJoinPassword: false,
            joinMode: 'open',
        }, { merge: true });
        await batch.commit();
        return { ok: true };
    }

    const password = String(data?.password || '');
    if (password.length < 6 || password.length > 128) {
        throw new functions.https.HttpsError(
            'invalid-argument', 'The password must be between 6 and 128 characters.');
    }
    const passwordData = hashCommunityPassword(password);
    const batch = db.batch();
    batch.set(privateRef, {
        ...passwordData,
        updatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(communityRef, {
        hasJoinPassword: true,
        joinMode: 'password',
    }, { merge: true });
    await batch.commit();
    return { ok: true };
});

exports.joinCommunityWithPassword = onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be signed in.');
    }
    const communityId = String(data?.communityId || '');
    const password = String(data?.password || '');
    if (!communityId || !password) {
        throw new functions.https.HttpsError('invalid-argument', 'Community and password are required.');
    }

    const uid = context.auth.uid;
    await enforceCallableRateLimit({
        action: "join-community-with-password",
        subject: uid,
        limit: 15,
        windowMs: 15 * 60 * 1000,
    });
    const [communitySnap, privateSnap, profileSnap, memberSnap] = await Promise.all([
        db.doc(`communitys/${communityId}`).get(),
        db.doc(`communitys/${communityId}/private/joinConfig`).get(),
        db.doc(`profiles/${uid}`).get(),
        db.doc(`communitys/${communityId}/members/${uid}`).get(),
    ]);
    if (memberSnap.exists) return { ok: true, alreadyMember: true };
    if (!communitySnap.exists || !profileSnap.exists || !privateSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Community join configuration not found.');
    }
    if (communitySnap.data().joinMode !== 'password') {
        throw new functions.https.HttpsError(
            'failed-precondition', 'This community does not currently use password joining.');
    }

    if (!verifyCommunityPassword(password, privateSnap.data())) {
        throw new functions.https.HttpsError('permission-denied', 'Incorrect community password.');
    }
    await addCommunityMemberWithAdmin(communityId, uid, communitySnap.data(), profileSnap.data());
    return { ok: true };
});

exports.onCommunityInviteCreated = documentCreated(
    'communitys/{communityId}/invites/{userId}',
    async (snap, context) => {
        const { communityId, userId } = context.params;
        const communitySnap = await db.doc(`communitys/${communityId}`).get();
        if (!communitySnap.exists) return null;
        const communityData = communitySnap.data();
        await notifyUser(userId, 'communityInvite', {
            title: 'Community invitation',
            message: `You were invited to join ${communityData.name || 'a community'}.`,
            link: '/communitys?tab=Invitations',
        });
        return null;
    });

// Compact user search-index entry. Keep field names aligned with
// src/firebase/userIndexService.js (entryToUser).
const buildUserIndexEntry = (data) => ({
    un: data.username || '',
    ul: (data.username_lowercase || data.username || '').toLowerCase(),
    up: data.profilePictureUrl || null,
    r: data.role || 'user',
});

const isUserIndexable = (data) =>
    Boolean(data && typeof data.username === 'string' && data.username.trim());

exports.onProfileWrite = documentWritten("profiles/{userId}", async (change, context) => {
    const userId = context.params.userId;
    const afterData = change.after.exists ? change.after.data() : null;
    const beforeData = change.before.exists ? change.before.data() : null;
    let normalizedAfterData = afterData;

    // 1) username_lowercase auf dem Profil pflegen (wie bisher). Der Rückschreiber
    //    triggert onProfileWrite erneut — dann greift unten der No-Op-Guard.
    if (afterData && afterData.username && (!beforeData || beforeData.username !== afterData.username)) {
        const usernameLowercase = afterData.username.toLowerCase();
        await change.after.ref.set({ username_lowercase: usernameLowercase }, { merge: true });
        normalizedAfterData = { ...afterData, username_lowercase: usernameLowercase };
    }

    // 2) Kompakten Nutzer-Suchindex (userSearchIndex/all) synchron halten. Analog
    //    zu syncCreationToSearchIndex: 1 Doc mit entries-Map (uid -> Eintrag),
    //    Client lädt es mit 1 Read und sucht lokal (Fuse.js).
    const entryField = new FieldPath('entries', userId);
    const beforeEntry = isUserIndexable(beforeData) ? buildUserIndexEntry(beforeData) : null;
    const afterEntry = isUserIndexable(normalizedAfterData) ? buildUserIndexEntry(normalizedAfterData) : null;

    // Profil gelöscht oder Username entfernt -> vorhandenen Eintrag entfernen.
    if (beforeEntry && !afterEntry) {
        return db.doc('userSearchIndex/all')
            .update(entryField, FieldValue.delete(),
                'count', FieldValue.increment(-1))
            .catch(error => {
                // Vor dem initialen Backfill existiert das Index-Doc evtl. noch nicht.
                if (error.code === 5 || error.code === 'not-found') return null;
                throw error;
            });
    }
    if (!afterEntry) return null;

    // No-Op-Guard: nur schreiben, wenn sich der kompakte Eintrag tatsächlich ändert
    // (username/avatar) — nicht bei jedem unrelated Profil-Feld-Write.
    if (beforeEntry && JSON.stringify(beforeEntry) === JSON.stringify(afterEntry)) {
        return null;
    }

    const isNewEntry = !beforeEntry;
    return db.doc('userSearchIndex/all').set({
        entries: { [userId]: afterEntry },
        ...(isNewEntry ? { count: FieldValue.increment(1) } : {}),
        updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
});

exports.setCustomClaims = documentWritten("users/{userId}", async (change, context) => {
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

exports.onProfileUpdate = documentUpdated('profiles/{userId}', async (change, context) => {
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
    } catch {
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

exports.goLive = onCallWith(LIVE_SECRETS, async (data, context) => {
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

    const now = Timestamp.now();
    const liveStream = {
        platform,
        url: parsed.url,
        startedAt: now,
        expiresAt: Timestamp.fromMillis(Date.now() + LIVE_STREAM_TTL_MS),
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
        if (previousRef) tx.update(previousRef, {liveStream: FieldValue.delete()});
        tx.update(creationRef, {liveStream});
        tx.set(userRef, {liveCreationId: creationId}, {merge: true});
    });
    return {success: true, expiresAt: liveStream.expiresAt.toMillis()};
});

// Beendet die Live-Session des Aufrufers (idempotent). Räumt sowohl das
// Pointer-Ziel als auch eine optional explizit genannte eigene Creation ab —
// so lassen sich auch abgelaufene Altlasten ohne gültigen Pointer entfernen.
exports.endLive = onCall(async (data, context) => {
    const uid = requireAuthenticated(context);
    const requestedId = data?.creationId ? requireCreationId(data.creationId) : null;
    const userRef = db.doc(`users/${uid}`);
    let endedCreationIds = [];
    await db.runTransaction(async (tx) => {
        const userSnap = await tx.get(userRef);
        const pointerId = userSnap.data()?.liveCreationId || null;
        const targetIds = [...new Set([pointerId, requestedId].filter(Boolean))];
        endedCreationIds = targetIds;
        const clearRefs = [];
        for (const targetId of targetIds) {
            const ref = db.doc(`creations/${targetId}`);
            const snap = await tx.get(ref);
            if (snap.exists && snap.data().userId === uid && snap.data().liveStream) clearRefs.push(ref);
        }
        for (const ref of clearRefs) tx.update(ref, {liveStream: FieldValue.delete()});
        if (pointerId) tx.set(userRef, {liveCreationId: FieldValue.delete()}, {merge: true});
    });

    // Benachrichtigt auch Desktop-Clients, auf denen der QR remote oder manuell
    // aktiviert wurde. Der Queue-Listener existiert ohnehin für Direct Installs,
    // daher entstehen auf den Clients keine zusätzlichen Listener/Reads.
    if (endedCreationIds.length > 0) {
        const clientQueuesSnap = await db.collection(`clientInstallQueues/${uid}/clients`).get();
        if (!clientQueuesSnap.empty) {
            const batch = db.batch();
            const clearCommand = {
                creationIds: endedCreationIds,
                setAt: Timestamp.now(),
            };
            clientQueuesSnap.docs.forEach((clientDoc) => batch.set(clientDoc.ref, {
                overlayQr: FieldValue.delete(),
                overlayQrClear: clearCommand,
                updatedAt: Timestamp.now(),
            }, {merge: true}));
            await batch.commit();
        }
    }
    return {success: true};
});

// Setzt/löscht den Overlay-QR eines registrierten Desktop-Clients remote.
// Zustellung über das clientInstallQueues-Doc, auf dem der Client sowieso einen
// Listener hat — 0 zusätzliche Reads auf Empfängerseite.
exports.setClientOverlayQr = onCall(async (data, context) => {
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
            setAt: Timestamp.now(),
        };
    }

    await getClientQueueRef(uid, clientId).set({
        uid,
        clientId,
        overlayQr: payload || FieldValue.delete(),
        updatedAt: Timestamp.now(),
    }, {merge: true});
    return {success: true};
});

// Re-verifiziert alle 15 Min ausschließlich die aktuell geflaggten Creations
// (meist 0–2) und beendet Sessions, deren Stream offline ging — begrenzt auch
// unterschlagene OBS-Enden (modifizierter Client) auf max. ~15 Minuten.
// Räumt zusätzlich abgelaufene liveStream-Felder ab, damit keine Altlasten
// in den Dokumenten (und im Suchindex) liegen bleiben.
exports.sweepLiveStreams = scheduled(
    {
        ...LIVE_SECRETS,
        schedule: "every 15 minutes",
    },
    async () => {
        const now = Timestamp.now();

        const clearLive = async (docSnap) => {
            const userId = docSnap.data().userId;
            const batch = db.batch();
            batch.update(docSnap.ref, {liveStream: FieldValue.delete()});
            if (userId) {
                const userRef = db.doc(`users/${userId}`);
                const userSnap = await userRef.get();
                if (userSnap.data()?.liveCreationId === docSnap.id) {
                    batch.set(userRef, {liveCreationId: FieldValue.delete()}, {merge: true});
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
            let stillLive;
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
exports.syncCreationToSearchIndex = documentWritten(
    'creations/{creationId}',
    async (change, context) => {
        const creationId = context.params.creationId;
        const before = change.before.exists ? change.before.data() : null;
        const after = change.after.exists ? change.after.data() : null;
        const entryField = new FieldPath('entries', creationId);

        const gameBefore = before?.game;
        const gameAfter = after?.game;
        const indexGames = await getRegistryGameIds();

        // Aus dem alten Index entfernen bei Löschung oder Spiel-Wechsel
        if (gameBefore && indexGames.includes(gameBefore) && gameBefore !== gameAfter) {
            await db.doc(`searchIndex/${gameBefore}`)
                .update(entryField, FieldValue.delete(),
                    'count', FieldValue.increment(-1))
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
            ...(isNewEntry ? { count: FieldValue.increment(1) } : {}),
            updatedAt: FieldValue.serverTimestamp(),
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
        updatedAt: FieldValue.serverTimestamp(),
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
        updatedAt: FieldValue.serverTimestamp(),
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
exports.syncCommunityLinkToIndex = documentWritten(
    'communitys/{communityId}/creations/{creationId}',
    async (change, context) => {
        const { communityId, creationId } = context.params;
        const indexRef = db.doc(`communitySearchIndex/${communityId}`);
        const entryField = new FieldPath('entries', creationId);

        // Link gelöscht → Eintrag entfernen
        if (!change.after.exists) {
            return indexRef.update(entryField, FieldValue.delete(),
                'count', FieldValue.increment(-1))
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
            ...(change.before.exists ? {} : { count: FieldValue.increment(1) }),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
    });

/**
 * Baut showcaseIndex/{showcaseId} neu, wenn sich die Showcase-Zugehörigkeit eines
 * Link-Docs ändert (assign/finalize/edit/remove). Läuft parallel zu
 * syncCommunityLinkToIndex auf demselben Pfad.
 */
exports.syncShowcaseIndex = documentWritten(
    'communitys/{communityId}/creations/{creationId}',
    async (change, context) => {
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
exports.syncCreationToCommunityIndexes = documentWritten(
    'creations/{creationId}',
    async (change, context) => {
        const creationId = context.params.creationId;
        const before = change.before.exists ? change.before.data() : null;
        const after = change.after.exists ? change.after.data() : null;
        const entryField = new FieldPath('entries', creationId);

        const idsBefore = before?.communityIds || [];
        const idsAfter = after?.communityIds || [];

        // Aus Indexen entfernen, wo die Creation nicht mehr verlinkt ist
        const removed = idsBefore.filter(id => !idsAfter.includes(id));
        await Promise.all(removed.map(cid =>
            db.doc(`communitySearchIndex/${cid}`)
                .update(entryField, FieldValue.delete(),
                    'count', FieldValue.increment(-1))
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
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true })
        ));
        return null;
    });

/**
 * Rang-Änderungen eines Mitglieds in die Index-Einträge seiner Creations
 * dieser Community nachziehen.
 */
exports.syncMemberRolesToCommunityIndex = documentUpdated(
    'communitys/{communityId}/members/{userId}',
    async (change, context) => {
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
                updates.push(new FieldPath('entries', creationId, 'rk'), rolesAfter);
            }
        }
        if (updates.length === 0) return null;
        return indexRef.update(updates[0], updates[1], ...updates.slice(2));
    });

/**
 * Benachrichtigt alle Admins im In-App-Benachrichtigungssystem,
 * wenn ein neuer Bug-Report eingeht.
 */
exports.onBugReportCreated = documentCreated(
    'bugReports/{reportId}',
    async (snap, context) => {
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
exports.notifyFollowersOnNewCreation = documentCreated(
    'creations/{creationId}',
    async (snap, context) => {
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

exports.onCreationActivityScore = documentUpdated(
    'creations/{creationId}',
    async (change) => {
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
            activityAt: Timestamp.fromMillis(now),
        });
        return null;
    });

// Eine Creation wurde bei einem Event eingereicht (eventIds gewachsen) →
// Bestätigung an den Einreicher (Inbox + Push). Läuft serverseitig, damit
// jede Submission-Route (Modal, künftige Flows) abgedeckt ist.
exports.notifyOnEventSubmission = documentUpdated(
    'creations/{creationId}',
    async (change) => {
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
exports.notifyOnCreationUpdate = documentUpdated(
    'creations/{creationId}',
    async (change, context) => {
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
exports.notifyOnNewFollower = documentUpdated(
    'profiles/{userId}',
    async (change, context) => {
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
exports.onReportCreated = documentCreated(
    'reports/{reportId}',
    async (snap) => {
        const r = snap.data();
        if (!r || !r.targetId || !r.targetType) return null;
        const col = r.targetType === 'creation' ? 'creations'
            : (r.targetType === 'user' ? 'users' : null);
        if (!col) return null;
        await db.doc(`${col}/${r.targetId}`)
            .update({ reportCount: FieldValue.increment(1) })
            .catch(e => console.error('reportCount increment failed:', e.message));
        return null;
    });

// --- Collaboration-Beitritt per Invite-Code (serverseitig, damit Clients nicht
//     mehr alle Collaborations inkl. Invite-Codes auflisten dürfen) ---
exports.joinCollaborationByInviteCode = onCall(async (data, context) => {
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

    // Der Invite-Code lässt nur in 'invite'-Modus direkt beitreten; password/
    // application laufen über joinCollaborationByPassword bzw. applyToCollaboration.
    const collabData = snap.docs[0].data();
    if ((collabData.joinMode || 'invite') !== 'invite') {
        throw new functions.https.HttpsError(
            'failed-precondition',
            collabData.joinMode === 'password'
                ? 'This collaboration requires a join password.'
                : 'This collaboration requires you to apply to join.'
        );
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
    batch.set(memberRef, buildCollaborationMemberDoc('editor', username));
    batch.update(db.doc(`collaborations/${collaborationId}`), {
        memberIds: FieldValue.arrayUnion(userId),
    });
    await batch.commit();

    return { collaborationId };
});

// 8-stelliger Invite-Code (A–Z0–9). Serverseitig erzeugt.
function generateCollaborationInviteCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Standard-Member-Doc. Beitreten = Zustimmung, dass Beiträge in der veröffentlichten
// Creation genannt werden dürfen (Widerruf nur einstimmig — siehe Publish-Flow).
function buildCollaborationMemberDoc(role, username) {
    const now = FieldValue.serverTimestamp();
    return {
        role,
        joinedAt: now,
        username,
        publishConsent: { agreed: true, at: now },
    };
}

// --- Collaboration serverseitig anlegen: verhindert, dass Clients ownerId/memberIds
//     fälschen oder ungeprüfte Docs schreiben (Firestore-Regel verbietet Client-Create). ---
exports.createCollaboration = onCallWith({
        concurrency: 2,
        maxInstances: 5,
        memory: "1GiB",
        timeoutSeconds: 300,
        secrets: [backupSigningKey, r2AccessKeyId, r2SecretAccessKey],
    }, async (data, context) => {
        const userId = requireAuthenticated(context);
        await enforceCallableRateLimit({
            action: "create-collaboration",
            subject: userId,
            limit: 10,
            windowMs: 60 * 60 * 1000,
        });
        const title = ((data && data.title) || "").trim();
        const description = ((data && data.description) || "").trim();
        const game = (data && data.game) || "";
        const visibility = normalizeCollaborationVisibility(
            data && data.visibility,
        );
        const uploadId = ((data && data.initialUploadId) || "").trim();
        if (data && data.bannerImageUrl != null &&
            typeof data.bannerImageUrl !== "string") {
            throw new functions.https.HttpsError(
                "invalid-argument",
                "Banner image must be a URL string.",
            );
        }
        if (data && data.galleryImageUrls != null &&
            !Array.isArray(data.galleryImageUrls)) {
            throw new functions.https.HttpsError(
                "invalid-argument",
                "The project gallery must be an image URL list.",
            );
        }
        const bannerImageUrl = normalizeCollaborationImageUrl(
            data && data.bannerImageUrl,
            "Banner image",
            true,
        );
        const galleryImageUrls = normalizeCollaborationImageUrls(
            data && data.galleryImageUrls,
            "The project gallery",
        );
        const initialNote = ((data && data.initialNote) || "Initial save")
            .trim()
            .slice(0, 500) || "Initial save";
        if (title.length < 3 || title.length > 50) {
            throw new functions.https.HttpsError(
                "invalid-argument",
                "Title must be 3–50 characters.",
            );
        }
        if (description.length > 500) {
            throw new functions.https.HttpsError(
                "invalid-argument",
                "Description must be 500 characters or fewer.",
            );
        }
        if (game !== "planet-coaster-2" && game !== "planet-zoo") {
            throw new functions.https.HttpsError("invalid-argument", "Invalid game.");
        }
        if (!uploadId) {
            throw new functions.https.HttpsError(
                "failed-precondition",
                "An initial save file is required.",
            );
        }
        try {
            requireSafeId(uploadId, "Upload ID");
        } catch (error) {
            throw new functions.https.HttpsError("invalid-argument", error.message);
        }

        const joinMode = ["invite", "password", "application"].includes(
            data && data.joinMode,
        ) ? data.joinMode : "invite";
        let passwordFields = {};
        if (joinMode === "password") {
            const password = ((data && data.password) || "").trim();
            if (password.length < 4) {
                throw new functions.https.HttpsError(
                    "invalid-argument",
                    "Join password must be at least 4 characters.",
                );
            }
            const passwordSalt = crypto.randomBytes(16).toString("hex");
            const passwordHash = crypto
                .createHash("sha256")
                .update(passwordSalt + password)
                .digest("hex");
            passwordFields = {passwordSalt, passwordHash};
        }

        const sessionRef = uploadSessionCollection.doc(uploadId);
        const sessionSnap = await sessionRef.get();
        if (!sessionSnap.exists || sessionSnap.data().uid !== userId) {
            throw new functions.https.HttpsError(
                "not-found",
                "Initial-save upload session not found.",
            );
        }
        const session = sessionSnap.data();
        if (session.status === "completed" && session.collaborationId) {
            return {
                collaborationId: session.collaborationId,
                versionId: session.versionId || null,
                versionNumber: getVersionNumber(session) || 1,
                alreadyCreated: true,
            };
        }
        if (session.status !== "pending" ||
            !session.expiresAt ||
            session.expiresAt.toMillis() < Date.now()) {
            throw new functions.https.HttpsError(
                "failed-precondition",
                "The initial-save upload expired or was already used.",
            );
        }
        if (!session.uploadConsent ||
            session.uploadConsent.ownershipConfirmed !== true ||
            session.uploadConsent.hostingAccepted !== true ||
            session.uploadConsent.confirmedBy !== userId ||
            !isOwnedObjectKey(session.objectKey, userId, "temp-uploads")) {
            throw new functions.https.HttpsError(
                "permission-denied",
                "The initial-save upload session is invalid.",
            );
        }

        const profileSnap = await db.doc(`profiles/${userId}`).get();
        const username = profileSnap.exists ?
            (profileSnap.data().username || "Unknown") :
            "Unknown";
        const collaborationRef = db.collection("collaborations").doc();
        const memberRef = collaborationRef.collection("members").doc(userId);
        const fileRef = collaborationRef.collection("files").doc(
            COLLABORATION_FILE_ID,
        );
        const versionRef = fileRef.collection("versions").doc();
        const uploadRef = collaborationRef.collection("uploads").doc();
        const destinationKey = buildCollaborationVersionStorageKey(
            collaborationRef.id,
            versionRef.id,
        );
        const processingToken = crypto.randomUUID();

        await db.runTransaction(async (transaction) => {
            const latestSession = await transaction.get(sessionRef);
            if (!latestSession.exists ||
                latestSession.data().uid !== userId ||
                latestSession.data().status !== "pending") {
                throw new functions.https.HttpsError(
                    "aborted",
                    "The initial-save upload is already being processed.",
                );
            }
            transaction.update(sessionRef, {
                status: "processing",
                processingToken,
                collaborationId: collaborationRef.id,
                processingAt: FieldValue.serverTimestamp(),
            });
        });

        let copied = false;
        let committed = false;
        try {
            const bucket = getR2Bucket();
            const head = await getS3().send(new HeadObjectCommand({
                Bucket: bucket,
                Key: session.objectKey,
            }));
            if (head.ContentLength !== session.expectedSize ||
                head.ContentLength > MAX_BACKUP_SIZE_BYTES ||
                head.ContentType !== uploadContentType) {
                throw new Error(
                    "The initial save size or content type does not match its upload session.",
                );
            }
            const object = await getS3().send(new GetObjectCommand({
                Bucket: bucket,
                Key: session.objectKey,
            }));
            const fileBuffer = await r2BodyToBuffer(object.Body);
            const publicKey = getPublicKeyFromPrivate(backupSigningKey.value());
            const validation = validateBackupBuffer(
                fileBuffer,
                publicKey,
                await getAllowedGameExtensions(),
            );
            if (!validation.valid) throw new Error(validation.error);
            if (validation.metadata.signerUid !== userId) {
                throw new Error(
                    "The initial package signer does not match the collaboration owner.",
                );
            }
            if (validation.metadata.gameId !== game) {
                throw new Error(
                    "The game in the initial save does not match the collaboration.",
                );
            }

            await getS3().send(new CopyObjectCommand({
                Bucket: bucket,
                CopySource: encodeCopySource(bucket, session.objectKey),
                Key: destinationKey,
                ContentType: uploadContentType,
                MetadataDirective: "REPLACE",
            }));
            copied = true;

            const now = Timestamp.now();
            const originalFileName =
                validation.metadata.originalFileName || "save";
            const currentVersion = {
                versionId: versionRef.id,
                number: 1,
                uploadedBy: userId,
                uploadedByUsername: username,
                uploadedAt: now,
                sizeBytes: head.ContentLength,
                originalFileName,
                note: initialNote,
                changelogEntryId: uploadRef.id,
                buildEndedAt: now,
            };
            await db.runTransaction(async (transaction) => {
                const latestSession = await transaction.get(sessionRef);
                if (!latestSession.exists ||
                    latestSession.data().status !== "processing" ||
                    latestSession.data().processingToken !== processingToken) {
                    throw new functions.https.HttpsError(
                        "aborted",
                        "The initial-save upload is no longer owned by this request.",
                    );
                }
                transaction.set(collaborationRef, {
                    title,
                    description,
                    game,
                    visibility,
                    bannerImageUrl,
                    galleryImageUrls,
                    ownerId: userId,
                    memberIds: [userId],
                    createdAt: now,
                    updatedAt: now,
                    status: "active",
                    joinMode,
                    ...passwordFields,
                    inviteCode: generateCollaborationInviteCode(),
                    currentVersion,
                    latestChangelog: {
                        entryId: uploadRef.id,
                        userId,
                        username,
                        createdAt: now,
                        hasSave: true,
                        versionId: versionRef.id,
                        versionNumber: 1,
                    },
                });
                transaction.set(
                    memberRef,
                    buildCollaborationMemberDoc("owner", username),
                );
                transaction.set(versionRef, {
                    versionNumber: 1,
                    uploadedBy: userId,
                    uploadedByUsername: username,
                    uploadedAt: now,
                    sizeBytes: head.ContentLength,
                    storageKey: destinationKey,
                    originalFileName,
                    fileKind: validation.metadata.fileKind || null,
                    packageId: validation.metadata.packageId || null,
                    note: initialNote,
                    changelogEntryId: uploadRef.id,
                    buildEndedAt: now,
                    isCurrentVersion: true,
                });
                transaction.set(fileRef, {
                    name: originalFileName,
                    type: game,
                    updatedAt: now,
                    latestVersionNumber: 1,
                    currentVersion: {
                        ...currentVersion,
                        storageKey: destinationKey,
                    },
                });
                transaction.set(uploadRef, {
                    kind: "version",
                    fileId: COLLABORATION_FILE_ID,
                    versionId: versionRef.id,
                    fileName: originalFileName,
                    userId,
                    username,
                    changelog: initialNote,
                    imageUrls: [],
                    completedTodos: [],
                    versionNumber: 1,
                    sizeBytes: head.ContentLength,
                    workDurationMinutes: null,
                    hasSave: true,
                    status: "complete",
                    createdAt: now,
                    updatedAt: now,
                });
                transaction.update(sessionRef, {
                    status: "completed",
                    destinationKey,
                    collaborationId: collaborationRef.id,
                    versionId: versionRef.id,
                    versionNumber: 1,
                    completedAt: now,
                });
            });
            committed = true;
            await deleteR2ObjectSafely(
                session.objectKey,
                "R2 temp cleanup after collaboration creation failed",
            );
            return {
                collaborationId: collaborationRef.id,
                versionId: versionRef.id,
                versionNumber: 1,
            };
        } catch (error) {
            console.error("Collaboration creation failed:", error);
            await deleteR2ObjectSafely(
                session.objectKey,
                "R2 temp cleanup after failed collaboration creation failed",
            );
            if (copied && !committed) {
                await deleteR2ObjectSafely(
                    destinationKey,
                    "R2 initial-version cleanup failed",
                );
            }
            await sessionRef.set({
                status: "rejected",
                error: error.message,
                failedAt: FieldValue.serverTimestamp(),
            }, {merge: true}).catch(() => null);
            throw new functions.https.HttpsError(
                "failed-precondition",
                error.message,
            );
        }
    });

async function listCollaborationR2ObjectKeys(collaborationId) {
    const prefix = buildCollaborationStoragePrefix(collaborationId);
    const keys = [];
    let continuationToken;
    do {
        const result = await getS3().send(new ListObjectsV2Command({
            Bucket: getR2Bucket(),
            Prefix: prefix,
            ContinuationToken: continuationToken,
        }));
        for (const object of result.Contents || []) {
            if (!isCollaborationStorageObjectKey(
                object.Key,
                collaborationId,
            )) {
                throw new Error(
                    `Unsafe object found below collaboration prefix: ${object.Key}`,
                );
            }
            keys.push(object.Key);
        }
        continuationToken = result.IsTruncated ?
            result.NextContinuationToken :
            undefined;
        if (result.IsTruncated && !continuationToken) {
            throw new Error("R2 did not return a continuation token.");
        }
    } while (continuationToken);
    return keys;
}

async function deleteR2Objects(objectKeys) {
    const uniqueKeys = [...new Set(objectKeys)];
    for (let index = 0; index < uniqueKeys.length; index += 20) {
        const chunk = uniqueKeys.slice(index, index + 20);
        await Promise.all(chunk.map((objectKey) =>
            getS3().send(new DeleteObjectCommand({
                Bucket: getR2Bucket(),
                Key: objectKey,
            })),
        ));
    }
    return uniqueKeys.length;
}

async function deleteDocumentRefs(documentRefs) {
    for (let index = 0; index < documentRefs.length; index += 400) {
        const batch = db.batch();
        documentRefs.slice(index, index + 400)
            .forEach((documentRef) => batch.delete(documentRef));
        await batch.commit();
    }
}

// R2 is cleared and verified before Firestore metadata disappears, so a retry
// can never lose the exact object keys required for storage cleanup.
exports.deleteCollaboration = onCallWith({
        concurrency: 2,
        maxInstances: 5,
        memory: "1GiB",
        timeoutSeconds: 300,
        secrets: [r2AccessKeyId, r2SecretAccessKey],
    }, async (data, context) => {
        const userId = requireAuthenticated(context);
        const collaborationId =
            ((data && data.collaborationId) || "").trim();
        try {
            requireSafeId(collaborationId, "Collaboration ID");
        } catch (error) {
            throw new functions.https.HttpsError(
                "invalid-argument",
                error.message,
            );
        }

        const collaborationRef = db.doc(
            `collaborations/${collaborationId}`,
        );
        const collaborationSnap = await collaborationRef.get();
        if (!collaborationSnap.exists) {
            throw new functions.https.HttpsError(
                "not-found",
                "Collaboration not found.",
            );
        }
        const siteRole = context.auth.token &&
            context.auth.token.role;
        const canDelete =
            collaborationSnap.data().ownerId === userId ||
            siteRole === "moderator" ||
            siteRole === "admin";
        if (!canDelete) {
            throw new functions.https.HttpsError(
                "permission-denied",
                "Only the owner or site staff can delete this collaboration.",
            );
        }

        const uploadSessions = await uploadSessionCollection
            .where("collaborationId", "==", collaborationId)
            .get();
        const objectKeys = await listCollaborationR2ObjectKeys(
            collaborationId,
        );
        for (const sessionDocument of uploadSessions.docs) {
            const session = sessionDocument.data();
            if (isOwnedObjectKey(
                session.objectKey,
                session.uid,
                "temp-uploads",
            )) {
                objectKeys.push(session.objectKey);
            }
        }

        const deletedR2ObjectCount = await deleteR2Objects(objectKeys);
        const remainingKeys = await listCollaborationR2ObjectKeys(
            collaborationId,
        );
        if (remainingKeys.length > 0) {
            throw new functions.https.HttpsError(
                "internal",
                "Collaboration files could not be fully removed from R2.",
            );
        }

        await db.recursiveDelete(collaborationRef);
        await deleteDocumentRefs(
            uploadSessions.docs.map((document) => document.ref),
        );

        return {
            success: true,
            deletedR2ObjectCount,
            deletedUploadSessionCount: uploadSessions.size,
        };
    });

// --- Einladung annehmen (serverseitig, damit Member-Docs nicht clientseitig mit
//     beliebiger Rolle geschrieben werden können). ---
exports.acceptCollaborationInvitation = onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in.');
    }
    const userId = context.auth.uid;
    const collaborationId = ((data && data.collaborationId) || '').trim();
    const inviteId = ((data && data.inviteId) || '').trim();
    if (!collaborationId || !inviteId) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing collaboration or invite id.');
    }

    const inviteRef = db.doc(`collaborations/${collaborationId}/invitations/${inviteId}`);
    const inviteSnap = await inviteRef.get();
    if (!inviteSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Invitation not found.');
    }
    const invite = inviteSnap.data();
    if (invite.targetUserId !== userId) {
        throw new functions.https.HttpsError('permission-denied', 'This invitation is not for you.');
    }
    if (invite.status !== 'pending') {
        throw new functions.https.HttpsError('failed-precondition', 'This invitation has already been processed.');
    }

    const memberRef = db.doc(`collaborations/${collaborationId}/members/${userId}`);
    if ((await memberRef.get()).exists) {
        throw new functions.https.HttpsError('already-exists', 'You are already a member of this collaboration.');
    }

    const role = invite.role === 'viewer' ? 'viewer' : 'editor';
    const profileSnap = await db.doc(`profiles/${userId}`).get();
    const username = profileSnap.exists ? (profileSnap.data().username || 'Unknown') : 'Unknown';

    const batch = db.batch();
    batch.set(memberRef, buildCollaborationMemberDoc(role, username));
    batch.update(db.doc(`collaborations/${collaborationId}`), {
        memberIds: FieldValue.arrayUnion(userId),
    });
    batch.update(inviteRef, {
        status: 'accepted',
        respondedAt: FieldValue.serverTimestamp(),
    });
    const userInvites = await db.collection(`users/${userId}/collaborationInvites`)
        .where('inviteId', '==', inviteId)
        .get();
    userInvites.forEach((docSnap) => batch.update(docSnap.ref, {
        status: 'accepted',
        respondedAt: FieldValue.serverTimestamp(),
    }));
    await batch.commit();

    return { ok: true };
});

// Hilfsfunktion: aktive Collaboration per Invite-Code finden (serverseitig, damit
// Clients nicht per Code über alle Collaborations listen können).
async function findCollaborationByCode(code) {
    const snap = await db.collection('collaborations')
        .where('inviteCode', '==', code)
        .where('status', '==', 'active')
        .limit(1)
        .get();
    if (snap.empty) {
        throw new functions.https.HttpsError('not-found', 'Invalid or expired invite code.');
    }
    return snap.docs[0];
}

// --- Join-Infos zum Code (read-only): damit die Join-Seite die richtige UI je
//     nach joinMode zeigen kann, ohne dass Clients per Code listen dürfen. ---
exports.getCollaborationJoinInfo = onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in.');
    }
    const code = ((data && data.inviteCode) || '').trim();
    if (!code) {
        throw new functions.https.HttpsError('invalid-argument', 'Invite code is required.');
    }
    const collabDoc = await findCollaborationByCode(code);
    const collab = collabDoc.data();
    const memberSnap = await db.doc(`collaborations/${collabDoc.id}/members/${context.auth.uid}`).get();
    let applicationStatus = null;
    if ((collab.joinMode || 'invite') === 'application') {
        const appSnap = await db.doc(`collaborations/${collabDoc.id}/applications/${context.auth.uid}`).get();
        if (appSnap.exists) applicationStatus = appSnap.data().status || null;
    }
    return {
        collaborationId: collabDoc.id,
        title: collab.title || '',
        description: collab.description || '',
        game: collab.game || null,
        memberCount: Array.isArray(collab.memberIds) ? collab.memberIds.length : 0,
        joinMode: collab.joinMode || 'invite',
        alreadyMember: memberSnap.exists,
        applicationStatus,
    };
});

// Public discovery is served through allowlisted callable responses. The private
// collaboration document remains member-only because it contains the invite code,
// password hash and internal build/version pointers.
exports.listPublicCollaborations = onCall(async (data, context) => {
    requireAuthenticated(context);
    const snapshot = await db.collection('collaborations')
        .where('visibility', '==', PUBLIC_COLLABORATION_VISIBILITY)
        .limit(60)
        .get();
    const collaborations = snapshot.docs
        .map((collaborationDoc) => buildPublicCollaborationSummary(
            collaborationDoc.id,
            collaborationDoc.data(),
        ))
        .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
    return {collaborations};
});

exports.getPublicCollaborationView = onCall(async (data, context) => {
    requireAuthenticated(context);
    const collaborationId = ((data && data.collaborationId) || '').trim();
    if (!collaborationId) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Missing collaboration id.',
        );
    }
    try {
        requireSafeId(collaborationId, 'Collaboration ID');
    } catch (error) {
        throw new functions.https.HttpsError('invalid-argument', error.message);
    }

    const collaborationRef = db.doc(`collaborations/${collaborationId}`);
    const collaborationSnap = await collaborationRef.get();
    if (!collaborationSnap.exists ||
        collaborationSnap.data().visibility !== PUBLIC_COLLABORATION_VISIBILITY) {
        throw new functions.https.HttpsError(
            'not-found',
            'Public collaboration not found.',
        );
    }

    const [memberSnapshot, versionSnapshot, uploadSnapshot, todoSnapshot] =
        await Promise.all([
            collaborationRef.collection('members').limit(100).get(),
            collaborationRef.collection('files')
                .doc(COLLABORATION_FILE_ID)
                .collection('versions')
                .orderBy('versionNumber', 'desc')
                .limit(100)
                .get(),
            collaborationRef.collection('uploads')
                .orderBy('createdAt', 'desc')
                .limit(100)
                .get(),
            collaborationRef.collection('todos')
                .orderBy('createdAt', 'asc')
                .limit(100)
                .get(),
        ]);

    return {
        collaboration: buildPublicCollaborationSummary(
            collaborationSnap.id,
            collaborationSnap.data(),
        ),
        members: memberSnapshot.docs.map((memberDoc) =>
            sanitizePublicMember(memberDoc.id, memberDoc.data())),
        versions: versionSnapshot.docs.map((versionDoc) =>
            sanitizePublicVersion(versionDoc.id, versionDoc.data())),
        uploads: uploadSnapshot.docs.map((uploadDoc) =>
            sanitizePublicUpload(uploadDoc.id, uploadDoc.data())),
        todos: todoSnapshot.docs.map((todoDoc) =>
            sanitizePublicTodo(todoDoc.id, todoDoc.data())),
    };
});

// --- Beitritt per Passwort (nur joinMode === 'password'). ---
exports.joinCollaborationByPassword = onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in.');
    }
    const userId = context.auth.uid;
    await enforceCallableRateLimit({
        action: "join-collaboration-with-password",
        subject: userId,
        limit: 15,
        windowMs: 15 * 60 * 1000,
    });
    const code = ((data && data.inviteCode) || '').trim();
    const password = ((data && data.password) || '').trim();
    if (!code || !password) {
        throw new functions.https.HttpsError('invalid-argument', 'Invite code and password are required.');
    }
    const collabDoc = await findCollaborationByCode(code);
    const collab = collabDoc.data();
    if ((collab.joinMode || 'invite') !== 'password') {
        throw new functions.https.HttpsError('failed-precondition', 'This collaboration does not use a join password.');
    }
    const hash = crypto.createHash('sha256').update((collab.passwordSalt || '') + password).digest('hex');
    if (hash !== collab.passwordHash) {
        throw new functions.https.HttpsError('permission-denied', 'Incorrect password.');
    }
    const memberRef = db.doc(`collaborations/${collabDoc.id}/members/${userId}`);
    if ((await memberRef.get()).exists) {
        throw new functions.https.HttpsError('already-exists', 'You are already a member of this collaboration.');
    }
    const profileSnap = await db.doc(`profiles/${userId}`).get();
    const username = profileSnap.exists ? (profileSnap.data().username || 'Unknown') : 'Unknown';
    const batch = db.batch();
    batch.set(memberRef, buildCollaborationMemberDoc('editor', username));
    batch.update(collabDoc.ref, { memberIds: FieldValue.arrayUnion(userId) });
    await batch.commit();
    return { collaborationId: collabDoc.id };
});

// --- Beitrittsantrag stellen (nur joinMode === 'application'). ---
exports.applyToCollaboration = onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in.');
    }
    const userId = context.auth.uid;
    const code = ((data && data.inviteCode) || '').trim();
    const message = ((data && data.message) || '').trim().slice(0, 300);
    if (!code) {
        throw new functions.https.HttpsError('invalid-argument', 'Invite code is required.');
    }
    const collabDoc = await findCollaborationByCode(code);
    const collab = collabDoc.data();
    if ((collab.joinMode || 'invite') !== 'application') {
        throw new functions.https.HttpsError('failed-precondition', 'This collaboration does not accept applications.');
    }
    if ((await db.doc(`collaborations/${collabDoc.id}/members/${userId}`).get()).exists) {
        throw new functions.https.HttpsError('already-exists', 'You are already a member of this collaboration.');
    }
    const appRef = db.doc(`collaborations/${collabDoc.id}/applications/${userId}`);
    const existing = await appRef.get();
    if (existing.exists && existing.data().status === 'pending') {
        throw new functions.https.HttpsError('already-exists', 'You already have a pending application.');
    }
    const profileSnap = await db.doc(`profiles/${userId}`).get();
    const username = profileSnap.exists ? (profileSnap.data().username || 'Unknown') : 'Unknown';
    await appRef.set({
        userId,
        username,
        message,
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
    });
    return { collaborationId: collabDoc.id, status: 'pending' };
});

// --- Owner: Bewerbung annehmen (fügt Member hinzu) bzw. ablehnen. ---
exports.respondToCollaborationApplication = onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in.');
    }
    const ownerId = context.auth.uid;
    const collaborationId = ((data && data.collaborationId) || '').trim();
    const applicantId = ((data && data.applicantId) || '').trim();
    const approve = Boolean(data && data.approve);
    if (!collaborationId || !applicantId) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing collaboration or applicant id.');
    }
    const collabRef = db.doc(`collaborations/${collaborationId}`);
    const collabSnap = await collabRef.get();
    if (!collabSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Collaboration not found.');
    }
    if (collabSnap.data().ownerId !== ownerId) {
        throw new functions.https.HttpsError('permission-denied', 'Only the owner can respond to applications.');
    }
    const appRef = db.doc(`collaborations/${collaborationId}/applications/${applicantId}`);
    const appSnap = await appRef.get();
    if (!appSnap.exists || appSnap.data().status !== 'pending') {
        throw new functions.https.HttpsError('failed-precondition', 'No pending application for this user.');
    }

    if (!approve) {
        await appRef.update({ status: 'declined', respondedAt: FieldValue.serverTimestamp() });
        return { ok: true, approved: false };
    }

    const memberRef = db.doc(`collaborations/${collaborationId}/members/${applicantId}`);
    const batch = db.batch();
    if (!(await memberRef.get()).exists) {
        batch.set(memberRef, buildCollaborationMemberDoc('editor', appSnap.data().username || 'Unknown'));
        batch.update(collabRef, { memberIds: FieldValue.arrayUnion(applicantId) });
    }
    batch.update(appRef, { status: 'accepted', respondedAt: FieldValue.serverTimestamp() });
    await batch.commit();
    return { ok: true, approved: true };
});

// --- Owner: Collaboration-Einstellungen bearbeiten (Titel/Beschreibung/Join-Modus/
//     Passwort). Passwort-Hashing läuft serverseitig; game ist nicht änderbar. ---
exports.updateCollaborationSettings = onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in.');
    }
    const userId = context.auth.uid;
    const collaborationId = ((data && data.collaborationId) || '').trim();
    if (!collaborationId) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing collaboration id.');
    }
    const ref = db.doc(`collaborations/${collaborationId}`);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'Collaboration not found.');
    }
    if (snap.data().ownerId !== userId) {
        throw new functions.https.HttpsError('permission-denied', 'Only the owner can edit settings.');
    }

    const update = { updatedAt: FieldValue.serverTimestamp() };
    if (typeof (data && data.title) === 'string') {
        const title = data.title.trim();
        if (title.length < 3 || title.length > 50) {
            throw new functions.https.HttpsError('invalid-argument', 'Title must be 3–50 characters.');
        }
        update.title = title;
    }
    if (typeof (data && data.description) === 'string') {
        if (data.description.length > 500) {
            throw new functions.https.HttpsError('invalid-argument', 'Description must be 500 characters or fewer.');
        }
        update.description = data.description.trim();
    }
    if (data && Object.prototype.hasOwnProperty.call(data, 'visibility')) {
        if (!['public', 'unlisted'].includes(data.visibility)) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Visibility must be public or unlisted.',
            );
        }
        update.visibility = normalizeCollaborationVisibility(data.visibility);
    }
    if (data && Object.prototype.hasOwnProperty.call(data, 'bannerImageUrl')) {
        update.bannerImageUrl = normalizeCollaborationImageUrl(
            data.bannerImageUrl,
            'Banner image',
            true,
        );
    }
    if (data && Object.prototype.hasOwnProperty.call(data, 'galleryImageUrls')) {
        if (!Array.isArray(data.galleryImageUrls)) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'The project gallery must be an image URL list.',
            );
        }
        update.galleryImageUrls = normalizeCollaborationImageUrls(
            data.galleryImageUrls,
            'The project gallery',
        );
    }
    if (data && ['invite', 'password', 'application'].includes(data.joinMode)) {
        update.joinMode = data.joinMode;
        if (data.joinMode === 'password') {
            const pw = ((data && data.password) || '').trim();
            if (pw) {
                if (pw.length < 4) {
                    throw new functions.https.HttpsError('invalid-argument', 'Join password must be at least 4 characters.');
                }
                const passwordSalt = crypto.randomBytes(16).toString('hex');
                update.passwordSalt = passwordSalt;
                update.passwordHash = crypto.createHash('sha256').update(passwordSalt + pw).digest('hex');
            } else if (!snap.data().passwordHash) {
                throw new functions.https.HttpsError('invalid-argument', 'A join password is required for password mode.');
            }
        } else {
            update.passwordHash = FieldValue.delete();
            update.passwordSalt = FieldValue.delete();
        }
    }
    await ref.update(update);
    return { ok: true };
});

// --- Build-Session starten (advisory Turn-Lock: nur einer baut gleichzeitig). ---
//     Ende primär per Log-off/Spiel-Schließen (endBuildSession); Fallback ist der
//     estimate-basierte expiresAt, ab dem jeder lazy übernehmen darf.
exports.startBuildSession = onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in.');
    }
    const userId = context.auth.uid;
    const collaborationId = ((data && data.collaborationId) || '').trim();
    if (!collaborationId) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing collaboration id.');
    }
    try {
        requireSafeId(collaborationId, 'Collaboration ID');
    } catch (error) {
        throw new functions.https.HttpsError('invalid-argument', error.message);
    }
    let estimateMin = Number(data && data.estimateMin);
    const acknowledgeMissingSave = Boolean(
        data && data.acknowledgeMissingSave,
    );
    if (!Number.isFinite(estimateMin) || estimateMin <= 0) estimateMin = 60;
    estimateMin = Math.min(Math.max(Math.round(estimateMin), 5), 480); // 5 min – 8 h

    const ref = db.doc(`collaborations/${collaborationId}`);
    const memberRef = db.doc(`collaborations/${collaborationId}/members/${userId}`);
    const expiredUploadRef = ref.collection("uploads").doc();
    return db.runTransaction(async (transaction) => {
        const [snap, memberSnap] = await Promise.all([
            transaction.get(ref),
            transaction.get(memberRef),
        ]);
        if (!snap.exists) {
            throw new functions.https.HttpsError('not-found', 'Collaboration not found.');
        }
        if (snap.data().status !== 'active') {
            throw new functions.https.HttpsError('failed-precondition', 'Only active collaborations can be built.');
        }
        if (!memberSnap.exists) {
            throw new functions.https.HttpsError('permission-denied', 'You are not a member of this collaboration.');
        }
        if (memberSnap.data().role === 'viewer') {
            throw new functions.https.HttpsError('permission-denied', 'Viewers cannot build.');
        }

        const nowMs = Date.now();
        const lock = snap.data().buildLock;
        const lockExpiresAtMs = lock && lock.expiresAt &&
            typeof lock.expiresAt.toMillis === "function" ?
            lock.expiresAt.toMillis() :
            0;
        if (lock && lock.activeBuilderId && lock.activeBuilderId !== userId &&
            lockExpiresAtMs > nowMs) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                `${lock.username || 'Someone'} is currently building.`,
            );
        }

        let latestChangelog = snap.data().latestChangelog;
        if (lock && lock.activeBuilderId && lockExpiresAtMs <= nowMs) {
            const expiredAtMs = lockExpiresAtMs > 0 ?
                Math.min(lockExpiresAtMs, nowMs) :
                nowMs;
            const endedAt =
                Timestamp.fromMillis(expiredAtMs);
            const startedAtMs = lock.startedAt &&
                typeof lock.startedAt.toMillis === "function" ?
                lock.startedAt.toMillis() :
                null;
            const username = lock.username || "Unknown contributor";
            const workDurationMinutes = calculateWorkDurationMinutes(
                startedAtMs,
                expiredAtMs,
            );
            latestChangelog = {
                entryId: expiredUploadRef.id,
                userId: lock.activeBuilderId,
                username,
                createdAt: endedAt,
                hasSave: false,
                versionId: null,
                versionNumber: null,
                buildSessionId: lock.sessionId || null,
            };
            transaction.set(expiredUploadRef, {
                kind: "changelog",
                userId: lock.activeBuilderId,
                username,
                changelog: "",
                imageUrls: [],
                completedTodos: [],
                versionId: null,
                versionNumber: null,
                fileName: null,
                sizeBytes: null,
                hasSave: false,
                status: "pending-save",
                buildSessionId: lock.sessionId || null,
                buildStartedAt: lock.startedAt || null,
                workDurationMinutes,
                endedBy: null,
                endReason: "expired",
                createdAt: endedAt,
                updatedAt: endedAt,
            });
            if (!acknowledgeMissingSave) {
                transaction.update(ref, {
                    buildLock: FieldValue.delete(),
                    latestChangelog,
                    updatedAt: endedAt,
                });
                return {
                    ok: false,
                    requiresMissingSaveConfirmation: true,
                    missingSave: getMissingSaveWarning(
                        latestChangelog,
                        false,
                    ),
                };
            }
        }

        const missingSave = getMissingSaveWarning(
            latestChangelog,
            acknowledgeMissingSave,
        );
        if (missingSave) {
            return {
                ok: false,
                requiresMissingSaveConfirmation: true,
                missingSave,
            };
        }

        const graceMs = 30 * 60 * 1000; // Fallback-Puffer über die Schätzung hinaus
        const expiresAtMs = nowMs + estimateMin * 60000 + graceMs;
        const buildSessionId = crypto.randomUUID();
        const collaborationUpdate = {
            buildLock: {
                sessionId: buildSessionId,
                activeBuilderId: userId,
                username: memberSnap.data().username || 'Unknown',
                startedAt: Timestamp.fromMillis(nowMs),
                estimateMin,
                expiresAt: Timestamp.fromMillis(expiresAtMs),
            },
            updatedAt: FieldValue.serverTimestamp(),
        };
        if (latestChangelog !== snap.data().latestChangelog) {
            collaborationUpdate.latestChangelog = latestChangelog;
        }
        transaction.update(ref, collaborationUpdate);
        return {
            ok: true,
            buildSessionId,
            expiresAt: expiresAtMs,
            editingOlderVersion: Boolean(acknowledgeMissingSave),
        };
    });
});

// --- Build-Session beenden (Log-off / Spiel-Schließen / manueller Button).
//     `force` erlaubt dem Owner, einen fremden hängenden Lock zu lösen. ---
exports.endBuildSession = onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in.');
    }
    const userId = context.auth.uid;
    const collaborationId = ((data && data.collaborationId) || '').trim();
    const force = Boolean(data && data.force);
    const requestedEndedAtMillis = Number(data && data.endedAtMillis);
    const buildDraft = data && data.buildDraft &&
        typeof data.buildDraft === "object" ?
        data.buildDraft :
        {};
    const changelogDraft = typeof buildDraft.changelog === "string" ?
        buildDraft.changelog.trim() :
        "";
    if (changelogDraft.length > 1000) {
        throw new functions.https.HttpsError(
            "invalid-argument",
            "A changelog can contain up to 1000 characters.",
        );
    }
    const completedTodos = normalizeCollaborationCompletedTodos(
        buildDraft.completedTodos,
    );
    const requestedBuildSessionId =
        typeof (data && data.buildSessionId) === "string" ?
            data.buildSessionId.trim() :
            "";
    if (!collaborationId) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing collaboration id.');
    }
    try {
        requireSafeId(collaborationId, 'Collaboration ID');
        if (requestedBuildSessionId) {
            requireSafeId(requestedBuildSessionId, 'Build session ID');
        }
    } catch (error) {
        throw new functions.https.HttpsError('invalid-argument', error.message);
    }
    const ref = db.doc(`collaborations/${collaborationId}`);
    const uploadRef = ref.collection("uploads").doc();
    const result = await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(ref);
        if (!snap.exists) {
            throw new functions.https.HttpsError(
                'not-found',
                'Collaboration not found.',
            );
        }
        const lock = snap.data().buildLock;
        if (!lock || !lock.activeBuilderId) {
            const latest = snap.data().latestChangelog;
            if (latest && latest.entryId && latest.hasSave === false &&
                latest.userId === userId &&
                (!requestedBuildSessionId ||
                    !latest.buildSessionId ||
                    latest.buildSessionId === requestedBuildSessionId)) {
                const pendingRef = ref
                    .collection("uploads")
                    .doc(latest.entryId);
                const pendingSnap = await transaction.get(pendingRef);
                let effectiveChangelog = changelogDraft;
                let effectiveTodos = completedTodos;
                if (pendingSnap.exists &&
                    canAttachPendingSave(pendingSnap.data(), userId)) {
                    const pendingData = pendingSnap.data();
                    effectiveChangelog =
                        pendingData.changelog || changelogDraft;
                    const todoMap = new Map();
                    [
                        ...(pendingData.completedTodos || []),
                        ...completedTodos,
                    ].forEach((todo) => {
                        if (todo && todo.id && todo.text) {
                            todoMap.set(todo.id, todo);
                        }
                    });
                    effectiveTodos = [...todoMap.values()].slice(0, 50);
                    transaction.update(pendingRef, {
                        changelog: effectiveChangelog,
                        completedTodos: effectiveTodos,
                        updatedAt: Timestamp.now(),
                    });
                }
                return {
                    ok: true,
                    alreadyEnded: true,
                    changelogEntryId: latest.entryId || null,
                    changelogUserId: latest.userId,
                    username: latest.username || "Unknown contributor",
                    createdAtMillis: latest.createdAt &&
                        typeof latest.createdAt.toMillis === "function" ?
                        latest.createdAt.toMillis() :
                        null,
                    changelog: effectiveChangelog,
                    completedTodos: effectiveTodos,
                };
            }
            return {ok: true, alreadyEnded: true};
        }

        const isActiveBuilder = lock.activeBuilderId === userId;
        const isOwner = snap.data().ownerId === userId;
        if (!isActiveBuilder && !(force && isOwner)) {
            throw new functions.https.HttpsError(
                'permission-denied',
                'Only the active builder or the owner can end this session.',
            );
        }
        const builderChangelogDraft = isActiveBuilder ?
            changelogDraft :
            "";
        const builderCompletedTodos = isActiveBuilder ?
            completedTodos :
            [];

        const builderId = lock.activeBuilderId;
        const username = lock.username || "Unknown contributor";
        const startedAtMs = lock.startedAt &&
            typeof lock.startedAt.toMillis === "function" ?
                lock.startedAt.toMillis() :
                null;
        const serverNowMs = Date.now();
        const canUseRequestedEnd = isActiveBuilder &&
            Number.isFinite(requestedEndedAtMillis) &&
            requestedEndedAtMillis > 0 &&
            requestedEndedAtMillis <= serverNowMs &&
            (!Number.isFinite(startedAtMs) ||
                requestedEndedAtMillis >= startedAtMs);
        const endedAtMs = canUseRequestedEnd ?
            Math.round(requestedEndedAtMillis) :
            serverNowMs;
        const endedAt =
            Timestamp.fromMillis(endedAtMs);
        const workDurationMinutes = calculateWorkDurationMinutes(
            startedAtMs,
            endedAtMs,
        );
        const pendingEntry = {
            kind: "changelog",
            userId: builderId,
            username,
            changelog: builderChangelogDraft,
            imageUrls: [],
            completedTodos: builderCompletedTodos,
            versionId: null,
            versionNumber: null,
            fileName: null,
            sizeBytes: null,
            hasSave: false,
            status: "pending-save",
            buildSessionId: lock.sessionId || null,
            buildStartedAt: lock.startedAt || null,
            workDurationMinutes,
            endedBy: userId,
            createdAt: endedAt,
            updatedAt: endedAt,
        };
        transaction.set(uploadRef, pendingEntry);
        transaction.update(ref, {
            buildLock: FieldValue.delete(),
            latestChangelog: {
                entryId: uploadRef.id,
                userId: builderId,
                username,
                createdAt: endedAt,
                hasSave: false,
                versionId: null,
                versionNumber: null,
                buildSessionId: lock.sessionId || null,
            },
            updatedAt: endedAt,
        });
        return {
            ok: true,
            changelogEntryId: uploadRef.id,
            changelogUserId: builderId,
            username,
            createdAtMillis: endedAt.toMillis(),
            changelog: builderChangelogDraft,
            completedTodos: builderCompletedTodos,
            releaseNotification: {
                builderId,
                collaborationTitle:
                    snap.data().title || "Collaboration",
                username,
            },
        };
    });
    const {
        releaseNotification,
        ...clientResult
    } = result;
    if (releaseNotification) {
        try {
            const memberSnapshot = await ref.collection("members").get();
            const recipientIds = getCollaborationReleaseRecipientIds(
                memberSnapshot.docs.map((member) => member.id),
                releaseNotification.builderId,
            );
            const notification = buildCollaborationReleaseNotification({
                collaborationId,
                collaborationTitle:
                    releaseNotification.collaborationTitle,
                username: releaseNotification.username,
            });
            const deliveries = await Promise.allSettled(
                recipientIds.map((recipientId) => notifyUser(
                    recipientId,
                    "collaborationAvailable",
                    notification,
                )),
            );
            deliveries.forEach((delivery, index) => {
                if (delivery.status === "rejected") {
                    console.error(
                        `Collaboration release notification failed for ${recipientIds[index]}:`,
                        delivery.reason,
                    );
                }
            });
        } catch (error) {
            console.error(
                `Collaboration release notification fan-out failed for ${collaborationId}:`,
                error,
            );
        }
    }
    return clientResult;
});

async function pruneCollaborationVersions(
    collaborationId,
    versionsRef,
    uploadedBy,
    keep,
    currentVersionId,
) {
    const mine = await versionsRef.where("uploadedBy", "==", uploadedBy).get();
    const versions = mine.docs.map((document) => ({
        id: document.id,
        ref: document.ref,
        storageKey: document.data().storageKey,
        versionNumber: getVersionNumber(document.data()),
    }));
    const prunable = selectPrunableVersions(versions, keep, currentVersionId);
    if (prunable.length === 0) return;

    // Delete the exact-bound object first. If R2 has a transient failure the
    // metadata remains eligible for the next upload's prune pass, giving us a
    // retry path without a scheduler and without orphaning paid storage.
    const safelyDeleted = [];
    for (const version of prunable) {
        if (!isCollaborationVersionStorageKey(
            version.storageKey,
            collaborationId,
            version.id,
        )) {
            console.warn(`Skipped unsafe collaboration version key: ${version.id}`);
            continue;
        }
        await getS3().send(new DeleteObjectCommand({
            Bucket: getR2Bucket(),
            Key: version.storageKey,
        }));
        safelyDeleted.push(version);
    }

    if (safelyDeleted.length === 0) return;
    const batch = db.batch();
    safelyDeleted.forEach((version) => batch.delete(version.ref));
    await batch.commit();
}

async function deleteR2ObjectSafely(objectKey, label) {
    if (!objectKey) return;
    try {
        await getS3().send(new DeleteObjectCommand({
            Bucket: getR2Bucket(),
            Key: objectKey,
        }));
    } catch (error) {
        console.warn(`${label}:`, error.message);
    }
}

// --- Neue Collaboration-Version finalisieren. Nutzt die gleiche signierte
//     .PlanetCreations-Pipeline wie Creation-Backups (getUploadUrl + Signatur),
//     schreibt Metadaten aber ausschließlich serverseitig. Eine Transaktion
//     serialisiert parallele Uploads und vergibt eindeutige Versionsnummern. ---
exports.finalizeCollaborationVersion = onCallWith(
    {
        concurrency: 2,
        maxInstances: 5,
        memory: "1GiB",
        timeoutSeconds: 300,
        secrets: [backupSigningKey, r2AccessKeyId, r2SecretAccessKey],
    },
    async (data, context) => {
        const uid = requireAuthenticated(context);
        await enforceCallableRateLimit({
            action: "finalize-collaboration-version",
            subject: uid,
            limit: 60,
            windowMs: 15 * 60 * 1000,
        });
        const uploadId = data && data.uploadId;
        const collaborationId = ((data && data.collaborationId) || "").trim();
        const changelogEntryId =
            ((data && data.changelogEntryId) || "").trim();
        const note = ((data && data.note) || "").trim().slice(0, 1000);
        const imageUrls = normalizeCollaborationImageUrls(
            data && data.imageUrls,
        );
        const completedTodos = normalizeCollaborationCompletedTodos(
            data && data.completedTodos,
        );
        if (typeof uploadId !== "string" || !collaborationId ||
            !changelogEntryId) {
            throw new functions.https.HttpsError(
                "invalid-argument",
                "Upload, collaboration and changelog IDs are required.",
            );
        }
        try {
            requireSafeId(uploadId, "Upload ID");
            requireSafeId(collaborationId, "Collaboration ID");
            requireSafeId(changelogEntryId, "Changelog ID");
        } catch (error) {
            throw new functions.https.HttpsError("invalid-argument", error.message);
        }

        const collabRef = db.doc(`collaborations/${collaborationId}`);
        const sessionRef = uploadSessionCollection.doc(uploadId);
        const uploadRef = collabRef
            .collection("uploads")
            .doc(changelogEntryId);
        const [sessionSnap, collabSnap, memberSnap, uploadSnap] =
            await Promise.all([
            sessionRef.get(),
            collabRef.get(),
            db.doc(`collaborations/${collaborationId}/members/${uid}`).get(),
            uploadRef.get(),
        ]);
        if (!sessionSnap.exists || sessionSnap.data().uid !== uid) {
            throw new functions.https.HttpsError("not-found", "Upload session not found.");
        }
        if (!collabSnap.exists) {
            throw new functions.https.HttpsError("not-found", "Collaboration not found.");
        }
        if (collabSnap.data().status !== "active") {
            throw new functions.https.HttpsError("failed-precondition", "Only active collaborations accept versions.");
        }
        if (!memberSnap.exists) {
            throw new functions.https.HttpsError(
                "permission-denied",
                "You are no longer a member of this collaboration.",
            );
        }
        const session = sessionSnap.data();
        if (!session.uploadConsent || session.uploadConsent.ownershipConfirmed !== true ||
            session.uploadConsent.hostingAccepted !== true || session.uploadConsent.confirmedBy !== uid) {
            throw new functions.https.HttpsError("failed-precondition", "The required upload consent is missing or invalid.");
        }
        if (session.status === "completed" && session.collaborationId === collaborationId) {
            return {
                success: true,
                alreadyFinalized: true,
                versionId: session.versionId || null,
                versionNumber: session.versionNumber || null,
            };
        }
        if (!uploadSnap.exists ||
            !canAttachPendingSave(uploadSnap.data(), uid)) {
            throw new functions.https.HttpsError(
                "permission-denied",
                "Only the author can attach a save to this pending changelog.",
            );
        }
        if (session.status !== "pending" || !session.expiresAt || session.expiresAt.toMillis() < Date.now()) {
            throw new functions.https.HttpsError("failed-precondition", "The upload session expired or was already used.");
        }
        if (!isOwnedObjectKey(session.objectKey, uid, "temp-uploads")) {
            throw new functions.https.HttpsError("permission-denied", "The upload session is invalid.");
        }
        const processingToken = crypto.randomUUID();
        await db.runTransaction(async (transaction) => {
            const latest = await transaction.get(sessionRef);
            if (!latest.exists || latest.data().uid !== uid || latest.data().status !== "pending") {
                throw new functions.https.HttpsError("aborted", "The upload session is already being processed.");
            }
            transaction.update(sessionRef, {
                status: "processing",
                collaborationId,
                changelogEntryId,
                processingToken,
                processingAt: FieldValue.serverTimestamp(),
            });
        });

        const fileId = COLLABORATION_FILE_ID;
        const fileRef = db.doc(`collaborations/${collaborationId}/files/${fileId}`);
        const versionsRef = fileRef.collection("versions");
        const versionRef = versionsRef.doc();
        const destinationKey = buildCollaborationVersionStorageKey(
            collaborationId,
            versionRef.id,
        );
        let committed = false;
        try {
            const bucket = getR2Bucket();
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
            if (validation.metadata.gameId !== collabSnap.data().game) {
                throw new Error("The game in the package does not match the collaboration.");
            }

            await getS3().send(new CopyObjectCommand({
                Bucket: bucket,
                CopySource: encodeCopySource(bucket, session.objectKey),
                Key: destinationKey,
                ContentType: uploadContentType,
                MetadataDirective: "REPLACE",
            }));

            const username = uploadSnap.data().username ||
                memberSnap.data().username ||
                "Unknown contributor";
            const uploadedAt = Timestamp.now();
            const commitResult = await db.runTransaction(async (transaction) => {
                const [
                    latestSession,
                    latestCollab,
                    latestMember,
                    latestUpload,
                    fileSnap,
                ] = await Promise.all([
                    transaction.get(sessionRef),
                    transaction.get(collabRef),
                    transaction.get(db.doc(`collaborations/${collaborationId}/members/${uid}`)),
                    transaction.get(uploadRef),
                    transaction.get(fileRef),
                ]);
                if (!latestSession.exists ||
                    latestSession.data().status !== "processing" ||
                    latestSession.data().processingToken !== processingToken) {
                    throw new functions.https.HttpsError(
                        "aborted",
                        "The upload session is no longer owned by this request.",
                    );
                }
                if (!latestCollab.exists || !latestMember.exists) {
                    throw new functions.https.HttpsError(
                        "permission-denied",
                        "You are no longer a member of this collaboration.",
                    );
                }
                if (latestCollab.data().status !== "active") {
                    throw new functions.https.HttpsError(
                        "failed-precondition",
                        "Only active collaborations accept versions.",
                    );
                }
                if (!latestUpload.exists ||
                    !canAttachPendingSave(latestUpload.data(), uid)) {
                    throw new functions.https.HttpsError(
                        "permission-denied",
                        "Only the author can attach a save to this pending changelog.",
                    );
                }

                const pendingChangelog = latestUpload.data();
                const fileData = fileSnap.exists ? fileSnap.data() : null;
                const nextVersionNumber = getNextVersionNumber(fileData);
                const previousCurrentVersion = fileData &&
                    fileData.currentVersion;
                const previousVersionId = previousCurrentVersion &&
                    previousCurrentVersion.versionId;
                const pendingBuildEndedAt =
                    pendingChangelog.createdAt || uploadedAt;
                const pendingBuildEndedAtMs =
                    pendingBuildEndedAt &&
                    typeof pendingBuildEndedAt.toMillis === "function" ?
                        pendingBuildEndedAt.toMillis() :
                        null;
                const currentBuildEndedAt = previousCurrentVersion &&
                    (previousCurrentVersion.buildEndedAt ||
                        previousCurrentVersion.uploadedAt);
                const currentBuildEndedAtMs =
                    currentBuildEndedAt &&
                    typeof currentBuildEndedAt.toMillis === "function" ?
                        currentBuildEndedAt.toMillis() :
                        null;
                const promoteToCurrent = shouldPromotePendingVersion(
                    pendingBuildEndedAtMs,
                    currentBuildEndedAtMs,
                );
                const finalizedCompletedTodos = completedTodos.length > 0 ?
                    completedTodos :
                    (pendingChangelog.completedTodos || []);
                const originalFileName = validation.metadata.originalFileName || "save";
                const versionData = {
                    versionNumber: nextVersionNumber,
                    uploadedBy: uid,
                    uploadedByUsername: username,
                    uploadedAt,
                    sizeBytes: head.ContentLength,
                    storageKey: destinationKey,
                    originalFileName,
                    fileKind: validation.metadata.fileKind || null,
                    packageId: validation.metadata.packageId || null,
                    note,
                    imageUrls,
                    completedTodos: finalizedCompletedTodos,
                    changelogEntryId: uploadRef.id,
                    buildEndedAt: pendingBuildEndedAt,
                    isCurrentVersion: promoteToCurrent,
                };
                const currentVersion = {
                    versionId: versionRef.id,
                    number: nextVersionNumber,
                    uploadedBy: uid,
                    uploadedByUsername: username,
                    uploadedAt,
                    sizeBytes: head.ContentLength,
                    originalFileName,
                    note,
                    changelogEntryId: uploadRef.id,
                    buildEndedAt: pendingBuildEndedAt,
                };
                const workDurationMinutes =
                    pendingChangelog.workDurationMinutes || null;

                transaction.set(versionRef, versionData);
                if (promoteToCurrent && previousVersionId) {
                    transaction.update(
                        versionsRef.doc(previousVersionId),
                        { isCurrentVersion: false },
                    );
                }
                const fileUpdate = {
                    name: originalFileName,
                    type: latestCollab.data().game,
                    updatedAt: uploadedAt,
                    latestVersionNumber: nextVersionNumber,
                };
                if (promoteToCurrent) {
                    fileUpdate.currentVersion = {
                        ...currentVersion,
                        storageKey: destinationKey,
                    };
                }
                transaction.set(fileRef, fileUpdate, { merge: true });
                transaction.set(uploadRef, {
                    kind: "version",
                    fileId,
                    versionId: versionRef.id,
                    fileName: originalFileName,
                    userId: uid,
                    username,
                    changelog: note,
                    imageUrls,
                    completedTodos: finalizedCompletedTodos,
                    versionNumber: nextVersionNumber,
                    sizeBytes: head.ContentLength,
                    workDurationMinutes,
                    hasSave: true,
                    status: "complete",
                    updatedAt: uploadedAt,
                }, {merge: true});
                const collaborationUpdate = {
                    updatedAt: uploadedAt,
                };
                if (promoteToCurrent) {
                    collaborationUpdate.currentVersion = currentVersion;
                }
                const latestChangelog =
                    latestCollab.data().latestChangelog;
                if (latestChangelog &&
                    latestChangelog.entryId === uploadRef.id) {
                    collaborationUpdate.latestChangelog = {
                        ...latestChangelog,
                        hasSave: true,
                        versionId: versionRef.id,
                        versionNumber: nextVersionNumber,
                    };
                }
                transaction.update(collabRef, collaborationUpdate);
                transaction.update(sessionRef, {
                    status: "completed",
                    destinationKey,
                    collaborationId,
                    changelogEntryId,
                    versionId: versionRef.id,
                    versionNumber: nextVersionNumber,
                    completedAt: uploadedAt,
                });
                return {
                    versionNumber: nextVersionNumber,
                    memberCount: (latestCollab.data().memberIds || []).length,
                    currentVersionId: promoteToCurrent ?
                        versionRef.id :
                        previousVersionId,
                    promotedToCurrent: promoteToCurrent,
                };
            });
            committed = true;

            await deleteR2ObjectSafely(
                session.objectKey,
                "R2 temp cleanup after finalization failed",
            );

            const keep = getCollaborationRetentionLimit(
                commitResult.memberCount,
            );
            await pruneCollaborationVersions(
                collaborationId,
                versionsRef,
                uid,
                keep,
                commitResult.currentVersionId,
            ).catch((error) =>
                console.warn("Collaboration version retention failed:", error.message));

            return {
                success: true,
                versionId: versionRef.id,
                versionNumber: commitResult.versionNumber,
                promotedToCurrent: commitResult.promotedToCurrent,
            };
        } catch (error) {
            console.error(`Collaboration version finalization failed for ${uploadId}:`, error);
            await deleteR2ObjectSafely(
                session.objectKey,
                "R2 temp cleanup after failed finalization failed",
            );
            if (!committed) {
                await deleteR2ObjectSafely(
                    destinationKey,
                    "R2 destination cleanup after failed finalization failed",
                );
                await db.runTransaction(async (transaction) => {
                    const latest = await transaction.get(sessionRef);
                    if (latest.exists &&
                        latest.data().status === "processing" &&
                        latest.data().processingToken === processingToken) {
                        transaction.set(sessionRef, {
                            status: "rejected",
                            error: error.message,
                            rejectedAt: FieldValue.serverTimestamp(),
                        }, { merge: true });
                    }
                }).catch(() => null);
            }
            if (error instanceof functions.https.HttpsError) throw error;
            throw new functions.https.HttpsError("failed-precondition", error.message);
        }
    });

function normalizeCollaborationImageUrl(value, fieldLabel = "Image", allowEmpty = false) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (allowEmpty && !trimmed) return null;
    if (!trimmed || trimmed.length > 2048) {
        throw new functions.https.HttpsError(
            "invalid-argument",
            `${fieldLabel} must be a valid image URL.`,
        );
    }
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            throw new Error("Unsupported protocol.");
        }
        return parsed.href;
    } catch {
        throw new functions.https.HttpsError(
            "invalid-argument",
            `${fieldLabel} must be a valid http(s) URL.`,
        );
    }
}

function normalizeCollaborationImageUrls(
    values,
    collectionLabel = "A changelog entry",
) {
    if (!Array.isArray(values)) return [];
    if (values.length > 10) {
        throw new functions.https.HttpsError(
            "invalid-argument",
            `${collectionLabel} can contain up to 10 images.`,
        );
    }
    return [...new Set(values.map((value) => (
        normalizeCollaborationImageUrl(value, "Every image")
    )))];
}

function normalizeCollaborationCompletedTodos(values) {
    if (!Array.isArray(values)) return [];
    if (values.length > 50) {
        throw new functions.https.HttpsError(
            "invalid-argument",
            "A changelog can contain up to 50 completed todos.",
        );
    }
    const normalized = values.map((todo) => {
        const id = typeof (todo && todo.id) === "string" ?
            todo.id.trim() :
            "";
        const text = typeof (todo && todo.text) === "string" ?
            todo.text.trim() :
            "";
        try {
            requireSafeId(id, "Todo ID");
        } catch (error) {
            throw new functions.https.HttpsError(
                "invalid-argument",
                error.message,
            );
        }
        if (!text || text.length > 300) {
            throw new functions.https.HttpsError(
                "invalid-argument",
                "Completed todo text must contain 1 to 300 characters.",
            );
        }
        return {id, text};
    });
    return normalized.filter((todo, index, todos) =>
        todos.findIndex((item) => item.id === todo.id) === index);
}

// --- Changelog-Text/Bilder/erledigte Todos dürfen ausschließlich vom
//     ursprünglichen Builder bearbeitet werden. Der Versions-/Save-Link bleibt
//     serververwaltet. ---
exports.updateCollaborationChangelogEntry = onCall(
    async (data, context) => {
        const uid = requireAuthenticated(context);
        const collaborationId =
            ((data && data.collaborationId) || "").trim();
        const changelogEntryId =
            ((data && data.changelogEntryId) || "").trim();
        const text = typeof (data && data.text) === "string" ?
            data.text.trim() :
            "";
        if (!collaborationId || !changelogEntryId ||
            text.length > 1000) {
            throw new functions.https.HttpsError(
                "invalid-argument",
                "Collaboration/changelog IDs and up to 1000 characters are required.",
            );
        }
        try {
            requireSafeId(collaborationId, "Collaboration ID");
            requireSafeId(changelogEntryId, "Changelog ID");
        } catch (error) {
            throw new functions.https.HttpsError(
                "invalid-argument",
                error.message,
            );
        }
        const imageUrls = normalizeCollaborationImageUrls(
            data && data.imageUrls,
        );
        const completedTodos = Array.isArray(data && data.completedTodos) ?
            normalizeCollaborationCompletedTodos(data.completedTodos) :
            null;
        const collabRef = db.doc(`collaborations/${collaborationId}`);
        const memberRef = collabRef.collection("members").doc(uid);
        const uploadRef = collabRef
            .collection("uploads")
            .doc(changelogEntryId);
        const updatedAt = Timestamp.now();
        await db.runTransaction(async (transaction) => {
            const [collabSnap, memberSnap, uploadSnap] =
                await Promise.all([
                    transaction.get(collabRef),
                    transaction.get(memberRef),
                    transaction.get(uploadRef),
                ]);
            if (!collabSnap.exists || !memberSnap.exists) {
                throw new functions.https.HttpsError(
                    "permission-denied",
                    "You are no longer a member of this collaboration.",
                );
            }
            if (!uploadSnap.exists ||
                !isChangelogOwner(uploadSnap.data(), uid)) {
                throw new functions.https.HttpsError(
                    "permission-denied",
                    "Only the original builder can edit this changelog.",
                );
            }
            const changelogUpdate = {
                changelog: text,
                imageUrls,
                updatedAt,
            };
            if (completedTodos) {
                changelogUpdate.completedTodos = completedTodos;
            }
            transaction.update(uploadRef, changelogUpdate);
            transaction.update(collabRef, {updatedAt});
        });
        return {ok: true, changelogEntryId};
    },
);

// --- Signierte Download-URL für eine Collaboration-Version (nur Mitglieder). ---
exports.getCollaborationVersionDownloadUrl = onCallWith(
    { secrets: [r2AccessKeyId, r2SecretAccessKey] },
    async (data, context) => {
        const uid = requireAuthenticated(context);
        const collaborationId = ((data && data.collaborationId) || "").trim();
        const versionId = ((data && data.versionId) || "").trim();
        if (!collaborationId || !versionId) {
            throw new functions.https.HttpsError("invalid-argument", "Collaboration and version IDs are required.");
        }
        try {
            requireSafeId(collaborationId, "Collaboration ID");
            requireSafeId(versionId, "Version ID");
        } catch (error) {
            throw new functions.https.HttpsError("invalid-argument", error.message);
        }
        const memberSnap = await db.doc(`collaborations/${collaborationId}/members/${uid}`).get();
        if (!canDownloadCollaborationVersion({
            memberExists: memberSnap.exists,
        })) {
            throw new functions.https.HttpsError("permission-denied", "You are not a member of this collaboration.");
        }
        const versionSnap = await db.doc(`collaborations/${collaborationId}/files/save/versions/${versionId}`).get();
        if (!versionSnap.exists ||
            !isCollaborationVersionStorageKey(
                versionSnap.data().storageKey,
                collaborationId,
                versionId,
            )) {
            throw new functions.https.HttpsError("not-found", "Version not found.");
        }
        const url = await getSignedUrl(
            getS3(),
            new GetObjectCommand({ Bucket: getR2Bucket(), Key: versionSnap.data().storageKey }),
            { expiresIn: 60 * 5 },
        );
        return {
            downloadUrl: url,
            originalFileName: versionSnap.data().originalFileName || null,
            versionNumber: getVersionNumber(versionSnap.data()) || 1,
        };
    });

// --- Benachrichtigung: Creation ins Showcase aufgenommen bzw. Bewerbung angenommen ---
exports.notifyOnShowcaseStatus = documentWritten(
    'communitys/{communityId}/creations/{creationId}',
    async (change, context) => {
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
exports.notifyOnCommunityRoleChange = documentUpdated(
    'communitys/{communityId}/members/{userId}',
    async (change, context) => {
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
exports.onCommunityDelete = documentDeleted(
    'communitys/{communityId}',
    async (snap, context) => {
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
app.get("/bugReports", authenticate, verifyAppCheckWhenEnabled, async (req, res) => {
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
app.get("/rebuildSearchIndex", authenticate, verifyAppCheckWhenEnabled, async (req, res) => {
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
                updatedAt: FieldValue.serverTimestamp(),
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
 * Kompletter Neuaufbau des Nutzer-Suchindex (userSearchIndex/all) aus der
 * profiles-Collection. Einmalig nach dem Deploy aufrufen (Backfill) oder zur
 * Reparatur. Danach hält onProfileWrite den Index inkrementell aktuell.
 * Example: https://us-central1-YOUR-PROJECT.cloudfunctions.net/api/rebuildUserSearchIndex
 */
app.get("/rebuildUserSearchIndex", authenticate, verifyAppCheckWhenEnabled, async (req, res) => {
    const userId = req.user.uid;
    const userDoc = await db.collection('users').doc(userId).get();

    if (!userDoc.exists || userDoc.data().role !== 'admin') {
        return res.status(403).json({ error: "Only admins can rebuild the user search index." });
    }

    try {
        const snapshot = await db.collection('profiles').get();
        const entries = {};
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            if (!data.username) return; // Profile ohne Username nicht indexieren
            entries[doc.id] = buildUserIndexEntry(data);
        });

        // Bewusst ohne merge: kompletter Rebuild entfernt verwaiste Einträge
        await db.doc('userSearchIndex/all').set({
            entries,
            count: Object.keys(entries).length,
            updatedAt: FieldValue.serverTimestamp(),
        });

        console.log(`User search index rebuilt: ${Object.keys(entries).length} entries`);
        return res.json({ success: true, count: Object.keys(entries).length });
    } catch (error) {
        console.error("User search index rebuild failed:", error);
        return res.status(500).json({ error: "Rebuild failed: " + error.message });
    }
});

/**
 * Rebuilds effective rank permissions for every community member.
 */
app.get("/backfillCommunityMemberPermissions", authenticate, verifyAppCheckWhenEnabled, async (req, res) => {
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'admin') {
        return res.status(403).json({ error: "Only admins can backfill member permissions." });
    }

    try {
        const communitiesSnap = await db.collection('communitys').get();
        let memberCount = 0;
        let updatedCount = 0;

        for (const communityDoc of communitiesSnap.docs) {
            const membersSnap = await communityDoc.ref.collection('members').get();
            memberCount += membersSnap.size;
            const updates = membersSnap.docs.filter(memberDoc => {
                const current = Array.isArray(memberDoc.data().perms) ? memberDoc.data().perms : [];
                const next = getEffectiveCommunityPermissionKeys(communityDoc.data(), memberDoc.data());
                return JSON.stringify(current) !== JSON.stringify(next);
            });
            updatedCount += updates.length;

            for (let offset = 0; offset < updates.length; offset += 400) {
                const batch = db.batch();
                updates.slice(offset, offset + 400).forEach(memberDoc => {
                    batch.set(memberDoc.ref, {
                        perms: getEffectiveCommunityPermissionKeys(
                            communityDoc.data(), memberDoc.data()),
                    }, { merge: true });
                });
                await batch.commit();
            }
        }

        return res.json({
            success: true,
            communities: communitiesSnap.size,
            members: memberCount,
            updated: updatedCount,
        });
    } catch (error) {
        console.error("Community member permission backfill failed:", error);
        return res.status(500).json({ error: "Backfill failed: " + error.message });
    }
});

async function deleteExpiredSecurityDocuments(collectionName) {
    const snapshot = await db.collection(collectionName)
        .where("expiresAt", "<=", Timestamp.now())
        .limit(400)
        .get();
    if (snapshot.empty) return 0;
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    return snapshot.size;
}

async function migrateLegacyDiscordCredentials() {
    const snapshot = await db.collection("users")
        .where("discordRefreshToken", "!=", null)
        .limit(200)
        .get();
    if (snapshot.empty) return 0;
    const batch = db.batch();
    snapshot.docs.forEach((userDoc) => {
        const refreshToken = userDoc.data().discordRefreshToken;
        if (typeof refreshToken === "string" && refreshToken) {
            batch.set(
                db.doc(`privateOAuthCredentials/${userDoc.id}`),
                {
                    migratedAt: Timestamp.now(),
                    provider: DISCORD_OAUTH_PROVIDER,
                    refreshToken,
                    updatedAt: Timestamp.now(),
                },
                {merge: true},
            );
        }
        batch.update(userDoc.ref, {
            discordRefreshToken: FieldValue.delete(),
        });
    });
    await batch.commit();
    return snapshot.size;
}

// Removes expired one-time state/rate-limit records and evacuates provider
// tokens that were stored in client-readable user documents by older releases.
exports.maintainSecurityState = scheduled(
    {
        schedule: "30 3 * * *",
        timeZone: "Europe/Berlin",
    },
    async () => {
        const [oauthStatesDeleted, rateLimitsDeleted, credentialsMigrated] =
            await Promise.all([
                deleteExpiredSecurityDocuments("oauthStates"),
                deleteExpiredSecurityDocuments("securityRateLimits"),
                migrateLegacyDiscordCredentials(),
            ]);
        console.log("Security state maintenance completed.", {
            credentialsMigrated,
            oauthStatesDeleted,
            rateLimitsDeleted,
        });
        return null;
    });

/**
 * Scheduled function to clean up unverified user accounts after 48 hours.
 * Runs daily at 3:00 AM Europe/Berlin time.
 * Deletes users who haven't verified their email within 48 hours of account creation.
 */
exports.cleanupUnverifiedUsers = scheduled(
    {
        schedule: '0 3 * * *',
        timeZone: 'Europe/Berlin',
    },
    async () => {
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
                             db.doc(`profiles/${user.uid}`).delete(),
                             db.doc(`privateOAuthCredentials/${user.uid}`).delete(),
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
