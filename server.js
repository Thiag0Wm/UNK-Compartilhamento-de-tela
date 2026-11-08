const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { WebSocket, WebSocketServer } = require("ws");
const { Server: SocketIOServer } = require("socket.io");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ROOMS = 1000;
const ROOM_ID_PATTERN = /^[a-zA-Z0-9_-]{12,32}$/;
const TURN_URLS = (process.env.TURN_URL || "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

if (TURN_URLS.some((url) => !/^turns?:/i.test(url))) {
  throw new Error("Every TURN_URL entry must start with turn: or turns:.");
}

if (Boolean(process.env.TURN_SHARED_SECRET) !== Boolean(TURN_URLS.length)) {
  throw new Error("Configure TURN_URL and TURN_SHARED_SECRET together.");
}

if (process.env.TURN_SHARED_SECRET && !process.env.TURN_SHARED_SECRET.trim()) {
  throw new Error("TURN_SHARED_SECRET cannot be empty.");
}

const TURN_CREDENTIAL_TTL = process.env.TURN_CREDENTIAL_TTL === undefined
  ? 3600
  : Number(process.env.TURN_CREDENTIAL_TTL);
if (!Number.isInteger(TURN_CREDENTIAL_TTL) || TURN_CREDENTIAL_TTL < 300 || TURN_CREDENTIAL_TTL > 86400) {
  throw new Error("TURN_CREDENTIAL_TTL must be an integer between 300 and 86400 seconds.");
}

const rooms = new Map();
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

function hasSecureTransport(request) {
  if (request.socket.encrypted) return true;
  return request.headers["x-forwarded-proto"]?.split(",")[0].trim().toLowerCase() === "https";
}

function normalizeAllowedOrigins(origins) {
  const values = Array.isArray(origins) || origins instanceof Set
    ? Array.from(origins)
    : String(origins || "").split(",");
  return new Set(values.map((value) => {
    const origin = String(value).trim();
    if (!origin) return "";
    const parsed = new URL(origin);
    if (!["http:", "https:"].includes(parsed.protocol)
      || parsed.origin !== origin.replace(/\/$/, "")) {
      throw new Error(`Invalid frontend origin: ${origin}`);
    }
    return parsed.origin;
  }).filter(Boolean));
}

function isAllowedOrigin(origin, request, allowedOrigins) {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.host === request.headers.host || allowedOrigins.has(parsed.origin);
  } catch {
    return false;
  }
}

function setApiCorsHeaders(response, request, allowedOrigins) {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (!isAllowedOrigin(origin, request, allowedOrigins)) return false;
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return true;
}

function setSecurityHeaders(response) {
  response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self' ws: wss:; media-src 'self' blob:; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), display-capture=(self)");
  if (process.env.NODE_ENV === "production") {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function createIceServers(roomId) {
  const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
  if (TURN_URLS.length) {
    const username = `${Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL}:${roomId}`;
    const credential = crypto
      .createHmac("sha1", process.env.TURN_SHARED_SECRET)
      .update(username)
      .digest("base64");
    iceServers.push({
      urls: TURN_URLS,
      username,
      credential,
    });
  }
  return iceServers;
}

function validSignal(data) {
  const isDescription = (data?.type === "offer" || data?.type === "answer")
    && data.description?.type === data.type
    && typeof data.description.sdp === "string"
    && data.description.sdp.length <= 60_000;
  const isCandidate = data?.type === "ice-candidate"
    && typeof data.candidate?.candidate === "string"
    && data.candidate.candidate.length <= 4096;
  return isDescription || isCandidate;
}

function connectSocketIo(server, allowedOrigins) {
  const io = new SocketIOServer(server, {
    serveClient: true,
    maxHttpBufferSize: 64 * 1024,
    cors: allowedOrigins.size ? { origin: Array.from(allowedOrigins) } : undefined,
    allowRequest(request, callback) {
      const allowedOrigin = isAllowedOrigin(request.headers.origin, request, allowedOrigins);
      const secure = request.socket.encrypted
        || request.headers["x-forwarded-proto"]?.split(",")[0].trim().toLowerCase() === "https";
      const allowedTransport = process.env.NODE_ENV !== "production" || secure;
      callback(null, Boolean(request.headers.host) && allowedOrigin && allowedTransport);
    },
  });

  io.use((socket, next) => {
    const { roomId, role, token, name } = socket.handshake.auth || {};
    const room = rooms.get(roomId);
    const tokenMatches = role === "host"
      && typeof token === "string"
      && token.length === room?.hostToken.length
      && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(room.hostToken));
    if (!room || !ROOM_ID_PATTERN.test(roomId || "")
      || (role !== "viewer" && !tokenMatches)) {
      next(new Error("Sala invalida ou expirada."));
      return;
    }
    if (typeof name !== "string" || !name.trim() || name.trim().length > 32
      || /[\u0000-\u001f\u007f]/.test(name)) {
      next(new Error("Informe um nome de 1 a 32 caracteres para entrar na sala."));
      return;
    }
    socket.data.room = room;
    socket.data.roomId = roomId;
    socket.data.role = role;
    socket.data.name = name.trim();
    next();
  });

  function broadcastParticipants(room) {
    const participants = Array.from(room.socketPeers.values())
      .filter((peer) => peer.connected)
      .map((peer) => ({ name: peer.data.name, role: peer.data.role }));
    for (const peer of room.socketPeers.values()) {
      if (peer.connected) peer.emit("participants", participants);
    }
  }

  io.on("connection", (socket) => {
    const room = socket.data.room;
    const role = socket.data.role;
    const otherRole = role === "host" ? "viewer" : "host";
    const replacedPeer = room.socketPeers.get(role);
    if (replacedPeer) replacedPeer.disconnect(true);
    room.socketPeers.set(role, socket);
    socket.data.sharing = false;
    room.expiresAt = Date.now() + ROOM_TTL_MS;
    socket.emit("joined", { role, name: socket.data.name });
    broadcastParticipants(room);

    const otherPeer = room.socketPeers.get(otherRole);
    if (otherPeer?.connected) {
      otherPeer.emit("peer-ready");
      socket.emit("peer-ready");
      if (otherPeer.data.sharing) {
        socket.emit("sharing-state", { active: true, name: otherPeer.data.name });
      }
    }

    socket.on("signal", (data) => {
      if (!validSignal(data)) {
        socket.disconnect(true);
        return;
      }
      const peer = room.socketPeers.get(otherRole);
      if (peer?.connected) peer.emit("signal", data);
    });

    socket.on("sharing-state", (data) => {
      if (typeof data?.active !== "boolean") return;
      socket.data.sharing = data.active;
      const peer = room.socketPeers.get(otherRole);
      if (peer?.connected) {
        peer.emit("sharing-state", { active: data.active, name: socket.data.name });
      }
    });

    socket.on("disconnect", () => {
      if (room.socketPeers.get(role) !== socket) return;
      room.socketPeers.delete(role);
      broadcastParticipants(room);
      const peer = room.socketPeers.get(otherRole);
      if (peer?.connected) peer.emit("peer-left");
      if (!room.peers.size && !room.socketPeers.size) {
        room.expiresAt = Date.now() + ROOM_TTL_MS;
      }
    });
  });

  return io;
}

function serveStatic(request, response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const isSocketClient = requestedPath === "/socket.io-client.js";
  const filePath = isSocketClient
    ? path.resolve(path.dirname(require.resolve("socket.io")), "..", "client-dist", "socket.io.min.js")
    : path.resolve(PUBLIC_DIR, `.${requestedPath}`);
  if (!isSocketClient && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      if (path.extname(requestedPath)) {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      fs.createReadStream(path.join(PUBLIC_DIR, "index.html"))
        .on("error", (error) => {
          console.error("Could not serve the application:", error);
          if (!response.headersSent) sendJson(response, 500, { error: "Application unavailable" });
        })
        .pipe(response);
      return;
    }

    response.writeHead(200, {
      "Cache-Control": requestedPath === "/index.html"
        || [".js", ".css"].includes(path.extname(filePath))
        ? "no-cache"
        : "public, max-age=3600",
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
    });
    fs.createReadStream(filePath)
      .on("error", (error) => {
        console.error("Could not read application asset:", error);
        if (!response.headersSent) sendJson(response, 500, { error: "Asset unavailable" });
      })
      .pipe(response);
  });
}

function createApplicationServer(options = {}) {
  const allowedOrigins = normalizeAllowedOrigins(options.allowedOrigins ?? process.env.PUBLIC_APP_ORIGINS);
  const server = http.createServer((request, response) => {
    setSecurityHeaders(response);
    let url;
    try {
      url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    } catch {
      sendJson(response, 400, { error: "Invalid request URL" });
      return;
    }

    const isApiRequest = url.pathname.startsWith("/api/");
    if (isApiRequest && !setApiCorsHeaders(response, request, allowedOrigins)) {
      sendJson(response, 403, { error: "Origin is not allowed." });
      return;
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (process.env.NODE_ENV === "production" && !hasSecureTransport(request)) {
      sendJson(response, 426, { error: "Use HTTPS to access this application." });
      return;
    }

    if (isApiRequest && request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      if (rooms.size >= MAX_ROOMS) {
        sendJson(response, 503, { error: "As salas estao ocupadas. Tente novamente em alguns minutos." });
        return;
      }
      const id = crypto.randomBytes(12).toString("base64url");
      const hostToken = crypto.randomBytes(32).toString("base64url");
      rooms.set(id, {
        expiresAt: Date.now() + ROOM_TTL_MS,
        hostToken,
        peers: new Map(),
        socketPeers: new Map(),
      });
      sendJson(response, 201, { roomId: id, hostToken });
      return;
    }

    if (url.pathname === "/api/ice" && request.method === "GET") {
      const roomId = url.searchParams.get("room") || "";
      if (!ROOM_ID_PATTERN.test(roomId) || !rooms.has(roomId)) {
        sendJson(response, 404, { error: "Sala nao encontrada ou expirada." });
        return;
      }
      sendJson(response, 200, { iceServers: createIceServers(roomId) });
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }
    serveStatic(request, response, url.pathname);
  });

  connectSocketIo(server, allowedOrigins);

  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on("upgrade", (request, socket, head) => {
    let upgradePath;
    try {
      upgradePath = new URL(request.url, `http://${request.headers.host}`).pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (upgradePath !== "/signal") return;

    if (process.env.NODE_ENV === "production" && !hasSecureTransport(request)) {
      socket.write("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    const origin = request.headers.origin;
    if (!origin || !isAllowedOrigin(origin, request, allowedOrigins)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    let url;
    try {
      url = new URL(request.url, `http://${request.headers.host}`);
    } catch {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const roomId = url.searchParams.get("room") || "";
    const role = url.searchParams.get("role");
    const room = rooms.get(roomId);
    const token = url.searchParams.get("token") || "";
    const tokenMatches = role === "host"
      && token.length === room?.hostToken.length
      && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(room.hostToken));
    if (url.pathname !== "/signal" || !room || !ROOM_ID_PATTERN.test(roomId)
      || (role !== "viewer" && !tokenMatches)) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      const previousPeer = room.peers.get(role);
      if (previousPeer) {
        previousPeer.close(4001, "Conexao substituida");
      }
      room.peers.set(role, webSocket);
      room.expiresAt = Date.now() + ROOM_TTL_MS;
      webSocket.send(JSON.stringify({ type: "joined", role }));

      const otherRole = role === "host" ? "viewer" : "host";
      const otherPeer = room.peers.get(otherRole);
      if (otherPeer?.readyState === WebSocket.OPEN) {
        otherPeer.send(JSON.stringify({ type: "peer-ready" }));
        webSocket.send(JSON.stringify({ type: "peer-ready" }));
      }

      webSocket.on("message", (rawMessage) => {
        let message;
        try {
          message = JSON.parse(rawMessage.toString());
        } catch {
          webSocket.close(1003, "Mensagem invalida");
          return;
        }

        if (message?.type !== "signal" || !validSignal(message.data)) {
          webSocket.close(1008, "Tipo de mensagem invalido");
          return;
        }
        const peer = room.peers.get(otherRole);
        if (peer?.readyState === WebSocket.OPEN) {
          peer.send(JSON.stringify({ type: "signal", data: message.data }));
        }
      });

      webSocket.on("close", () => {
        if (room.peers.get(role) !== webSocket) return;
        room.peers.delete(role);
        const peer = room.peers.get(otherRole);
        if (peer?.readyState === WebSocket.OPEN) peer.send(JSON.stringify({ type: "peer-left" }));
        if (!room.peers.size && !room.socketPeers.size) room.expiresAt = Date.now() + ROOM_TTL_MS;
      });
    });
  });

  return server;
}

const cleanupTimer = setInterval(() => {
  for (const [id, room] of rooms) {
    if (!room.peers.size && !room.socketPeers.size && room.expiresAt <= Date.now()) rooms.delete(id);
  }
}, 60_000);
cleanupTimer.unref();

if (require.main === module) {
  const applicationServer = createApplicationServer();
  applicationServer.listen(PORT, () => {
    console.log(`UNK running on port ${PORT}`);
  });
}

module.exports = { createApplicationServer };
