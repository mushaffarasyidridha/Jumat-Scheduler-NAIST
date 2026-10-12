// Name locks kept on the server: tokens, their hashes, and labels the admin can tell apart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDeviceToken, hashDeviceToken, deviceLabel } from "../functions/api/_devices.mjs";

test("device token: random, prefixed, and only its hash is meant to be stored", async () => {
  const a = newDeviceToken();
  const b = newDeviceToken();
  assert.match(a, /^dev_[0-9a-f]{48}$/);
  assert.notEqual(a, b);
  const h = await hashDeviceToken(a);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, await hashDeviceToken(a), "the same token always hashes the same");
  assert.notEqual(h, await hashDeviceToken(b));
  assert.ok(!h.includes(a.slice(4)), "the hash does not contain the token");
});

test("device label: system and browser from a user-agent string", () => {
  assert.equal(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"), "iPhone, Safari");
  assert.equal(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36"), "Android, Chrome");
  assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0"), "Windows, Edge");
  assert.equal(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/121.0"), "Mac, Firefox");
  assert.equal(deviceLabel(""), "Unknown device");
  assert.equal(deviceLabel(null), "Unknown device");
});
