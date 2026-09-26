"use strict";

const {notificationContext} = require("./notificationContext");
const functions = require("firebase-functions/v2");
const {withAccountOperation, eventAccountUid} = require("./accountLifecycle");

const REQUEST_RUNTIME_OPTIONS = Object.freeze({
  concurrency: 1,
  cpu: "gcf_gen1",
  maxInstances: 10,
  minInstances: 0,
});

const BACKGROUND_RUNTIME_OPTIONS = Object.freeze({
  concurrency: 1,
  cpu: "gcf_gen1",
  maxInstances: 10,
  minInstances: 0,
});

const SCHEDULE_RUNTIME_OPTIONS = Object.freeze({
  ...BACKGROUND_RUNTIME_OPTIONS,
  maxInstances: 1,
});

const enforceAppCheck = process.env.ENFORCE_APP_CHECK === "true";
const serviceAccount = process.env.FUNCTIONS_SERVICE_ACCOUNT ||
  "planetcreationsdotnet@appspot.gserviceaccount.com";

functions.setGlobalOptions({
  region: "us-central1",
  minInstances: 0,
  serviceAccount,
});

function callable(handler) {
  return callableWith({}, handler);
}

function callableWith(options, handler) {
  const {allowDeletingAccount = false, ...runtimeOptions} = options;
  return functions.https.onCall(
    {
      ...REQUEST_RUNTIME_OPTIONS,
      ...runtimeOptions,
      enforceAppCheck,
    },
    (request) => {
      if (allowDeletingAccount) return handler(request.data, request);
      const targets = [...new Set([request.auth?.uid, request.data?.targetUserId,
        request.data?.newOwnerId, request.data?.memberId].filter(uid => typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid)))];
      const invoke = index => index === targets.length ? handler(request.data, request) :
        withAccountOperation(targets[index], () => invoke(index + 1), {timeoutSeconds: options.timeoutSeconds || 540});
      return invoke(0);
    },
  );
}

function httpWith(options, handler) {
  return functions.https.onRequest(
    {
      ...REQUEST_RUNTIME_OPTIONS,
      ...options,
    },
    handler,
  );
}

function documentCreated(document, handler, options = {}) {
  return functions.firestore.onDocumentCreated(
    {
      ...BACKGROUND_RUNTIME_OPTIONS,
      ...options,
      document,
    },
    (event) => notificationContext.run(event.id, () => withAccountOperation(
      eventAccountUid(event, event.data), () => handler(event.data, event),
      {skipDeleted: true, timeoutSeconds: options.timeoutSeconds || 540})),
  );
}

function documentDeleted(document, handler, options = {}) {
  return functions.firestore.onDocumentDeleted(
    {
      ...BACKGROUND_RUNTIME_OPTIONS,
      ...options,
      document,
    },
    (event) => notificationContext.run(event.id, () => handler(event.data, event)),
  );
}

function documentUpdated(document, handler, options = {}) {
  return functions.firestore.onDocumentUpdated(
    {
      ...BACKGROUND_RUNTIME_OPTIONS,
      ...options,
      document,
    },
    (event) => notificationContext.run(event.id, () => withAccountOperation(
      eventAccountUid(event, event.data?.after), () => handler(event.data, event),
      {skipDeleted: true, timeoutSeconds: options.timeoutSeconds || 540})),
  );
}

function documentWritten(document, handler, options = {}) {
  return functions.firestore.onDocumentWritten(
    {
      ...BACKGROUND_RUNTIME_OPTIONS,
      ...options,
      document,
    },
    (event) => notificationContext.run(event.id, () => withAccountOperation(
      eventAccountUid(event, event.data?.after), () => handler(event.data, event),
      {skipDeleted: true, timeoutSeconds: options.timeoutSeconds || 540})),
  );
}

function scheduled(options, handler) {
  return functions.scheduler.onSchedule(
    {
      ...SCHEDULE_RUNTIME_OPTIONS,
      ...options,
    },
    handler,
  );
}

module.exports = {
  callable,
  callableWith,
  documentCreated,
  documentDeleted,
  documentUpdated,
  documentWritten,
  enforceAppCheck,
  functions,
  httpWith,
  scheduled,
};
