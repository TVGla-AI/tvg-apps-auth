// tvg-apps-auth — shared "who am I" endpoint for every app behind Traefik + Authentik.
//
// Traefik routes these paths on every domain here (through the authentik
// middleware), so any app — including static sites — can use them without a
// backend of its own:
//
//   GET /authapi/me           → { data: user } from the X-Authentik-* headers
//   GET /authapi/tvg-auth.js  → the client library, always the current version:
//                               import { fetchAuth } from "/authapi/tvg-auth.js";
//
// Dependency-free: Node built-ins + ./tvg-auth.js.
//
// SECURITY: this service trusts the X-Authentik-* headers it receives. It must
// only be reachable through the Traefik router that applies the authentik
// middleware — never publish its port or give it a Coolify domain.

import http from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { getUser } from "./tvg-auth.js";

const PORT = Number(process.env.PORT) || 3000;
// Everything lives under one prefix so it cannot collide with apps' own /api/* routes.
const BASE_PATH = (process.env.BASE_PATH || "/authapi").replace(/\/+$/, "");
const ME_PATH = `${BASE_PATH}/me`;
const LIB_PATH = `${BASE_PATH}/tvg-auth.js`;

// Served from memory; the ETag lets browsers revalidate cheaply and pick up a
// new version as soon as this service is redeployed.
const LIB_SOURCE = readFileSync(new URL("./tvg-auth.js", import.meta.url));
const LIB_ETAG = `"${createHash("sha1").update(LIB_SOURCE).digest("hex")}"`;

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Cookie",
  });
  res.end(JSON.stringify(body));
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
function sendLibrary(req, res) {
  const headers = {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "no-cache",
    "ETag": LIB_ETAG,
  };
  if (req.headers["if-none-match"] === LIB_ETAG) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, headers);
  res.end(LIB_SOURCE);
}

const server = http.createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;

  // GET /health — container health check (called inside the container, not via Traefik)
  if (path === "/health") return sendJson(res, 200, { data: { ok: true } });

  // Any other path → 404
  if (path !== ME_PATH && path !== LIB_PATH) {
    return sendJson(res, 404, { error: "Not found" });
  }

  // /authapi/me and /authapi/tvg-auth.js are read-only → 405 for anything but GET/HEAD
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  // GET /authapi/tvg-auth.js — the client library as a JS module (ETag-cached)
  if (path === LIB_PATH) return sendLibrary(req, res);

  // GET /authapi/me — current user from the X-Authentik-* headers → { data: user } or 401
  const user = getUser(req.headers);
  if (!user) return sendJson(res, 401, { error: "Unauthorized" });
  return sendJson(res, 200, { data: user });
});

server.listen(PORT, () => {
  console.log(`tvg-apps-auth listening on :${PORT} (${ME_PATH}, ${LIB_PATH})`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
