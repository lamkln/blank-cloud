#!/usr/bin/env node
/**
 * Smoke test: PATCH /settings without customBaseUrl must not 500 (nim provider).
 * Run: node scripts/smoke-settings-patch.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-settings-"));
process.env.BLANK_CLOUD_DATA = dataDir;

const { updateAppSettings, loadAppSettings } = await import(
  `file://${path.join(root, "dist/settings/store.js")}`
);

loadAppSettings();
const next = updateAppSettings({
  provider: "nim",
  model: "z-ai/glm-5.3-flash",
  keys: { nim: "test-key" },
});

if (!next.customBaseUrl.includes("nvidia.com")) {
  console.error("FAIL: nim should default customBaseUrl", next.customBaseUrl);
  process.exit(1);
}

const crashed = updateAppSettings({
  provider: "nim",
  model: "other-model",
  customBaseUrl: undefined,
});

if (crashed.provider !== "nim") {
  console.error("FAIL: provider not nim");
  process.exit(1);
}

console.log("OK smoke-settings-patch");
