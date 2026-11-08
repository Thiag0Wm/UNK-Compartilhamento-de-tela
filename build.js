const fs = require("node:fs");
const path = require("node:path");

const publicDirectory = path.join(__dirname, "public");
const socketPackageDirectory = path.dirname(require.resolve("socket.io"));
const socketClient = path.resolve(socketPackageDirectory, "..", "client-dist", "socket.io.min.js");
const configuredApiBaseUrl = process.env.UNK_API_BASE_URL?.trim();

if (configuredApiBaseUrl) {
  const apiUrl = new URL(configuredApiBaseUrl);
  if (!["http:", "https:"].includes(apiUrl.protocol)
    || apiUrl.pathname !== "/"
    || apiUrl.search
    || apiUrl.hash) {
    throw new Error("UNK_API_BASE_URL must be an HTTP(S) origin without a path.");
  }
  fs.writeFileSync(
    path.join(publicDirectory, "config.js"),
    `window.UNK_API_BASE_URL = ${JSON.stringify(apiUrl.origin)};\n`,
  );
}

fs.copyFileSync(socketClient, path.join(publicDirectory, "socket.io-client.js"));
