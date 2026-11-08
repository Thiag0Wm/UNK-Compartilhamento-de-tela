const fs = require("node:fs");
const path = require("node:path");

const publicDirectory = path.join(__dirname, "public");
const socketPackageDirectory = path.dirname(require.resolve("socket.io"));
const socketClient = path.resolve(socketPackageDirectory, "..", "client-dist", "socket.io.min.js");

function normalizeApiBaseUrl(value) {
  const configuredApiBaseUrl = String(value || "").trim();
  if (!configuredApiBaseUrl) return "";

  let apiUrl;
  try {
    apiUrl = new URL(configuredApiBaseUrl);
  } catch {
    throw new Error("UNK_API_BASE_URL must be a valid HTTPS origin.");
  }

  const isLocalHttp = apiUrl.protocol === "http:"
    && ["localhost", "127.0.0.1", "[::1]"].includes(apiUrl.hostname);
  if ((apiUrl.protocol !== "https:" && !isLocalHttp)
    || apiUrl.username
    || apiUrl.password
    || apiUrl.pathname !== "/"
    || apiUrl.search
    || apiUrl.hash) {
    throw new Error("UNK_API_BASE_URL must be an HTTPS origin without credentials, a path, or a query.");
  }

  return apiUrl.origin;
}

function configurePagesCsp(headers, apiBaseUrl) {
  const apiUrl = apiBaseUrl ? new URL(apiBaseUrl) : null;
  const socketUrl = apiUrl
    ? `${apiUrl.protocol === "https:" ? "wss:" : "ws:"}//${apiUrl.host}`
    : "";
  const additionalSources = [apiBaseUrl, socketUrl].filter(Boolean).join(" ");
  const connectSource = `connect-src 'self'${additionalSources ? ` ${additionalSources}` : ""} http://localhost:* ws://localhost:*;`;
  const configuredHeaders = headers.replace(/connect-src [^;]+;/, connectSource);
  if (configuredHeaders === headers && !/connect-src [^;]+;/.test(headers)) {
    throw new Error("Cloudflare Pages headers must define a connect-src policy.");
  }
  return configuredHeaders;
}

function build() {
  const apiBaseUrl = normalizeApiBaseUrl(process.env.UNK_API_BASE_URL);
  const headersPath = path.join(publicDirectory, "_headers");
  fs.writeFileSync(
    headersPath,
    configurePagesCsp(fs.readFileSync(headersPath, "utf8"), apiBaseUrl),
  );
  fs.writeFileSync(
    path.join(publicDirectory, "config.js"),
    `window.UNK_API_BASE_URL = ${JSON.stringify(apiBaseUrl)};\n`,
  );
  fs.copyFileSync(socketClient, path.join(publicDirectory, "socket.io-client.js"));
}

if (require.main === module) build();

module.exports = { build, configurePagesCsp, normalizeApiBaseUrl };
