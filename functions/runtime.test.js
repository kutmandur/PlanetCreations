"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const exportedFunctions = require("./index");

test("exports every function as a second-generation endpoint", () => {
  const endpoints = Object.entries(exportedFunctions);

  assert.equal(endpoints.length, 77);
  for (const [name, fn] of endpoints) {
    assert.equal(
      fn.__endpoint?.platform,
      "gcfv2",
      `${name} must remain a second-generation function`,
    );
  }
});

test("keeps the established execution identity during migration", () => {
  for (const [name, fn] of Object.entries(exportedFunctions)) {
    assert.equal(
      fn.__endpoint.serviceAccountEmail,
      "planetcreationsdotnet@appspot.gserviceaccount.com",
      `${name} must use the audited service account`,
    );
  }
});

test("limits archive processing concurrency and scale", () => {
  const archiveFunctions = [
    "createCollaboration",
    "deleteCollaboration",
    "finalizeBackupUpload",
    "finalizeCollaborationVersion",
  ];

  for (const name of archiveFunctions) {
    const endpoint = exportedFunctions[name].__endpoint;
    assert.equal(endpoint.availableMemoryMb, 1024);
    assert.equal(endpoint.concurrency, 2);
    assert.equal(endpoint.maxInstances, 5);
    assert.equal(endpoint.minInstances, 0);
  }
});

test("keeps background triggers on gen-1 CPU behavior initially", () => {
  const endpoint = exportedFunctions.syncCreationToSearchIndex.__endpoint;

  assert.equal(endpoint.cpu, "gcf_gen1");
  assert.equal(endpoint.concurrency, 1);
  assert.equal(endpoint.maxInstances, 10);
  assert.equal(endpoint.minInstances, 0);
});

test("keeps request functions inside the regional Cloud Run CPU quota", () => {
  const endpoint = exportedFunctions.getBackupDownloadUrl.__endpoint;

  assert.equal(endpoint.concurrency, 40);
  assert.equal(endpoint.maxInstances, 10);
  assert.equal(endpoint.minInstances, 0);
});

test("prevents scheduled maintenance jobs from overlapping", () => {
  for (const name of [
    "cleanupUnverifiedUsers",
    "maintainSecurityState",
    "sweepLiveStreams",
  ]) {
    const endpoint = exportedFunctions[name].__endpoint;
    assert.equal(endpoint.maxInstances, 1);
    assert.equal(endpoint.minInstances, 0);
  }
});
