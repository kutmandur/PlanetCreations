import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const AdmZip = require("adm-zip");
const {
  FORMAT_NAME,
  FORMAT_VERSION,
  MEDIA_MANIFEST_FORMAT,
  validateCreationArchive,
} = require("../functions/backupFormat");

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const functionsBase =
  "https://us-central1-planetcreationsdotnet.cloudfunctions.net";
const apiBase = `${functionsBase}/api`;

function readEnvFile(filePath) {
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
      .map((line) => {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator);
        let value = line.slice(separator + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        return [key, value];
      }),
  );
}

async function readJsonResponse(response, label) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body?.error?.message ||
      body?.error?.status ||
      body?.error ||
      `${response.status} ${response.statusText}`;
    throw new Error(`${label} failed: ${message}`);
  }
  return body;
}

async function callFunction(name, data, idToken = null) {
  const response = await fetch(`${functionsBase}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  const body = await readJsonResponse(response, name);
  if (body.error) {
    throw new Error(
      `${name} failed: ${body.error.message || body.error.status || "unknown error"}`,
    );
  }
  return body.result;
}

async function createTemporaryAccount(apiKey, emailPrefix) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `${emailPrefix}@example.invalid`,
        password: `Pc!${crypto.randomBytes(24).toString("base64url")}`,
        returnSecureToken: true,
      }),
    },
  );
  const account = await readJsonResponse(response, "temporary account signup");
  if (!account.idToken || !account.localId) {
    throw new Error("Temporary Firebase account did not return an ID token.");
  }
  return account;
}

async function buildSignedPackage(sourceSave, idToken, publicKey, temporaryRoot) {
  const originalFileName = path.basename(sourceSave);
  const extension = path.extname(originalFileName).toLowerCase();
  const gameByExtension = {
    ".park2": "planet-coaster-2",
    ".blpr2": "planet-coaster-2",
    ".prkauto2": "planet-coaster-2",
    ".zoo": "planet-zoo",
    ".pzblueprint": "planet-zoo",
    ".zooauto": "planet-zoo",
  };
  const kindByExtension = {
    ".park2": "park",
    ".zoo": "park",
    ".blpr2": "blueprint",
    ".pzblueprint": "blueprint",
    ".prkauto2": "autosave",
    ".zooauto": "autosave",
  };
  if (!gameByExtension[extension]) {
    throw new Error(`Unsupported production-smoke save extension: ${extension}`);
  }

  const payloadBuffer = fs.readFileSync(sourceSave);
  const mediaSetId = crypto.randomUUID();
  const mediaManifest = {
    format: MEDIA_MANIFEST_FORMAT,
    formatVersion: FORMAT_VERSION,
    mediaSetId,
    assets: [],
  };
  const manifestBuffer = Buffer.from(JSON.stringify(mediaManifest, null, 2));
  const unsignedMetadata = {
    format: FORMAT_NAME,
    formatVersion: FORMAT_VERSION,
    packageType: "creation",
    packageId: crypto.randomUUID(),
    mediaSetId,
    gameId: gameByExtension[extension],
    fileKind: kindByExtension[extension],
    originalFileName,
    payloadPath: `payload/${originalFileName}`,
    payloadSize: payloadBuffer.length,
    payloadSha256: sha256(payloadBuffer),
    mediaManifestSha256: sha256(manifestBuffer),
    note: "Automated production smoke test",
    createdAt: new Date().toISOString(),
    isSigned: false,
  };
  const signResponse = await fetch(`${apiBase}/signBackup`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ metadata: unsignedMetadata }),
  });
  const signBody = await readJsonResponse(signResponse, "signBackup");
  if (!signBody.metadata) {
    throw new Error("signBackup returned no signed metadata.");
  }

  const zip = new AdmZip();
  zip.addFile(unsignedMetadata.payloadPath, payloadBuffer);
  zip.addFile("media_manifest.json", manifestBuffer);
  zip.addFile(
    "metadata.json",
    Buffer.from(JSON.stringify(signBody.metadata, null, 2)),
  );
  const packagePath = path.join(temporaryRoot, "production-smoke.PlanetCreations");
  zip.writeZip(packagePath);
  const packageBuffer = fs.readFileSync(packagePath);
  validateCreationArchive(
    packageBuffer,
    publicKey,
    Object.keys(gameByExtension),
  );
  return { packageBuffer, packagePath };
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function main() {
  const sourceSave = path.resolve(process.argv[2] || "");
  if (!sourceSave || !fs.existsSync(sourceSave) || !fs.statSync(sourceSave).isFile()) {
    throw new Error("Pass an existing copied Frontier save file as the first argument.");
  }

  const environment = readEnvFile(path.join(projectRoot, ".env.local"));
  const apiKey = environment.VITE_FIREBASE_API_KEY;
  if (!apiKey) {
    throw new Error("VITE_FIREBASE_API_KEY is missing from .env.local.");
  }

  const runId = crypto.randomUUID();
  const shortId = runId.slice(0, 8);
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), `planetcreations-production-smoke-${shortId}-`),
  );
  let idToken = null;
  let uploadId = null;
  let collaborationId = null;
  let downloadUrl = null;
  let accountDeleted = false;
  let nonMemberToken = null;
  let nonMemberDeleted = false;

  try {
    const publicKeyResponse = await fetch(`${apiBase}/getPublicKey`);
    const publicKey = await publicKeyResponse.text();
    if (
      !publicKeyResponse.ok ||
      !publicKey.includes("BEGIN PUBLIC KEY")
    ) {
      throw new Error("Production signing public key is unavailable.");
    }
    console.log("OK public signing key");

    const retiredDiscordResponse = await fetch(
      `${apiBase}/discordAuthRedirect`,
      { redirect: "manual" },
    );
    if (retiredDiscordResponse.status !== 410) {
      throw new Error(
        `Retired Discord endpoint returned ${retiredDiscordResponse.status}, expected 410.`,
      );
    }
    console.log("OK retired Discord flow is blocked");

    const signup = await createTemporaryAccount(
      apiKey,
      `production-smoke-${runId}`,
    );
    idToken = signup.idToken;
    console.log("OK temporary Firebase account");

    const discordStart = await callFunction("startDiscordLink", {}, idToken);
    const discordUrl = new URL(discordStart.authUrl);
    if (
      discordUrl.hostname !== "discord.com" ||
      discordUrl.pathname !== "/api/oauth2/authorize" ||
      !discordUrl.searchParams.get("state")
    ) {
      throw new Error("Discord link start returned an invalid authorization URL.");
    }
    console.log("OK Discord link start");

    const { packagePath, packageBuffer } = await buildSignedPackage(
      sourceSave,
      idToken,
      publicKey,
      temporaryRoot,
    );
    console.log(`OK signed package (${packageBuffer.length} bytes)`);

    const upload = await callFunction(
      "getUploadUrl",
      {
        fileName: path.basename(packagePath),
        fileSize: packageBuffer.length,
        ownershipConfirmed: true,
        hostingAccepted: true,
      },
      idToken,
    );
    uploadId = upload.uploadId;
    const uploadResponse = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": upload.contentType },
      body: packageBuffer,
    });
    if (!uploadResponse.ok) {
      throw new Error(
        `R2 upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`,
      );
    }
    console.log("OK signed R2 upload");

    const collaboration = await callFunction(
      "createCollaboration",
      {
        title: `Production smoke ${shortId}`,
        description: "Temporary automated production verification.",
        game: "planet-coaster-2",
        visibility: "public",
        joinMode: "invite",
        initialUploadId: uploadId,
        initialNote: "Temporary production smoke test",
        galleryImageUrls: [],
      },
      idToken,
    );
    collaborationId = collaboration.collaborationId;
    uploadId = null;
    if (!collaborationId || !collaboration.versionId) {
      throw new Error("Collaboration creation returned incomplete identifiers.");
    }
    console.log("OK collaboration creation with required initial save");

    const publicView = await callFunction(
      "getPublicCollaborationView",
      { collaborationId },
      idToken,
    );
    if (
      publicView.collaboration?.id !== collaborationId ||
      publicView.versions?.[0]?.id !== collaboration.versionId
    ) {
      throw new Error("Public collaboration view does not contain the initial version.");
    }
    console.log("OK public collaboration view");

    const nonMember = await createTemporaryAccount(
      apiKey,
      `production-smoke-nonmember-${runId}`,
    );
    nonMemberToken = nonMember.idToken;
    let nonMemberDownloadBlocked = false;
    try {
      await callFunction(
        "getCollaborationVersionDownloadUrl",
        {
          collaborationId,
          versionId: collaboration.versionId,
        },
        nonMemberToken,
      );
    } catch (error) {
      nonMemberDownloadBlocked = /member|permission|denied|download/i.test(
        error.message,
      );
    }
    if (!nonMemberDownloadBlocked) {
      throw new Error("A non-member received a collaboration download URL.");
    }
    const nonMemberDeletion = await callFunction(
      "deleteOwnAccount",
      {},
      nonMemberToken,
    );
    if (!nonMemberDeletion.success) {
      throw new Error("Temporary non-member account deletion was not confirmed.");
    }
    nonMemberDeleted = true;
    nonMemberToken = null;
    console.log("OK non-member collaboration download is blocked");

    const download = await callFunction(
      "getCollaborationVersionDownloadUrl",
      {
        collaborationId,
        versionId: collaboration.versionId,
      },
      idToken,
    );
    downloadUrl = download.downloadUrl;
    const downloadResponse = await fetch(downloadUrl);
    if (!downloadResponse.ok) {
      throw new Error(
        `Signed R2 download failed: ${downloadResponse.status} ${downloadResponse.statusText}`,
      );
    }
    const downloadedBuffer = Buffer.from(await downloadResponse.arrayBuffer());
    if (sha256(downloadedBuffer) !== sha256(packageBuffer)) {
      throw new Error("Downloaded package does not match the uploaded package.");
    }
    const downloadedPath = path.join(temporaryRoot, "downloaded.PlanetCreations");
    fs.writeFileSync(downloadedPath, downloadedBuffer);
    validateCreationArchive(
      downloadedBuffer,
      publicKey,
      [".park2", ".zoo", ".blpr2", ".pzblueprint", ".prkauto2", ".zooauto"],
    );
    console.log("OK member-only signed R2 download and package integrity");

    const deletion = await callFunction(
      "deleteCollaboration",
      { collaborationId },
      idToken,
    );
    collaborationId = null;
    if (!deletion.success || deletion.deletedR2ObjectCount < 1) {
      throw new Error("Collaboration cleanup did not report the R2 object deletion.");
    }
    const deletedObjectResponse = await fetch(downloadUrl);
    if (deletedObjectResponse.status !== 404) {
      throw new Error(
        `Deleted R2 object still returned ${deletedObjectResponse.status}, expected 404.`,
      );
    }
    console.log("OK collaboration and R2 cleanup");

    const accountDeletion = await callFunction("deleteOwnAccount", {}, idToken);
    if (!accountDeletion.success) {
      throw new Error("Temporary account deletion was not confirmed.");
    }
    accountDeleted = true;
    idToken = null;
    console.log("OK temporary account cleanup");
  } finally {
    if (idToken && collaborationId) {
      await callFunction(
        "deleteCollaboration",
        { collaborationId },
        idToken,
      ).catch((error) =>
        console.error(`Cleanup warning (collaboration): ${error.message}`),
      );
    } else if (idToken && uploadId) {
      await callFunction(
        "abortBackupUpload",
        { uploadId },
        idToken,
      ).catch((error) =>
        console.error(`Cleanup warning (upload): ${error.message}`),
      );
    }

    if (idToken && !accountDeleted) {
      const callableCleanup = await callFunction(
        "deleteOwnAccount",
        {},
        idToken,
      )
        .then(() => true)
        .catch(() => false);
      if (!callableCleanup) {
        await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(apiKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken }),
          },
        ).catch(() => null);
      }
    }

    if (nonMemberToken && !nonMemberDeleted) {
      const callableCleanup = await callFunction(
        "deleteOwnAccount",
        {},
        nonMemberToken,
      )
        .then(() => true)
        .catch(() => false);
      if (!callableCleanup) {
        await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(apiKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken: nonMemberToken }),
          },
        ).catch(() => null);
      }
    }

    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }

  console.log("PRODUCTION_SMOKE_OK");
}

main().catch((error) => {
  console.error(`PRODUCTION_SMOKE_FAILED: ${error.message}`);
  process.exitCode = 1;
});
