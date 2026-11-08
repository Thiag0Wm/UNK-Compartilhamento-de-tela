const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { once } = require("node:events");
const test = require("node:test");

const turnSecret = "test-only-turn-shared-secret";
const turnTtl = 1800;
process.env.TURN_URL = "turn:turn.example.invalid:3478?transport=udp";
process.env.TURN_SHARED_SECRET = turnSecret;
process.env.TURN_CREDENTIAL_TTL = String(turnTtl);

const { createApplicationServer } = require("./server");

test("issues temporary TURN credentials using the server-only shared secret", async () => {
  const server = createApplicationServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const roomResponse = await fetch(`${baseUrl}/api/rooms`, { method: "POST" });
    const { roomId } = await roomResponse.json();
    const iceResponse = await fetch(`${baseUrl}/api/ice?room=${encodeURIComponent(roomId)}`);
    assert.equal(iceResponse.status, 200);

    const { iceServers } = await iceResponse.json();
    assert.equal(iceServers.length, 2);
    assert.equal(iceServers[0].urls, "stun:stun.l.google.com:19302");

    const turnServer = iceServers[1];
    assert.deepEqual(turnServer.urls, [process.env.TURN_URL]);
    assert.match(turnServer.username, new RegExp(`^\\d+:${roomId}$`));
    const [expiresAt] = turnServer.username.split(":");
    const currentTime = Math.floor(Date.now() / 1000);
    assert.ok(Number(expiresAt) >= currentTime + turnTtl - 1);
    assert.ok(Number(expiresAt) <= currentTime + turnTtl);
    assert.equal(turnServer.credential, crypto
      .createHmac("sha1", turnSecret)
      .update(turnServer.username)
      .digest("base64"));
    assert.equal(JSON.stringify(iceServers).includes(turnSecret), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
