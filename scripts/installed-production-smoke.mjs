import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

// Windows installed-client production gate. It uses only the ignored copied
// Frontier fixture (or an explicitly passed copy), isolated Electron profiles,
// temporary Firebase accounts and a short-lived App Check debug token.

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const functionsBase = "https://us-central1-planetcreationsdotnet.cloudfunctions.net";
const identityBase = "https://identitytoolkit.googleapis.com/v1";
const installedClient = path.join(
  process.env.LOCALAPPDATA || "",
  "Programs",
  "planet-creation-net",
  "PlanetCreations Client.exe",
);
const isolatedRoot = path.join(projectRoot, ".local-runtimes", "installed-smoke");
const firebaseCli = process.platform === "win32" ? process.execPath : "npx";
const firebaseCliPrefix = process.platform === "win32" ? [path.join(
  path.dirname(process.execPath),
  "node_modules",
  "npm",
  "bin",
  "npx-cli.js",
)] : [];

function readEnvFile(filePath) {
  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
      .map((line) => {
        const separator = line.indexOf("=");
        let value = line.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        return [line.slice(0, separator), value];
      }),
  );
}

async function readJson(response, label) {
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.error) {
    const message = body?.error?.message || body?.error?.status ||
      body?.error || `${response.status} ${response.statusText}`;
    throw new Error(`${label} failed: ${message}`);
  }
  return body;
}

async function callFunction(name, data, idToken, appCheckToken) {
  const response = await fetch(`${functionsBase}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
      "X-Firebase-AppCheck": appCheckToken,
    },
    body: JSON.stringify({ data }),
  });
  const body = await readJson(response, name);
  return body.result;
}

async function signIn(apiKey, email, password, appCheckToken = null) {
  const response = await fetch(
    `${identityBase}/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(appCheckToken ? { "X-Firebase-AppCheck": appCheckToken } : {}),
      },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  return readJson(response, "temporary account sign-in");
}

async function signUp(apiKey, email, password, appCheckToken) {
  const response = await fetch(
    `${identityBase}/accounts:signUp?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Firebase-AppCheck": appCheckToken,
      },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  return readJson(response, "temporary member account signup");
}

async function createTemporaryProfile(apiKey, account, appCheckToken) {
  const documentName = (collection, id) =>
    `projects/planetcreationsdotnet/databases/(default)/documents/${collection}/${id}`;
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/planetcreationsdotnet/` +
    `databases/(default)/documents:commit?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${account.idToken}`,
        "X-Firebase-AppCheck": appCheckToken,
      },
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: documentName("users", account.uid),
              fields: { role: { stringValue: "user" } },
            },
          },
          {
            update: {
              name: documentName("profiles", account.uid),
              fields: {
                username: { stringValue: account.username },
                username_lowercase: { stringValue: account.username.toLowerCase() },
                role: { stringValue: "user" },
                bio: { stringValue: "" },
                needsProfileSetup: { booleanValue: false },
              },
            },
          },
          {
            update: {
              name: documentName("usernames", account.username.toLowerCase()),
              fields: { email: { stringValue: account.email.toLowerCase() } },
            },
          },
        ],
      }),
    },
  );
  await readJson(response, "temporary member profile creation");
}

async function listInstalledSmokeProfiles(apiKey, idToken, appCheckToken) {
  const response = await fetch(
    "https://firestore.googleapis.com/v1/projects/planetcreationsdotnet/" +
    `databases/(default)/documents:runQuery?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
        "X-Firebase-AppCheck": appCheckToken,
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "profiles" }],
          where: {
            compositeFilter: {
              op: "AND",
              filters: [
                {
                  fieldFilter: {
                    field: { fieldPath: "username_lowercase" },
                    op: "GREATER_THAN_OR_EQUAL",
                    value: { stringValue: "pcsmoke" },
                  },
                },
                {
                  fieldFilter: {
                    field: { fieldPath: "username_lowercase" },
                    op: "LESS_THAN",
                    value: { stringValue: "pcsmokf" },
                  },
                },
              ],
            },
          },
          orderBy: [{
            field: { fieldPath: "username_lowercase" },
            direction: "ASCENDING",
          }],
        },
      }),
    },
  );
  const rows = await readJson(response, "temporary smoke profile audit");
  return rows.flatMap((row) => {
    const document = row.document;
    const username = document?.fields?.username_lowercase?.stringValue || "";
    const uid = document?.name?.split("/").at(-1) || "";
    if (!/^pcsmoke(?:owner|member)[0-9a-f]{8}$/i.test(username) ||
        !/^[A-Za-z0-9]{20,128}$/.test(uid)) {
      return [];
    }
    return [{ uid, username: username.toLowerCase() }];
  });
}

async function deleteAuthFallback(apiKey, idToken) {
  if (!idToken) return;
  await fetch(`${identityBase}/accounts:delete?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  }).catch(() => null);
}

function findDebugTokenResource(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.name === "string" &&
      value.name.includes("/debugTokens/")) {
    return value;
  }
  for (const child of Object.values(value)) {
    const found = findDebugTokenResource(child);
    if (found) return found;
  }
  return null;
}

function runFirebaseCli(args, label, expectJson = true) {
  const result = spawnSync(firebaseCli, [
    ...firebaseCliPrefix,
    "--yes",
    "firebase-tools@latest",
    "--project",
    "planetcreationsdotnet",
    "--non-interactive",
    ...(expectJson ? ["--json"] : []),
    ...args,
  ], {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const cause = result.error?.message || `exit code ${result.status}`;
    throw new Error(`${label} failed with Firebase CLI ${cause}.`);
  }
  if (!expectJson) return null;
  try {
    const start = result.stdout.indexOf("{");
    const end = result.stdout.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("missing JSON object");
    return JSON.parse(result.stdout.slice(start, end + 1));
  } catch {
    throw new Error(`${label} returned an unreadable Firebase CLI response.`);
  }
}

function deleteAppCheckDebugTokensByDisplayName(appId, displayName) {
  const response = runFirebaseCli([
    "appcheck:debugtokens:list",
    "--app",
    appId,
  ], "temporary App Check debug token lookup");
  const resources = Array.isArray(response?.result) ? response.result : [];
  for (const resource of resources) {
    if (resource?.displayName !== displayName || typeof resource.name !== "string") continue;
    deleteAppCheckDebugToken(appId, resource.name.split("/").at(-1));
  }
}

function createAppCheckDebugToken(appId, displayName) {
  const secret = crypto.randomUUID();
  try {
    const response = runFirebaseCli([
      "appcheck:debugtokens:create",
      secret,
      "--app",
      appId,
      "--display-name",
      displayName,
    ], "temporary App Check debug token creation");
    const resource = findDebugTokenResource(response);
    if (!resource) {
      throw new Error("Firebase CLI did not return the temporary App Check debug token ID.");
    }
    return {
      id: resource.name.split("/").at(-1),
      secret,
    };
  } catch (error) {
    try {
      deleteAppCheckDebugTokensByDisplayName(appId, displayName);
    } catch {
      // The original failure remains more useful; a follow-up list can audit cleanup.
    }
    throw error;
  }
}

function deleteAppCheckDebugToken(appId, tokenId) {
  if (!tokenId) return;
  runFirebaseCli([
    "appcheck:debugtokens:delete",
    tokenId,
    "--app",
    appId,
    "--force",
  ], "temporary App Check debug token deletion", false);
}

function deleteStaleSmokeProfileArtifacts(profiles) {
  for (const profile of profiles) {
    if (!/^pcsmoke(?:owner|member)[0-9a-f]{8}$/.test(profile.username) ||
        !/^[A-Za-z0-9]{20,128}$/.test(profile.uid)) {
      throw new Error("Refusing to delete an unexpected smoke profile path.");
    }
    for (const documentPath of [
      `profiles/${profile.uid}`,
      `users/${profile.uid}`,
      `usernames/${profile.username}`,
    ]) {
      runFirebaseCli([
        "firestore:delete",
        documentPath,
        "--recursive",
        "--force",
      ], `stale smoke artifact cleanup for ${documentPath}`, false);
    }
  }
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(check, label, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ""}`);
}

async function getRendererTarget(port) {
  return waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null);
    if (!response?.ok) return null;
    const targets = await response.json();
    return targets.find((target) => target.type === "page" &&
      !String(target.url).startsWith("devtools://")) || null;
  }, `installed client renderer on port ${port}`);
}

function connectCdp(webSocketDebuggerUrl, onEvent) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    let nextId = 1;
    const pending = new Map();
    socket.on("open", () => resolve({
      call(method, params = {}) {
        const id = nextId++;
        const response = new Promise((resolveCall, rejectCall) => {
          pending.set(id, { resolve: resolveCall, reject: rejectCall });
        });
        socket.send(JSON.stringify({ id, method, params }));
        return response;
      },
      close() {
        socket.close();
      },
    }));
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      if (message.id && pending.has(message.id)) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
      } else if (message.method) {
        onEvent?.(message);
      }
    });
    socket.on("error", reject);
    socket.on("close", () => {
      for (const request of pending.values()) {
        request.reject(new Error("Installed client renderer connection closed."));
      }
      pending.clear();
    });
  });
}

async function evaluate(client, expression) {
  const result = await client.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ||
      "Installed client renderer evaluation failed.");
  }
  return result.result?.value;
}

function extractAppCheckToken(message, state) {
  const headers = message.params?.request?.headers || message.params?.headers;
  if (!headers || state.appCheckToken) return;
  const entry = Object.entries(headers).find(([name]) =>
    name.toLowerCase() === "x-firebase-appcheck");
  if (entry?.[1]) state.appCheckToken = String(entry[1]);
}

function launchClient(runRoot, label, port, frontierRoot) {
  const profile = path.join(runRoot, `profile-${label}`);
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(
    path.join(profile, "config.json"),
    JSON.stringify({ frontierPath: frontierRoot }, null, 2),
  );
  const child = spawn(installedClient, [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
  ], {
    detached: false,
    stdio: "ignore",
    windowsHide: true,
  });
  return { child, label, port, profile, client: null, network: {} };
}

async function prepareClient(instance, debugToken) {
  const target = await getRendererTarget(instance.port);
  instance.client = await connectCdp(target.webSocketDebuggerUrl, (message) =>
    extractAppCheckToken(message, instance.network));
  await instance.client.call("Runtime.enable");
  await instance.client.call("Network.enable");
  await instance.client.call("Page.enable");
  await instance.client.call("Page.addScriptToEvaluateOnNewDocument", {
    source: `self.FIREBASE_APPCHECK_DEBUG_TOKEN = ${JSON.stringify(debugToken)};`,
  });
  await waitFor(async () => evaluate(instance.client,
    "Boolean(window.electronAPI?.isElectron)"),
  `Electron bridge for client ${instance.label}`);
  await evaluate(instance.client,
    "window.electronAPI.selectMode('online'); true");
  await waitFor(async () => evaluate(instance.client,
    "window.location.href.startsWith('https://planetcreations.net') || " +
    "window.location.href.startsWith('https://www.planetcreations.net')"),
  `hosted production UI for client ${instance.label}`);
}

async function clickButton(client, text) {
  const clicked = await evaluate(client, `(() => {
    const matches = [...document.querySelectorAll('button')]
      .filter((button) => button.textContent.trim() === ${JSON.stringify(text)});
    if (matches.length !== 1) return { count: matches.length };
    matches[0].click();
    return { count: 1 };
  })()`);
  if (clicked?.count !== 1) {
    throw new Error(`Expected one ${JSON.stringify(text)} button, found ${clicked?.count || 0}.`);
  }
}

async function registerTemporaryUser(instance, account) {
  console.log(`INFO client ${instance.label}: opening registration`);
  await evaluate(instance.client, "window.location.hash = '/login'; true");
  await waitFor(async () => evaluate(instance.client,
    "Boolean(document.getElementById('emailOrUsername'))"),
  `login form for client ${instance.label}`);
  await clickButton(instance.client, "Don't have an account? Register");
  await waitFor(async () => evaluate(instance.client,
    "Boolean(document.getElementById('username') && document.getElementById('confirmPassword'))"),
  `registration form for client ${instance.label}`);

  const values = {
    username: account.username,
    emailOrUsername: account.email,
    password: account.password,
    confirmPassword: account.password,
  };
  await evaluate(instance.client, `(() => {
    const values = ${JSON.stringify(values)};
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const [id, value] of Object.entries(values)) {
      const input = document.getElementById(id);
      if (!input) throw new Error('Missing registration input: ' + id);
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  })()`);
  await clickButton(instance.client, "Register");
  try {
    await waitFor(async () => evaluate(instance.client,
      "document.body.innerText.includes('Registration successful!')"),
    `successful registration for client ${instance.label}`, 60_000);
  } catch (error) {
    const visibleState = await evaluate(instance.client,
      "document.body.innerText.slice(-1000)").catch(() => "unavailable");
    throw new Error(`${error.message}; visible state: ${visibleState}`);
  }
  console.log(`INFO client ${instance.label}: registration completed`);
  await waitFor(() => instance.network.appCheckToken,
    `App Check token from installed client ${instance.label}`, 60_000);
  await waitFor(async () => evaluate(instance.client,
    "window.location.hash !== '#/login'"),
  `registration data commit for client ${instance.label}`, 60_000);

  await clickButton(instance.client, "OK");
  const hasProfileWizard = await evaluate(instance.client,
    "[...document.querySelectorAll('button')].some((button) => " +
    "button.textContent.trim() === 'Skip wizard')");
  if (hasProfileWizard) {
    await clickButton(instance.client, "Skip wizard");
    await waitFor(async () => evaluate(instance.client,
      "[...document.querySelectorAll('button')].some((button) => " +
      "button.textContent.trim() === 'Skip anyway')"),
    `profile skip confirmation for client ${instance.label}`);
    await clickButton(instance.client, "Skip anyway");
    await waitFor(async () => evaluate(instance.client,
      "![...document.querySelectorAll('button')].some((button) => " +
      "button.textContent.trim() === 'Skip wizard')"),
    `closed profile wizard for client ${instance.label}`);
    console.log(`INFO client ${instance.label}: profile wizard closed`);
  } else {
    console.log(`INFO client ${instance.label}: no profile wizard on first-load session`);
  }
}

function stopClient(instance) {
  instance.client?.close();
  if (!instance.child?.pid) return;
  spawnSync("taskkill.exe", ["/PID", String(instance.child.pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

async function main() {
  const fixtureRoot = path.resolve(
    projectRoot,
    ".local-runtimes",
    "collaboration-save-fixtures",
  );
  const sourceSave = path.resolve(process.argv[2] || path.join(
    fixtureRoot,
    "2026-07-28",
    "SandboxPark-8F60141E.park2",
  ));
  if (!fs.existsSync(installedClient)) {
    throw new Error(`Installed PlanetCreations client not found at ${installedClient}`);
  }
  if (!fs.existsSync(sourceSave) || !fs.statSync(sourceSave).isFile()) {
    throw new Error("Pass an existing copied Frontier save file.");
  }
  if (!sourceSave.startsWith(`${fixtureRoot}${path.sep}`)) {
    throw new Error("The smoke test accepts only copied saves from the ignored fixture directory.");
  }
  const env = readEnvFile(path.join(projectRoot, ".env.local"));
  const apiKey = env.VITE_FIREBASE_API_KEY;
  const firebaseAppId = env.VITE_FIREBASE_APP_ID;
  if (!apiKey) throw new Error("VITE_FIREBASE_API_KEY is missing from .env.local.");
  if (!firebaseAppId) throw new Error("VITE_FIREBASE_APP_ID is missing from .env.local.");

  fs.mkdirSync(isolatedRoot, { recursive: true });
  const runId = crypto.randomUUID();
  const shortId = runId.slice(0, 8);
  const runRoot = path.join(isolatedRoot, runId);
  const frontierRoot = fixtureRoot;
  fs.mkdirSync(runRoot, { recursive: true });

  const password = `Pc!${crypto.randomBytes(24).toString("base64url")}`;
  const accounts = ["owner", "member"].map((kind) => ({
    kind,
    username: `pcsmoke${kind}${shortId}`.slice(0, 30),
    email: `pcsmoke-${kind}-${runId}@example.invalid`,
    password,
    idToken: null,
    uid: null,
  }));
  const clients = [
    launchClient(runRoot, "owner", 9341, frontierRoot),
    launchClient(runRoot, "member", 9342, frontierRoot),
  ];
  let appCheckToken = null;
  let uploadId = null;
  let collaborationId = null;
  let preparedPath = null;
  let debugRegistration = null;
  let staleSmokeProfiles = [];

  try {
    console.log("INFO registering a temporary App Check debug token");
    debugRegistration = createAppCheckDebugToken(
      firebaseAppId,
      `installed-production-smoke-${shortId}`,
    );
    console.log("OK temporary App Check debug token registered");
    console.log("INFO launching two isolated installed clients");
    await Promise.all(clients.map((client) =>
      prepareClient(client, debugRegistration.secret)));
    console.log("INFO both clients loaded the production UI");
    const identities = await Promise.all(clients.map((client) =>
      evaluate(client.client, "window.electronAPI.getClientIdentity()")));
    if (!identities.every((identity) => identity?.clientId) ||
        new Set(identities.map((identity) => identity.clientId)).size !== clients.length) {
      throw new Error("Installed clients did not expose distinct device identities.");
    }
    await registerTemporaryUser(clients[0], accounts[0]);
    appCheckToken = clients[0].network.appCheckToken;
    const ownerSession = await signIn(
      apiKey,
      accounts[0].email,
      accounts[0].password,
      appCheckToken,
    );
    accounts[0].idToken = ownerSession.idToken;
    accounts[0].uid = ownerSession.localId;
    const memberSession = await signUp(
      apiKey,
      accounts[1].email,
      accounts[1].password,
      appCheckToken,
    );
    accounts[1].idToken = memberSession.idToken;
    accounts[1].uid = memberSession.localId;
    await createTemporaryProfile(apiKey, accounts[1], appCheckToken);
    const currentAccountIds = new Set(accounts.map((account) => account.uid));
    staleSmokeProfiles = (await listInstalledSmokeProfiles(
      apiKey,
      accounts[0].idToken,
      appCheckToken,
    )).filter((profile) => !currentAccountIds.has(profile.uid));
    if (staleSmokeProfiles.length) {
      console.log(`INFO found ${staleSmokeProfiles.length} stale smoke profile artifact set(s)`);
    }
    console.log("OK two isolated installed 1.0.27 device identities, two accounts and valid client App Check");

    const prepared = await evaluate(clients[0].client, `(async () =>
      window.electronAPI.prepareBackupForUpload(
        ${JSON.stringify(sourceSave)},
        ${JSON.stringify(accounts[0].idToken)},
        ${JSON.stringify(appCheckToken)}
      ))()`);
    if (!prepared?.success || !prepared.filePath || !prepared.fileSize) {
      throw new Error(`Installed client could not prepare the signed save: ${prepared?.message || "unknown error"}`);
    }
    preparedPath = prepared.filePath;
    const packageBuffer = fs.readFileSync(preparedPath);
    const packageHash = crypto.createHash("sha256").update(packageBuffer).digest("hex");
    console.log(`OK installed client signed copied save (${packageBuffer.length} bytes)`);

    const upload = await callFunction("getUploadUrl", {
      fileName: prepared.fileName,
      fileSize: prepared.fileSize,
      ownershipConfirmed: true,
      hostingAccepted: true,
    }, accounts[0].idToken, appCheckToken);
    uploadId = upload.uploadId;
    const put = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": upload.contentType },
      body: packageBuffer,
    });
    if (!put.ok) throw new Error(`R2 upload failed: ${put.status} ${put.statusText}`);

    const title = `Installed smoke ${shortId}`;
    const collaboration = await callFunction("createCollaboration", {
      title,
      description: "Temporary installed-client invitation and membership verification.",
      game: "planet-coaster-2",
      visibility: "unlisted",
      joinMode: "invite",
      initialUploadId: uploadId,
      initialNote: "Temporary installed-client production smoke test",
      galleryImageUrls: [],
    }, accounts[0].idToken, appCheckToken);
    collaborationId = collaboration.collaborationId;
    uploadId = null;
    if (!collaborationId || !collaboration.versionId) {
      throw new Error("Collaboration creation returned incomplete identifiers.");
    }
    console.log("OK required initial signed save uploaded through production R2");

    await callFunction("sendCollaborationInvitation", {
      collaborationId,
      targetUserId: accounts[1].uid,
      role: "editor",
    }, accounts[0].idToken, appCheckToken);
    const ownerPending = await callFunction("listCollaborationInvitations", {
      collaborationId,
    }, accounts[0].idToken, appCheckToken);
    const memberPending = await callFunction("listMyCollaborationInvitations", {},
      accounts[1].idToken, appCheckToken);
    if (ownerPending.invitations?.length !== 1 || memberPending.invitations?.length !== 1) {
      throw new Error("Pending invitation was not visible to both authorized views.");
    }
    await callFunction("cancelCollaborationInvitation", {
      collaborationId,
      targetUserId: accounts[1].uid,
    }, accounts[0].idToken, appCheckToken);

    await callFunction("sendCollaborationInvitation", {
      collaborationId,
      targetUserId: accounts[1].uid,
      role: "viewer",
    }, accounts[0].idToken, appCheckToken);
    await callFunction("respondToCollaborationInvitation", {
      collaborationId,
      accept: false,
    }, accounts[1].idToken, appCheckToken);

    await callFunction("sendCollaborationInvitation", {
      collaborationId,
      targetUserId: accounts[1].uid,
      role: "editor",
    }, accounts[0].idToken, appCheckToken);
    await callFunction("respondToCollaborationInvitation", {
      collaborationId,
      accept: true,
    }, accounts[1].idToken, appCheckToken);
    const afterUiAccept = await callFunction("listMyCollaborationInvitations", {},
      accounts[1].idToken, appCheckToken);
    if (afterUiAccept.invitations?.length) {
      throw new Error("Installed-client acceptance left a pending invitation behind.");
    }
    console.log("OK invitation listing, cancel, decline and acceptance");

    await callFunction("updateCollaborationMemberRole", {
      collaborationId,
      targetUserId: accounts[1].uid,
      role: "viewer",
    }, accounts[0].idToken, appCheckToken);
    await callFunction("updateCollaborationMemberRole", {
      collaborationId,
      targetUserId: accounts[1].uid,
      role: "editor",
    }, accounts[0].idToken, appCheckToken);

    const memberDownload = await callFunction("getCollaborationVersionDownloadUrl", {
      collaborationId,
      versionId: collaboration.versionId,
    }, accounts[1].idToken, appCheckToken);
    const downloadResponse = await fetch(memberDownload.downloadUrl);
    if (!downloadResponse.ok) {
      throw new Error(`Member download failed: ${downloadResponse.status}`);
    }
    const downloaded = Buffer.from(await downloadResponse.arrayBuffer());
    if (crypto.createHash("sha256").update(downloaded).digest("hex") !== packageHash) {
      throw new Error("Member download did not match the installed-client package.");
    }

    await callFunction("removeCollaborationMember", {
      collaborationId,
      targetUserId: accounts[1].uid,
    }, accounts[0].idToken, appCheckToken);
    let removedDownloadBlocked = false;
    try {
      await callFunction("getCollaborationVersionDownloadUrl", {
        collaborationId,
        versionId: collaboration.versionId,
      }, accounts[1].idToken, appCheckToken);
    } catch (error) {
      removedDownloadBlocked = /member|permission|denied|download/i.test(error.message);
    }
    if (!removedDownloadBlocked) {
      throw new Error("Removed member still received a collaboration download URL.");
    }

    await callFunction("sendCollaborationInvitation", {
      collaborationId,
      targetUserId: accounts[1].uid,
      role: "viewer",
    }, accounts[0].idToken, appCheckToken);
    await callFunction("respondToCollaborationInvitation", {
      collaborationId,
      accept: true,
    }, accounts[1].idToken, appCheckToken);
    await callFunction("leaveCollaboration", { collaborationId },
      accounts[1].idToken, appCheckToken);
    const regenerated = await callFunction("regenerateCollaborationInviteCode", {
      collaborationId,
    }, accounts[0].idToken, appCheckToken);
    if (!regenerated.inviteCode || regenerated.inviteCode === collaboration.inviteCode) {
      throw new Error("Invite code regeneration returned no replacement code.");
    }
    console.log("OK role changes, member download, removal, leave and code regeneration");

    const deletion = await callFunction("deleteCollaboration", { collaborationId },
      accounts[0].idToken, appCheckToken);
    collaborationId = null;
    if (!deletion.success || deletion.deletedR2ObjectCount < 1) {
      throw new Error("Collaboration cleanup did not confirm R2 deletion.");
    }
    const deletedObject = await fetch(memberDownload.downloadUrl);
    if (deletedObject.status !== 404) {
      throw new Error(`Deleted R2 object returned ${deletedObject.status}, expected 404.`);
    }
    console.log("OK collaboration metadata and R2 cleanup");

    for (const account of accounts) {
      const result = await callFunction("deleteOwnAccount", {}, account.idToken, appCheckToken);
      if (!result.success) throw new Error(`Temporary ${account.kind} account cleanup failed.`);
      account.idToken = null;
    }
    console.log("OK temporary account cleanup");
    console.log("INSTALLED_PRODUCTION_SMOKE_OK");
  } finally {
    appCheckToken = appCheckToken ||
      clients[0].network.appCheckToken || clients[1].network.appCheckToken;
    if (collaborationId && accounts[0].idToken && appCheckToken) {
      await callFunction("deleteCollaboration", { collaborationId },
        accounts[0].idToken, appCheckToken).catch((error) =>
        console.error(`Cleanup warning (collaboration): ${error.message}`));
    } else if (uploadId && accounts[0].idToken && appCheckToken) {
      await callFunction("abortBackupUpload", { uploadId },
        accounts[0].idToken, appCheckToken).catch((error) =>
        console.error(`Cleanup warning (upload): ${error.message}`));
    }
    for (const account of accounts) {
      try {
        if (!account.idToken) {
          const session = await signIn(
            apiKey,
            account.email,
            account.password,
            appCheckToken,
          )
            .catch(() => null);
          if (session) {
            account.idToken = session.idToken;
            account.uid = session.localId;
          }
        }
        if (!account.idToken) continue;
        const deleted = appCheckToken ? await callFunction("deleteOwnAccount", {},
          account.idToken, appCheckToken).then(() => true).catch(() => false) : false;
        if (!deleted) await deleteAuthFallback(apiKey, account.idToken);
        account.idToken = null;
      } catch (error) {
        console.error(`Cleanup warning (${account.kind} account): ${error.message}`);
      }
    }
    for (const client of clients) stopClient(client);
    if (preparedPath && fs.existsSync(preparedPath)) {
      fs.rmSync(preparedPath, { force: true });
    }
    const resolvedRunRoot = path.resolve(runRoot);
    if (resolvedRunRoot.startsWith(`${path.resolve(isolatedRoot)}${path.sep}`)) {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        try {
          fs.rmSync(resolvedRunRoot, { recursive: true, force: true });
          break;
        } catch (error) {
          if (attempt === 11) {
            console.error(`Cleanup warning (client profiles): ${error.message}`);
            break;
          }
          await delay(500);
        }
      }
    }
    if (staleSmokeProfiles.length) {
      try {
        deleteStaleSmokeProfileArtifacts(staleSmokeProfiles);
        console.log(`OK removed ${staleSmokeProfiles.length} stale smoke profile artifact set(s)`);
        staleSmokeProfiles = [];
      } catch (error) {
        console.error(`Cleanup warning (stale smoke profiles): ${error.message}`);
      }
    }
    if (debugRegistration?.id) {
      try {
        deleteAppCheckDebugToken(firebaseAppId, debugRegistration.id);
        debugRegistration = null;
        console.log("OK temporary App Check debug token revoked");
      } catch (error) {
        console.error(`Cleanup warning (App Check debug token): ${error.message}`);
      }
    }
  }
}

main().catch((error) => {
  console.error(`INSTALLED_PRODUCTION_SMOKE_FAILED: ${error.message}`);
  process.exitCode = 1;
});
