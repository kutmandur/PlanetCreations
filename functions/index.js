const functions = require("firebase-functions");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");
const crypto = require("crypto");
const S3 = require("aws-sdk/clients/s3");
const AdmZip = require("adm-zip");

admin.initializeApp();
const db = admin.firestore();

// --- Konfiguration für DigitalOcean Spaces ---
// Lazy-Initialisierung: fehlende Konfiguration darf den Modul-Load nicht crashen,
// sonst sterben ALLE Functions in dieser Datei beim Cold Start.
let s3Instance = null;
function getS3() {
    if (!s3Instance) {
        if (!process.env.DO_ENDPOINT || !process.env.DO_KEY_ID || !process.env.DO_SECRET) {
            throw new Error("DigitalOcean Spaces is not configured.");
        }
        s3Instance = new S3({
            endpoint: process.env.DO_ENDPOINT,
            region: 'nyc3',
            accessKeyId: process.env.DO_KEY_ID,
            secretAccessKey: process.env.DO_SECRET,
            signatureVersion: "v4",
        });
    }
    return s3Instance;
}
const getDoBucket = () => process.env.DO_BUCKET_NAME;
const getDoPublicUrl = () => process.env.DO_PUBLIC_URL;

// Secrets & Config
// Secrets liegen im Secret Manager (firebase functions:secrets:set <NAME>) und
// werden per runWith({ secrets: [...] }) an die jeweiligen Functions gebunden.
// .value() darf erst innerhalb eines Handlers aufgerufen werden.
const discordClientSecret = defineSecret("DISCORD_CLIENT_SECRET");
const backupSigningKey = defineSecret("BACKUP_SIGNING_KEY");
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
    const hash = req.body.hash;
    const userId = req.user.uid;

    if (!hash || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) {
        return res.status(400).json({ error: "A valid SHA-256 hash must be provided." });
    }
    
    const signingKey = backupSigningKey.value();
    if (!signingKey) {
        console.error("Backup signing key is not configured.");
        return res.status(500).json({ error: "Server configuration error: Signing key is missing." });
    }

    try {
        const signer = crypto.createSign("sha256");
        signer.update(hash);
        signer.end();
        const signature = signer.sign(signingKey, "hex");

        const profileRef = db.doc(`profiles/${userId}`);
        const profileSnap = await profileRef.get();
        const username = profileSnap.exists ? profileSnap.data().username : "Unknown User";


        return res.status(200).json({
            signature,
            signerUid: userId,
            signerUsername: username,
        });
    } catch (error) {
        console.error("Error creating signature:", error);
        return res.status(500).json({ error: "An unexpected error occurred while creating the signature." });
    }
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
const MAX_BACKUP_SIZE_BYTES = 300 * 1024 * 1024; // 300 MB
const ALLOWED_GAME_EXTENSIONS = ['.park2', '.zoo', '.blpr2', '.pzblueprint', '.prkauto2', '.zooauto'];

/**
 * Serverseitige Validierung eines Backup-Files aus S3
 * Prüft: Archiv-Integrität, metadata.json, Game-File-Typ, Signatur
 * @param {Buffer} fileBuffer - Das Backup als Buffer
 * @param {string} publicKey - Der öffentliche Schlüssel zur Signaturprüfung
 * @returns {Object} { valid: boolean, error?: string, metadata?: object, verificationStatus: string }
 */
function validateBackupBuffer(fileBuffer, publicKey) {
    try {
        // 1. Prüfe ob es ein gültiges ZIP-Archiv ist
        let zip;
        try {
            zip = new AdmZip(fileBuffer);
        } catch (e) {
            return { valid: false, error: 'Invalid or corrupted backup file.', verificationStatus: 'invalid' };
        }

        // 2. Prüfe ob metadata.json existiert
        const metaEntry = zip.getEntry('metadata.json');
        if (!metaEntry) {
            return { valid: false, error: 'Invalid backup file: metadata.json is missing.', verificationStatus: 'invalid' };
        }

        // 3. Parse metadata.json
        let metadata;
        try {
            metadata = JSON.parse(metaEntry.getData().toString('utf8'));
        } catch (e) {
            return { valid: false, error: 'Invalid backup file: metadata.json is corrupted.', verificationStatus: 'invalid' };
        }

        // 4. Prüfe ob das Original-File ein gültiges Game-File war
        if (!metadata.originalFileName) {
            return { valid: false, error: 'Invalid backup: originalFileName is missing.', verificationStatus: 'invalid' };
        }

        const originalExt = path.extname(metadata.originalFileName).toLowerCase();
        if (!ALLOWED_GAME_EXTENSIONS.includes(originalExt)) {
            return {
                valid: false,
                error: `Invalid backup content. Only game files (${ALLOWED_GAME_EXTENSIONS.join(', ')}) are allowed.`,
                verificationStatus: 'invalid'
            };
        }

        // 5. Prüfe ob das Backup signiert ist
        if (!metadata.isSigned || !metadata.signature) {
            return {
                valid: false,
                error: 'Only signed backups can be uploaded. Please create a signed backup using the desktop client.',
                verificationStatus: 'unsigned',
                metadata
            };
        }

        // 6. Verifiziere die Signatur
        if (!publicKey) {
            console.error('Public key not available for signature verification');
            return { valid: false, error: 'Server configuration error: Cannot verify signature.', verificationStatus: 'error' };
        }

        try {
            const { signature, ...metadataWithoutSignature } = metadata;
            const metadataString = JSON.stringify(metadataWithoutSignature, null, 2);
            const hash = crypto.createHash('sha256').update(metadataString).digest('hex');

            const verifier = crypto.createVerify('RSA-SHA256');
            verifier.update(hash);
            verifier.end();

            const isVerified = verifier.verify(publicKey, signature, 'hex');

            if (!isVerified) {
                return {
                    valid: false,
                    error: 'Backup signature is invalid. The file may have been tampered with.',
                    verificationStatus: 'invalid',
                    metadata
                };
            }

            // Signatur ist gültig
            return {
                valid: true,
                verificationStatus: 'verified',
                metadata: {
                    originalFileName: metadata.originalFileName,
                    backupDate: metadata.backupDate,
                    signerUid: metadata.signerUid,
                    signerUsername: metadata.signerUsername,
                    backupType: metadata.backupType
                }
            };

        } catch (verifyError) {
            console.error('Signature verification error:', verifyError);
            return {
                valid: false,
                error: 'Signature verification failed: ' + verifyError.message,
                verificationStatus: 'invalid'
            };
        }

    } catch (error) {
        console.error('Backup validation error:', error);
        return { valid: false, error: 'Validation failed: ' + error.message, verificationStatus: 'error' };
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

exports.getUploadUrl = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
  }
  const fileName = data.fileName;
  const contentType = data.contentType;
  const fileSize = data.fileSize; // Dateigröße vom Client

  if (!fileName || !contentType) {
    throw new functions.https.HttpsError("invalid-argument", "File name and content type must be provided.");
  }

  // Validierung: Dateiendung prüfen
  const ext = path.extname(fileName).toLowerCase();
  if (ext !== '.planetcreations') {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Invalid file type. Only .PlanetCreations backup files are allowed."
    );
  }

  // Validierung: Dateigröße prüfen (falls vom Client mitgesendet)
  if (fileSize && fileSize > MAX_BACKUP_SIZE_BYTES) {
    const sizeMB = (fileSize / (1024 * 1024)).toFixed(2);
    throw new functions.https.HttpsError(
      "invalid-argument",
      `File too large (${sizeMB} MB). Maximum allowed size is 300 MB.`
    );
  }

  const filePath = `temp-uploads/${context.auth.uid}/${Date.now()}-${fileName}`;

  const params = {
    Bucket: getDoBucket(),
    Key: filePath,
    ContentType: contentType,
    Expires: 60 * 10,
    // Content-Length-Range Header für S3 - begrenzt Upload-Größe serverseitig
    Conditions: [
      ["content-length-range", 0, MAX_BACKUP_SIZE_BYTES]
    ]
  };
  try {
    const uploadUrl = await getS3().getSignedUrlPromise("putObject", params);
    const finalFileUrl = `${getDoPublicUrl()}/${filePath}`;
    return { uploadUrl, finalFileUrl, maxSizeBytes: MAX_BACKUP_SIZE_BYTES };
  } catch (error) {
    console.error("Error creating signed URL for DigitalOcean Spaces", error);
    throw new functions.https.HttpsError("internal", "Could not create upload URL.");
  }
});

exports.deleteTempFile = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
    }
    const tempUrl = data.tempUrl;
    if (!tempUrl || !tempUrl.includes('/temp-uploads/')) {
      throw new functions.https.HttpsError("invalid-argument", "A valid temporary URL must be provided.");
    }
    try {
        const urlParts = new URL(tempUrl);
        const filePath = decodeURIComponent(urlParts.pathname.substring(1));
        await getS3().deleteObject({
            Bucket: getDoBucket(),
            Key: filePath,
        }).promise();
        return { success: true };
    } catch (error) {
        console.error(`Failed to delete temp file: ${tempUrl}`, error);
        throw new functions.https.HttpsError('internal', 'Could not delete temporary file.');
    }
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

        communityIds.forEach(communityId => {
            const memberRef = db.doc(`communitys/${communityId}/members/${userId}`);
            batch.delete(memberRef);
        });

        batch.delete(profileRef);
        batch.delete(db.doc(`users/${userId}`));
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
        console.log(`Deleting ${creationsSnap.size} creations...`);

        communityIds.forEach(communityId => {
            const memberRef = db.doc(`communitys/${communityId}/members/${userIdToDelete}`);
            batch.delete(memberRef);
        });
        console.log(`Deleting from ${communityIds.length} community member lists...`);

        batch.delete(profileRef);
        batch.delete(db.doc(`users/${userIdToDelete}`));
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

exports.onCreationWrite = functions
    .runWith({ memory: '512MB', timeoutSeconds: 120, secrets: [backupSigningKey] }) // Mehr Speicher für ZIP-Verarbeitung
    .firestore
    .document('creations/{creationId}')
    .onWrite(async (change, context) => {
        const dataAfter = change.after.exists ? change.after.data() : null;
        const dataBefore = change.before.exists ? change.before.data() : null;

        const urlAfter = dataAfter ? dataAfter.backupUrl : null;
        const urlBefore = dataBefore ? dataBefore.backupUrl : null;

        if (urlAfter && urlAfter.includes('/temp-uploads/') && urlAfter !== urlBefore) {
            const bucketName = getDoBucket();
            let sourcePath = null;

            try {
                const urlParts = new URL(urlAfter);
                sourcePath = decodeURIComponent(urlParts.pathname.substring(1));
                const fileName = sourcePath.split('/').pop();

                // === SERVERSEITIGE VALIDIERUNG ===

                // 1. Prüfe Dateiendung
                const fileExt = path.extname(fileName).toLowerCase();
                if (fileExt !== '.planetcreations') {
                    console.error(`Invalid file extension for creation ${context.params.creationId}: ${fileExt}`);
                    await getS3().deleteObject({ Bucket: bucketName, Key: sourcePath }).promise();
                    await change.after.ref.update({
                        backupUrl: null,
                        backupIsSigned: false,
                        backupProcessingError: 'Invalid file type. Only .PlanetCreations files are allowed.'
                    });
                    return null;
                }

                // 2. Prüfe Dateigröße
                const headResult = await getS3().headObject({ Bucket: bucketName, Key: sourcePath }).promise();
                const fileSizeBytes = headResult.ContentLength;

                if (fileSizeBytes > MAX_BACKUP_SIZE_BYTES) {
                    const sizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2);
                    console.error(`File too large for creation ${context.params.creationId}: ${sizeMB} MB`);
                    await getS3().deleteObject({ Bucket: bucketName, Key: sourcePath }).promise();
                    await change.after.ref.update({
                        backupUrl: null,
                        backupIsSigned: false,
                        backupProcessingError: `File too large (${sizeMB} MB). Maximum allowed size is 300 MB.`
                    });
                    return null;
                }

                // 3. Lade die Datei herunter und validiere sie vollständig (inkl. Signatur)
                console.log(`Downloading backup for validation: ${sourcePath}`);
                const fileData = await getS3().getObject({ Bucket: bucketName, Key: sourcePath }).promise();
                const fileBuffer = fileData.Body;

                // Hole den öffentlichen Schlüssel aus dem privaten Signing Key
                const publicKey = getPublicKeyFromPrivate(backupSigningKey.value());
                if (!publicKey) {
                    console.error('Could not derive public key from signing key');
                    await getS3().deleteObject({ Bucket: bucketName, Key: sourcePath }).promise();
                    await change.after.ref.update({
                        backupUrl: null,
                        backupIsSigned: false,
                        backupProcessingError: 'Server configuration error: Cannot verify backup signatures.'
                    });
                    return null;
                }

                // Validiere das Backup vollständig (Archiv, Metadata, Game-File-Typ, Signatur)
                const validation = validateBackupBuffer(fileBuffer, publicKey);
                console.log(`Validation result for creation ${context.params.creationId}:`, validation.verificationStatus);

                if (!validation.valid) {
                    console.error(`Backup validation failed for creation ${context.params.creationId}: ${validation.error}`);
                    await getS3().deleteObject({ Bucket: bucketName, Key: sourcePath }).promise();
                    await change.after.ref.update({
                        backupUrl: null,
                        backupIsSigned: false,
                        backupProcessingError: validation.error
                    });
                    return null;
                }

                // === VALIDIERUNG BESTANDEN - Datei verschieben ===
                console.log(`Backup validated successfully for creation ${context.params.creationId}. Moving to permanent storage.`);

                const destinationPath = `creation-backups/${dataAfter.userId}/${fileName}`;

                await getS3().copyObject({
                    Bucket: bucketName,
                    CopySource: `/${bucketName}/${sourcePath}`,
                    Key: destinationPath,
                    ACL: 'public-read'
                }).promise();
                console.log(`Successfully copied ${sourcePath} to ${destinationPath} and made public.`);

                await getS3().deleteObject({
                    Bucket: bucketName,
                    Key: sourcePath,
                }).promise();
                console.log(`Successfully deleted temporary file: ${sourcePath}`);

                const newPublicUrl = `${getDoPublicUrl()}/${destinationPath}`;
                await change.after.ref.update({
                    backupUrl: newPublicUrl,
                    backupFileSize: fileSizeBytes,
                    backupIsSigned: true, // Vom Server verifiziert
                    backupSignerUid: validation.metadata.signerUid || null,
                    backupSignerUsername: validation.metadata.signerUsername || null,
                    backupOriginalFileName: validation.metadata.originalFileName || null,
                    backupProcessingError: null // Fehler zurücksetzen
                });

            } catch (error) {
                console.error(`Failed to process temp file for creation ${context.params.creationId}. URL: ${urlAfter}`, error);
                // Versuche die temporäre Datei zu löschen
                if (sourcePath) {
                    try {
                        await getS3().deleteObject({ Bucket: bucketName, Key: sourcePath }).promise();
                    } catch (deleteError) {
                        console.error(`Failed to cleanup temp file after error: ${sourcePath}`, deleteError);
                    }
                }
                await change.after.ref.update({
                    backupUrl: null,
                    backupIsSigned: false,
                    backupProcessingError: error.message
                });
            }
        }

        if (urlBefore && urlBefore !== urlAfter && !urlBefore.includes('/temp-uploads/')) {
             try {
                const oldUrlParts = new URL(urlBefore);
                const oldFilePath = decodeURIComponent(oldUrlParts.pathname.substring(1));
                await getS3().deleteObject({
                    Bucket: getDoBucket(),
                    Key: oldFilePath,
                }).promise();
                console.log(`Successfully deleted old file: ${oldFilePath} for creation ${context.params.creationId}.`);
            } catch (deleteError) {
                console.error(`Failed to delete old file: ${urlBefore}`, deleteError);
            }
        }

        return null;
    });

exports.onCreationDelete = functions.firestore
    .document('creations/{creationId}')
    .onDelete(async (snap, context) => {
        const deletedData = snap.data();
        const backupUrl = deletedData.backupUrl;

        // Lösche keine temporären Dateien, da diese automatisch ablaufen
        if (!backupUrl || backupUrl.includes('/temp-uploads/')) {
            console.log(`Creation ${context.params.creationId} had no permanent backupUrl. No file to delete.`);
            return null;
        }

        try {
            const urlParts = new URL(backupUrl);
            const filePath = decodeURIComponent(urlParts.pathname.substring(1));
            const params = {
                Bucket: getDoBucket(),
                Key: filePath,
            };
            console.log(`Attempting to delete file: ${filePath} from bucket: ${params.Bucket}`);
            await getS3().deleteObject(params).promise();
            console.log(`Successfully deleted file: ${filePath}`);
            return null;
        } catch (error) {
            console.error(`Failed to delete file for creation ${context.params.creationId}. URL: ${backupUrl}`, error);
            return null;
        }
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
    const newRole = userData.role;
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

// --- Search Index Sync Functions ---
// Kompakter Suchindex in Firestore: ein Dokument pro Spiel unter searchIndex/{game},
// mit einer entries-Map (creationId -> kompakter Eintrag). Der Client lädt das Doc
// mit 1 Read und sucht lokal (Fuse.js) — Ersatz für den gelöschten Algolia-Account.
// Kapazität: ~700-1000 Bytes/Eintrag -> ~1000+ Einträge pro Doc unter dem 1-MiB-Limit.
// Sollte ein Spiel dem Limit nahekommen (count als Frühwarnung beobachten), auf
// Shards umstellen: searchIndex/{game}-0, -1, ... per hash(creationId) % shardCount.

const INDEX_GAMES = ['planet-coaster', 'planet-coaster-2', 'planet-zoo'];

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
});

/**
 * Hält searchIndex/{game} synchron mit der creations-Collection.
 * Bewusst eigener Trigger (nicht in onCreationWrite integriert): leichtgewichtig,
 * ohne S3-Kopplung und ohne das 512MB/120s-Profil der ZIP-Validierung.
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

        // Aus dem alten Index entfernen bei Löschung oder Spiel-Wechsel
        if (gameBefore && INDEX_GAMES.includes(gameBefore) && gameBefore !== gameAfter) {
            await db.doc(`searchIndex/${gameBefore}`)
                .update(entryField, admin.firestore.FieldValue.delete(),
                    'count', admin.firestore.FieldValue.increment(-1))
                .catch(() => null); // Index-Doc existiert evtl. noch nicht
        }

        if (!after) return null;
        if (!INDEX_GAMES.includes(gameAfter)) {
            console.warn(`Creation ${creationId} has unknown game "${gameAfter}", not indexed.`);
            return null;
        }

        // No-Op-Guard: onCreationWrite schreibt Backup-Felder aufs Doc zurück —
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

        const preview = (report.description || '').slice(0, 120);
        const batch = db.batch();
        adminsSnap.docs.forEach(adminDoc => {
            const notifRef = db.collection(`users/${adminDoc.id}/notifications`).doc();
            batch.set(notifRef, {
                title: `New bug report from ${report.username || 'a user'}`,
                message: preview + ((report.description || '').length > 120 ? '…' : ''),
                link: '/admin',
                isRead: false,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });
        });
        return batch.commit();
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
            console.log(`Community index rebuilt for ${communityId}: ${count} entries`);
            return res.json({ success: true, communityCounts: { [communityId]: count } });
        }

        const snapshot = await db.collection('creations').get();

        const perGame = {};
        INDEX_GAMES.forEach(game => { perGame[game] = {}; });
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