#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const errors = [];

function hasEnv(name) {
  return Boolean(process.env[name]?.trim());
}

function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return "";
  }
}

if (process.platform !== "darwin") {
  errors.push("macOS release artifacts must be built on macOS so they can be signed and notarized.");
}

if (!run("xcrun", ["--find", "notarytool"]).trim()) {
  errors.push("Xcode command line tools with notarytool are required. Install Xcode or run `xcode-select --install`.");
}

const identities = run("security", ["find-identity", "-v", "-p", "codesigning"]);
const hasDeveloperIdIdentity = /"Developer ID Application: .+"/.test(identities);
const hasCertificateFile = hasEnv("CSC_LINK");
const hasNamedCertificate = hasEnv("CSC_NAME");

if (!hasCertificateFile && !hasDeveloperIdIdentity) {
  errors.push("A valid Developer ID Application certificate is required. Provide CSC_LINK/CSC_KEY_PASSWORD or install one in the keychain.");
}

if (hasNamedCertificate && !identities.includes(process.env.CSC_NAME)) {
  errors.push(`CSC_NAME is set to "${process.env.CSC_NAME}", but that identity was not found in the keychain.`);
}

const hasApiKeyCredentials = hasEnv("APPLE_API_KEY") && hasEnv("APPLE_API_KEY_ID") && hasEnv("APPLE_API_ISSUER");
const hasKeychainProfileCredentials = hasEnv("APPLE_KEYCHAIN_PROFILE");

if (!hasApiKeyCredentials && !hasKeychainProfileCredentials) {
  errors.push("Notarization credentials are required. Provide APPLE_API_KEY/APPLE_API_KEY_ID/APPLE_API_ISSUER or APPLE_KEYCHAIN_PROFILE.");
}

if (errors.length > 0) {
  console.error("macOS release preflight failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("macOS release preflight passed.");
