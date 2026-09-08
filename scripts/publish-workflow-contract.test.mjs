import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// This repo publishes through the org-shared reusable pipeline
// (ForgeaX-Games/forgeax-ci npm-publish.yml). The pipeline's internal
// structure — build/scan/publish separation, no credentials in the publish
// runner, scan-before-publish, pinned npm, no-provenance publish — is contract-
// tested in forgeax-ci itself. Here we only assert that this repo delegates to
// that shared pipeline instead of hand-rolling its own.

const workflow = readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");

test("delegates publishing to the shared reusable workflow, pinned to a tag", () => {
  assert.match(
    workflow,
    /uses:\s+ForgeaX-Games\/forgeax-ci\/\.github\/workflows\/npm-publish\.yml@v\d+/u,
    "publish.yml must call the shared forgeax-ci npm-publish workflow pinned to a version tag",
  );
  assert.match(workflow, /secrets:\n\s+NPM_TOKEN:\s+\$\{\{ secrets\.NPM_TOKEN \}\}/u);
});

test("uses the canonical release triggers", () => {
  assert.match(workflow, /on:\n  push:\n    tags: \['v\*'\]\n/u);
});

test("does not re-inline a publish pipeline in this repo", () => {
  // The security-sensitive steps must come from the shared workflow, not be
  // copied back here where they would drift.
  assert.doesNotMatch(workflow, /npm publish/u);
  assert.doesNotMatch(workflow, /verify-release-artifact/u);
  assert.doesNotMatch(workflow, /--provenance/u);
});
