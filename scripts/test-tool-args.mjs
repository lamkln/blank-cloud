#!/usr/bin/env node
import assert from "node:assert/strict";
import { normalizeFilesField } from "../dist/tasks/tool-args.js";

// Repro: files as one string element containing a JSON array (NIM / glm-style)
const stringifiedArray =
  '[{"path":"build.gradle","content":"plugins {}"},{"path":"settings.gradle","content":"rootProject.name"}]';

const fromSingleStringElement = normalizeFilesField([stringifiedArray]);
assert.equal(fromSingleStringElement.length, 2);
assert.equal(fromSingleStringElement[0].path, "build.gradle");

const fromRawString = normalizeFilesField(stringifiedArray);
assert.equal(fromRawString.length, 2);

// Broken comma-split fragments (should join + parse, not treat as many files)
const fragments = [
  '[{"content": "{\\n  \\"schemaVersion\\": 1',
  '\\n  \\"id\\": \\"sunny-side\\""',
  ',"path":"fabric.mod.json"}]',
];
let joined;
try {
  joined = normalizeFilesField(fragments);
} catch {
  joined = null;
}
// At minimum must not return dozens of invalid entries
if (joined) {
  assert.ok(joined.length <= 5);
  assert.ok(joined.every((f) => f.path && typeof f.content === "string"));
}

// Exact failure shape: files is array of one stringified JSON array
const nimShape = {
  files: [
    '[{"path":"fabric.mod.json","content":"{\\n  \\"schemaVersion\\": 1\\n}"},{"path":"build.gradle","content":"plugins {}"}]',
  ],
};
const nimParsed = normalizeFilesField(nimShape.files);
assert.equal(nimParsed.length, 2);

console.log("OK test-tool-args");
