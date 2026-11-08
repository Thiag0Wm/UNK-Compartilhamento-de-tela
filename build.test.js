const assert = require("node:assert/strict");
const test = require("node:test");
const { configurePagesCsp, normalizeApiBaseUrl } = require("./build");

test("keeps the backend URL empty for local builds", () => {
  assert.equal(normalizeApiBaseUrl(""), "");
  assert.equal(normalizeApiBaseUrl("  "), "");
});

test("normalizes secure backend URLs to their origin", () => {
  assert.equal(normalizeApiBaseUrl("https://unk-screen-share.onrender.com/"), "https://unk-screen-share.onrender.com");
});

test("allows HTTP only for local development", () => {
  assert.equal(normalizeApiBaseUrl("http://localhost:3000"), "http://localhost:3000");
  assert.equal(normalizeApiBaseUrl("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  assert.equal(normalizeApiBaseUrl("http://[::1]:3000"), "http://[::1]:3000");
  assert.throws(() => normalizeApiBaseUrl("http://api.example.com"), /HTTPS origin/);
});

test("rejects backend URLs with credentials, paths, or query strings", () => {
  assert.throws(() => normalizeApiBaseUrl("https://user:secret@example.com"), /credentials/);
  assert.throws(() => normalizeApiBaseUrl("https://api.example.com/api"), /credentials/);
  assert.throws(() => normalizeApiBaseUrl("https://api.example.com?key=value"), /credentials/);
  assert.throws(() => normalizeApiBaseUrl("not a URL"), /valid HTTPS origin/);
});

test("restricts Pages connect-src to the configured backend and matching socket protocol", () => {
  const headers = "Content-Security-Policy: connect-src 'self' http://localhost:* ws://localhost:*;";
  assert.equal(
    configurePagesCsp(headers, "https://unk-screen-share.onrender.com"),
    "Content-Security-Policy: connect-src 'self' https://unk-screen-share.onrender.com wss://unk-screen-share.onrender.com http://localhost:* ws://localhost:*;",
  );
  assert.equal(
    configurePagesCsp(headers, ""),
    "Content-Security-Policy: connect-src 'self' http://localhost:* ws://localhost:*;",
  );
  assert.throws(() => configurePagesCsp("invalid", ""), /connect-src/);
});
