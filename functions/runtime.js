"use strict";

const functions = require("firebase-functions/v2");

const REQUEST_RUNTIME_OPTIONS = Object.freeze({
  concurrency: 40,
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
  return functions.https.onCall(
    {
      ...REQUEST_RUNTIME_OPTIONS,
      ...options,
      enforceAppCheck,
    },
    (request) => handler(request.data, request),
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
    (event) => handler(event.data, event),
  );
}

function documentDeleted(document, handler, options = {}) {
  return functions.firestore.onDocumentDeleted(
    {
      ...BACKGROUND_RUNTIME_OPTIONS,
      ...options,
      document,
    },
    (event) => handler(event.data, event),
  );
}

function documentUpdated(document, handler, options = {}) {
  return functions.firestore.onDocumentUpdated(
    {
      ...BACKGROUND_RUNTIME_OPTIONS,
      ...options,
      document,
    },
    (event) => handler(event.data, event),
  );
}

function documentWritten(document, handler, options = {}) {
  return functions.firestore.onDocumentWritten(
    {
      ...BACKGROUND_RUNTIME_OPTIONS,
      ...options,
      document,
    },
    (event) => handler(event.data, event),
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
