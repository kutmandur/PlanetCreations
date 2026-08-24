"use strict";

const {
  GetBucketCorsCommand,
  GetObjectCommand,
  PutBucketCorsCommand,
  S3Client,
} = require("@aws-sdk/client-s3");
const {getSignedUrl} = require("@aws-sdk/s3-request-presigner");
const {
  RIDE_ANALYSIS_BROWSER_ORIGINS,
  mergeRideAnalysisBrowserCors,
} = require("../r2Cors");

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function readExistingRules(client, bucket) {
  try {
    const response = await client.send(new GetBucketCorsCommand({Bucket: bucket}));
    return response.CORSRules || [];
  } catch (error) {
    if (error?.name === "NoSuchCORSConfiguration" || error?.$metadata?.httpStatusCode === 404) {
      return [];
    }
    throw error;
  }
}

async function verifyBrowserPreflight(client, bucket, objectKey, origin) {
  const downloadUrl = await getSignedUrl(
    client,
    new GetObjectCommand({Bucket: bucket, Key: objectKey}),
    {expiresIn: 300},
  );
  const response = await fetch(downloadUrl, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "GET",
    },
  });
  const allowedOrigin = response.headers.get("access-control-allow-origin");
  if (!response.ok || allowedOrigin !== origin) {
    throw new Error(
      `CORS preflight failed (${response.status}, allow-origin: ${allowedOrigin || "missing"}).`,
    );
  }
  return response.status;
}

async function main() {
  const accountId = requiredEnvironment("R2_ACCOUNT_ID");
  const bucket = requiredEnvironment("R2_BUCKET_NAME");
  const accessKeyId = requiredEnvironment("R2_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnvironment("R2_SECRET_ACCESS_KEY");
  const jurisdiction = process.env.R2_JURISDICTION?.trim();
  const endpointAccount = jurisdiction ? `${accountId}.${jurisdiction}` : accountId;
  const client = new S3Client({
    endpoint: `https://${endpointAccount}.r2.cloudflarestorage.com`,
    region: "auto",
    credentials: {accessKeyId, secretAccessKey},
  });

  const currentRules = await readExistingRules(client, bucket);
  const nextRules = mergeRideAnalysisBrowserCors(currentRules);
  await client.send(new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {CORSRules: nextRules},
  }));

  const storedRules = await readExistingRules(client, bucket);
  const result = {
    bucket,
    configuredOrigins: RIDE_ANALYSIS_BROWSER_ORIGINS,
    storedRuleCount: storedRules.length,
  };
  const objectKey = process.env.R2_VERIFY_OBJECT_KEY?.trim();
  if (objectKey) {
    result.preflightStatus = await verifyBrowserPreflight(
      client,
      bucket,
      objectKey,
      "http://127.0.0.1:3000",
    );
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(`R2 CORS configuration failed: ${error.message}`);
  process.exitCode = 1;
});
