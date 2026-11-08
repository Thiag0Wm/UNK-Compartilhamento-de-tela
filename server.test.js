const assert = require("node:assert/strict");
const { once } = require("node:events");
const test = require("node:test");
const { WebSocket } = require("ws");
const { io: createSocketClient } = require("socket.io-client");
const { createApplicationServer } = require("./server");

function waitForMessage(socket, expectedType) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${expectedType}`)), 3000);
    const onMessage = (data) => {
      const message = JSON.parse(data.toString());
      if (message.type !== expectedType) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

function waitForSocketEvent(socket, eventName) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, onEvent);
      reject(new Error(`Timed out waiting for Socket.IO ${eventName}`));
    }, 3000);
    const onEvent = (...args) => {
      clearTimeout(timeout);
      resolve(args);
    };
    socket.once(eventName, onEvent);
  });
}

test("creates rooms, serves the web app, and relays WebRTC signaling", async () => {
  const server = createApplicationServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const sockets = [];
  const socketIoClients = [];

  try {
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });

    const page = await fetch(baseUrl);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);
    const pageHtml = await page.text();
    assert.match(pageHtml, /Criar uma sala/);
    assert.match(pageHtml, /id="room-name"/);
    assert.match(pageHtml, /Pessoas na sala/);
    assert.match(pageHtml, /id="participants-count"[^>]*>0\/5</);
    assert.match(pageHtml, /transmission-status/);
    assert.match(pageHtml, /<title>UNK — Compartilhe sua tela<\/title>/);
    assert.match(pageHtml, /class="brand-logo" src="\/unk-mark\.png"/);

    const brandLogo = await fetch(`${baseUrl}/unk-mark.png`);
    assert.equal(brandLogo.status, 200);
    assert.equal(brandLogo.headers.get("content-type"), "image/png");
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.deepEqual(Buffer.from(await brandLogo.arrayBuffer()).subarray(0, 8), pngSignature);

    const socketClientScript = await fetch(`${baseUrl}/socket.io-client.js`);
    assert.equal(socketClientScript.status, 200);
    assert.match(socketClientScript.headers.get("content-type"), /javascript/);

    const created = await fetch(`${baseUrl}/api/rooms`, { method: "POST" });
    assert.equal(created.status, 201);
    const { roomId, hostToken } = await created.json();
    assert.match(roomId, /^[a-zA-Z0-9_-]{12,32}$/);
    assert.ok(hostToken);

    const ice = await fetch(`${baseUrl}/api/ice?room=${encodeURIComponent(roomId)}`);
    assert.equal(ice.status, 200);
    assert.equal((await ice.json()).iceServers[0].urls, "stun:stun.l.google.com:19302");

    const websocketBase = `ws://127.0.0.1:${address.port}/signal?room=${encodeURIComponent(roomId)}`;
    const host = new WebSocket(`${websocketBase}&role=host&token=${encodeURIComponent(hostToken)}`, {
      origin: baseUrl,
    });
    sockets.push(host);
    const legacyHostJoined = waitForMessage(host, "joined");
    await once(host, "open");
    assert.equal((await legacyHostJoined).role, "host");

    const hostReady = waitForMessage(host, "peer-ready");
    const viewer = new WebSocket(`${websocketBase}&role=viewer`, { origin: baseUrl });
    sockets.push(viewer);
    const viewerReady = waitForMessage(viewer, "peer-ready");
    const legacyViewerJoined = waitForMessage(viewer, "joined");
    await once(viewer, "open");
    assert.equal((await legacyViewerJoined).role, "viewer");
    await Promise.all([hostReady, viewerReady]);

    const forwardedSignal = waitForMessage(viewer, "signal");
    host.send(JSON.stringify({
      type: "signal",
      data: { type: "offer", description: { type: "offer", sdp: "test-sdp" } },
    }));
    assert.deepEqual((await forwardedSignal).data, {
      type: "offer",
      description: { type: "offer", sdp: "test-sdp" },
    });

    const missingRoom = await fetch(`${baseUrl}/api/ice?room=not-a-room`);
    assert.equal(missingRoom.status, 404);

    const socketRoomResponse = await fetch(`${baseUrl}/api/rooms`, { method: "POST" });
    const socketRoom = await socketRoomResponse.json();
    const unauthorizedHost = createSocketClient(baseUrl, {
      auth: { roomId: socketRoom.roomId, role: "host", token: "invalid-token" },
      reconnection: false,
      transports: ["websocket"],
    });
    socketIoClients.push(unauthorizedHost);
    assert.match((await waitForSocketEvent(unauthorizedHost, "connect_error"))[0].message, /Sala invalida/);

    const hostClient = createSocketClient(baseUrl, {
      auth: { roomId: socketRoom.roomId, role: "host", token: socketRoom.hostToken, name: "Ana" },
      transports: ["websocket"],
    });
    socketIoClients.push(hostClient);
    const hostConnected = waitForSocketEvent(hostClient, "connect");
    const hostJoined = waitForSocketEvent(hostClient, "joined");
    await Promise.all([hostConnected, hostJoined]);
    assert.equal((await hostJoined)[0].role, "host");

    const unnamedViewer = createSocketClient(baseUrl, {
      auth: { roomId: socketRoom.roomId, role: "viewer", name: " " },
      reconnection: false,
      transports: ["websocket"],
    });
    socketIoClients.push(unnamedViewer);
    assert.match((await waitForSocketEvent(unnamedViewer, "connect_error"))[0].message, /nome de 1 a 32 caracteres/i);

    const viewerClient = createSocketClient(baseUrl, {
      auth: { roomId: socketRoom.roomId, role: "viewer", name: "Bia" },
      transports: ["websocket"],
    });
    socketIoClients.push(viewerClient);
    const socketHostReady = waitForSocketEvent(hostClient, "peer-ready");
    const socketViewerReady = waitForSocketEvent(viewerClient, "peer-ready");
    const viewerConnected = waitForSocketEvent(viewerClient, "connect");
    const viewerJoined = waitForSocketEvent(viewerClient, "joined");
    const hostParticipants = waitForSocketEvent(hostClient, "participants");
    const viewerParticipants = waitForSocketEvent(viewerClient, "participants");
    await Promise.all([viewerConnected, viewerJoined]);
    await Promise.all([socketHostReady, socketViewerReady]);
    const expectedParticipants = [
      { name: "Ana", role: "host" },
      { name: "Bia", role: "viewer" },
    ];
    assert.deepEqual((await hostParticipants)[0], expectedParticipants);
    assert.deepEqual((await viewerParticipants)[0], expectedParticipants);

    const viewerSharingState = waitForSocketEvent(viewerClient, "sharing-state");
    hostClient.emit("sharing-state", { active: true });
    assert.deepEqual((await viewerSharingState)[0], { active: true, name: "Ana" });

    const socketSignal = waitForSocketEvent(viewerClient, "signal");
    hostClient.emit("signal", {
      type: "offer",
      description: { type: "offer", sdp: "test-sdp" },
    });
    assert.deepEqual((await socketSignal)[0], {
      type: "offer",
      description: { type: "offer", sdp: "test-sdp" },
    });
    const reverseSignal = waitForSocketEvent(hostClient, "signal");
    viewerClient.emit("signal", {
      type: "offer",
      description: { type: "offer", sdp: "reverse-test-sdp" },
    });
    assert.deepEqual((await reverseSignal)[0], {
      type: "offer",
      description: { type: "offer", sdp: "reverse-test-sdp" },
    });

    const hostSharingState = waitForSocketEvent(hostClient, "sharing-state");
    viewerClient.emit("sharing-state", { active: true });
    assert.deepEqual((await hostSharingState)[0], { active: true, name: "Bia" });
  } finally {
    for (const client of socketIoClients) client.disconnect();
    for (const socket of sockets) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("limits rooms to five people and frees a place when someone leaves", async () => {
  const server = createApplicationServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const clients = [];

  function join(room, name, role = "viewer") {
    const client = createSocketClient(baseUrl, {
      auth: {
        roomId: room.roomId,
        role,
        token: role === "host" ? room.hostToken : undefined,
        name,
      },
      reconnection: false,
      transports: ["websocket"],
    });
    clients.push(client);
    return client;
  }

  try {
    const roomResponse = await fetch(`${baseUrl}/api/rooms`, { method: "POST" });
    const room = await roomResponse.json();
    const host = join(room, "Anfitriao", "host");
    const hostConnected = waitForSocketEvent(host, "connect");
    await hostConnected;

    const participants = [host];
    for (const name of ["Pessoa 2", "Pessoa 3", "Pessoa 4", "Pessoa 5"]) {
      const client = join(room, name);
      const connected = waitForSocketEvent(client, "connect");
      const participantList = waitForSocketEvent(client, "participants");
      await Promise.all([connected, participantList]);
      participants.push(client);
      assert.equal((await participantList)[0].length, participants.length);
    }

    const rejected = join(room, "Pessoa 6");
    const [error] = await waitForSocketEvent(rejected, "connect_error");
    assert.equal(error.message, "Sala está cheia.");

    const hostParticipantUpdate = waitForSocketEvent(host, "participants");
    participants[1].disconnect();
    assert.equal((await hostParticipantUpdate)[0].length, 4);

    const replacement = join(room, "Pessoa 6");
    const replacementConnected = waitForSocketEvent(replacement, "connect");
    const replacementParticipants = waitForSocketEvent(replacement, "participants");
    await Promise.all([replacementConnected, replacementParticipants]);
    assert.equal((await replacementParticipants)[0].length, 5);
  } finally {
    for (const client of clients) client.disconnect();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("allows configured Cloudflare Pages origins for API requests and rejects other origins", async () => {
  const pagesOrigin = "https://unk-screen-share.pages.dev";
  const server = createApplicationServer({ allowedOrigins: [pagesOrigin] });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const clients = [];

  try {
    const preflight = await fetch(`${baseUrl}/api/rooms`, {
      method: "OPTIONS",
      headers: {
        Origin: pagesOrigin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), pagesOrigin);

    const createRoom = await fetch(`${baseUrl}/api/rooms`, {
      method: "POST",
      headers: { Origin: pagesOrigin },
    });
    assert.equal(createRoom.status, 201);
    assert.equal(createRoom.headers.get("access-control-allow-origin"), pagesOrigin);
    const createdRoom = await createRoom.json();

    const denied = await fetch(`${baseUrl}/api/rooms`, {
      method: "POST",
      headers: { Origin: "https://untrusted.example" },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("access-control-allow-origin"), null);

    const allowedSocket = createSocketClient(baseUrl, {
      auth: { roomId: createdRoom.roomId, role: "viewer", name: "Pages" },
      extraHeaders: { Origin: pagesOrigin },
      reconnection: false,
      transports: ["websocket"],
    });
    clients.push(allowedSocket);
    await waitForSocketEvent(allowedSocket, "connect");

    const rejectedSocket = createSocketClient(baseUrl, {
      auth: { roomId: createdRoom.roomId, role: "viewer", name: "Blocked" },
      extraHeaders: { Origin: "https://untrusted.example" },
      reconnection: false,
      transports: ["websocket"],
    });
    clients.push(rejectedSocket);
    assert.match((await waitForSocketEvent(rejectedSocket, "connect_error"))[0].message, /websocket error|xhr poll error/i);
  } finally {
    for (const client of clients) client.disconnect();
    await new Promise((resolve) => server.close(resolve));
  }
});
