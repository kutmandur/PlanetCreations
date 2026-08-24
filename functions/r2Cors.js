"use strict";

const RIDE_ANALYSIS_BROWSER_ORIGINS = Object.freeze([
  "https://planetcreations.net",
  "https://www.planetcreations.net",
  "http://127.0.0.1:3000",
  "http://localhost:3000",
]);

const rideAnalysisBrowserRule = () => ({
  AllowedHeaders: ["*"],
  AllowedMethods: ["GET", "HEAD"],
  AllowedOrigins: [...RIDE_ANALYSIS_BROWSER_ORIGINS],
  ExposeHeaders: ["ETag", "Content-Length", "Content-Type", "Content-Encoding"],
  MaxAgeSeconds: 3600,
});

function isManagedRideAnalysisRule(rule) {
  if (!rule || typeof rule !== "object") return false;
  const origins = Array.isArray(rule.AllowedOrigins) ? rule.AllowedOrigins : [];
  const methods = Array.isArray(rule.AllowedMethods) ? rule.AllowedMethods : [];
  return RIDE_ANALYSIS_BROWSER_ORIGINS.every((origin) => origins.includes(origin)) &&
    methods.includes("GET") && methods.includes("HEAD");
}

function mergeRideAnalysisBrowserCors(existingRules = []) {
  const retainedRules = Array.isArray(existingRules) ?
    existingRules.filter((rule) => !isManagedRideAnalysisRule(rule)) : [];
  return [rideAnalysisBrowserRule(), ...retainedRules];
}

module.exports = {
  RIDE_ANALYSIS_BROWSER_ORIGINS,
  isManagedRideAnalysisRule,
  mergeRideAnalysisBrowserCors,
  rideAnalysisBrowserRule,
};
