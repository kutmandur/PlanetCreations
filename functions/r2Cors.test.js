"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  RIDE_ANALYSIS_BROWSER_ORIGINS,
  isManagedRideAnalysisRule,
  mergeRideAnalysisBrowserCors,
} = require("./r2Cors");

test("allows production and local browser origins to download ride analysis", () => {
  const [rule] = mergeRideAnalysisBrowserCors();

  assert.deepEqual(rule.AllowedOrigins, RIDE_ANALYSIS_BROWSER_ORIGINS);
  assert.deepEqual(rule.AllowedMethods, ["GET", "HEAD"]);
  assert.deepEqual(rule.AllowedHeaders, ["*"]);
  assert.ok(rule.ExposeHeaders.includes("Content-Encoding"));
  assert.equal(rule.MaxAgeSeconds, 3600);
});

test("replaces the managed rule while preserving unrelated bucket CORS rules", () => {
  const previousManagedRule = {
    AllowedOrigins: [...RIDE_ANALYSIS_BROWSER_ORIGINS, "https://old.example"],
    AllowedMethods: ["GET", "HEAD"],
  };
  const uploadRule = {
    AllowedOrigins: ["https://uploader.example"],
    AllowedMethods: ["PUT"],
  };

  const result = mergeRideAnalysisBrowserCors([previousManagedRule, uploadRule]);

  assert.equal(result.length, 2);
  assert.ok(isManagedRideAnalysisRule(result[0]));
  assert.equal(result[1], uploadRule);
});
