import assert from "node:assert/strict";
import test from "node:test";

import { validateMobileImage, validateMobileImageSelection } from "../../../mobile/use-mobile-image-drafts";
import { normalizedImageFileName } from "../../../mobile/mobile-pure-adapters";

test("mobile image validation accepts supported images within the size limit", () => {
  assert.equal(validateMobileImage({ size: 25 * 1024 * 1024, type: "image/jpeg" }), null);
  assert.equal(validateMobileImage({ size: 12, type: "image/png" }), null);
  assert.equal(validateMobileImage({ size: 12, type: "image/webp" }), null);
});

test("mobile image validation rejects unsupported types and oversized files", () => {
  assert.notEqual(validateMobileImage({ size: 12, type: "image/svg+xml" }), null);
  assert.notEqual(validateMobileImage({ size: 12, type: "image/gif" }), null);
  assert.notEqual(validateMobileImage({ size: 12, type: "image/heic" }), null);
  assert.notEqual(validateMobileImage({ size: 25 * 1024 * 1024 + 1, type: "image/jpeg" }), null);
});

test("mobile image selection accepts four images totaling 100 MiB and rejects a fifth", () => {
  const image = { size: 25 * 1024 * 1024, type: "image/jpeg" };
  assert.equal(validateMobileImageSelection([image, image, image], image), null);
  assert.notEqual(validateMobileImageSelection([image, image, image, image], { size: 1, type: "image/png" }), null);
});

test("mobile upload names normalize the extension to the validated MIME type", () => {
  assert.equal(normalizedImageFileName("camera", "image/jpeg"), "camera.jpg");
  assert.equal(normalizedImageFileName("photo.heic", "image/png"), "photo.png");
  assert.equal(normalizedImageFileName("photo.jpg", "image/webp"), "photo.webp");
  assert.throws(() => normalizedImageFileName("photo.gif", "image/gif"));
});
