// tvg-auth.js — dependency-free Authentik/Traefik forwarded-header auth helpers.
//
// Portable version of app/lib/auth.ts + app/lib/groups.ts for apps deployed on
// Coolify behind Traefik with an Authentik forward-auth middleware.
//
// Traefik adds the X-Authentik-* headers to the request it forwards to your
// server. They are NOT visible to browser JavaScript, so:
//
// ── Server-side (Next.js, Express, Hono, Remix, SvelteKit, …) ────────────────
//
//   import { headers } from "next/headers";
//   const auth = createAuth(await headers());   // Next.js App Router
//   const auth = createAuth(req.headers);        // Express / Node http
//   const auth = createAuth(request.headers);    // Fetch API frameworks
//
//   if (!auth.user) return new Response("Unauthorized", { status: 401 });
//   if (auth.hasGroup("tvg-editors")) { ... }
//   if (auth.hasAllGroups(["tvg-editors", "tvg-finance"])) { ... }  // all
//   if (auth.hasAnyGroup(["tvg-editors", "tvg-finance"])) { ... }   // any
//
//   // Expose the user to client-side code (e.g. at /authapi/me):
//   return Response.json(getUser(request.headers));  // Fetch API
//   res.json(getUser(req.headers));                  // Express
//
// ── Browser (static / SPA pages) ─────────────────────────────────────────────
//
//   const auth = await fetchAuth("/authapi/me");
//   if (auth.hasGroup("tvg-editors")) showEditButton();
//
//   Browser checks only control what the UI shows — anything sensitive must
//   still be checked server-side.

/**
 * @typedef {Object} TVGUser
 * @property {string} username
 * @property {string} email
 * @property {string} name
 * @property {string[]} groups
 */

/**
 * Anything that exposes request headers: a Fetch/Next.js `Headers` object
 * (has `.get()`), or a Node-style plain object (`req.headers`).
 * @typedef {{ get(name: string): string | null } | Record<string, string | string[] | undefined>} HeaderSource
 */

/**
 * @typedef {Object} AuthOptions
 * @property {string} [adminGroup="tvg-admins"] Group that grants admin access.
 */

/**
 * The object returned by createAuth, fetchAuth and authFromUser.
 * @typedef {ReturnType<typeof authFromUser>} TVGAuth
 */

const DEFAULT_ADMIN_GROUP = "tvg-admins";

/**
 * Splits a `|`, `,` or `;` separated group string into trimmed group names.
 * @param {string} raw
 * @returns {string[]}
 */
export function parseGroups(raw) {
  return String(raw ?? "")
    .split(/[;,|]/)
    .map((g) => g.trim())
    .filter(Boolean);
}

/**
 * Reads a single header value from either a `Headers` object or a plain
 * object. Header names are matched case-insensitively.
 * @param {HeaderSource} source
 * @param {string} name
 * @returns {string}
 */
function readHeader(source, name) {
  if (!source) return "";
  if (typeof source.get === "function") return source.get(name) ?? "";

  const lower = name.toLowerCase();
  const key = Object.keys(source).find((k) => k.toLowerCase() === lower);
  if (key === undefined) return "";

  const value = source[key];
  if (Array.isArray(value)) return value.join(",");
  return value ?? "";
}

/**
 * Returns the authenticated user from Authentik/Traefik forwarded headers, or
 * null when no proxy headers are present (e.g. local dev).
 *
 * Uses the X-Authentik-* set when X-Authentik-Username is present, otherwise
 * the generic X-Forwarded-* set. The two sets are never mixed: Traefik
 * overwrites X-Authentik-* but passes X-Forwarded-User/Groups through from
 * the client untouched, so mixing would let a user with no Authentik groups
 * inject their own via X-Forwarded-Groups.
 * @param {HeaderSource} source
 * @returns {TVGUser | null}
 */
export function getUser(source) {
  const authentikUser = readHeader(source, "x-authentik-username");
  const [username, prefix] = authentikUser
    ? [authentikUser, "x-authentik-"]
    : [readHeader(source, "x-forwarded-user"), "x-forwarded-"];

  if (!username) return null;

  return {
    username,
    email: readHeader(source, `${prefix}email`),
    name: readHeader(source, `${prefix}name`) || username,
    groups: parseGroups(readHeader(source, `${prefix}groups`)),
  };
}

/**
 * Like getUser, but throws a 401 Response when no user is present.
 * @param {HeaderSource} source
 * @returns {TVGUser}
 */
export function requireUser(source) {
  const user = getUser(source);
  if (!user) throw new Response("Unauthorized", { status: 401 });
  return user;
}

/**
 * Builds an auth object around an already-resolved user (or null).
 * @param {TVGUser | null} user
 * @param {AuthOptions} [options]
 */
export function authFromUser(user, options = {}) {
  const adminGroup = options.adminGroup ?? DEFAULT_ADMIN_GROUP;
  const groups = new Set(user?.groups ?? []);

  return {
    /** @type {TVGUser | null} */
    user,

    /** @returns {TVGUser} */
    requireUser() {
      if (!user) throw new Response("Unauthorized", { status: 401 });
      return user;
    },

    /**
     * True if the current user belongs to `groupName`.
     * Always false when there is no authenticated user.
     * @param {string} groupName
     * @returns {boolean}
     */
    hasGroup(groupName) {
      return groups.has(groupName);
    },

    /**
     * True if the current user belongs to every group in `groupNames`.
     * Returns false for an empty list or when there is no authenticated user.
     * @param {string[]} groupNames
     * @returns {boolean}
     */
    hasAllGroups(groupNames) {
      if (!user || groupNames.length === 0) return false;
      return groupNames.every((g) => groups.has(g));
    },

    /**
     * True if the current user belongs to at least one group in `groupNames`.
     * Returns false for an empty list or when there is no authenticated user.
     * @param {string[]} groupNames
     * @returns {boolean}
     */
    hasAnyGroup(groupNames) {
      return groupNames.some((g) => groups.has(g));
    },

    /** @returns {boolean} */
    isAdmin() {
      return groups.has(adminGroup);
    },
  };
}

/**
 * Server-side: builds an auth object bound to one request's headers.
 * @param {HeaderSource} source
 * @param {AuthOptions} [options]
 * @returns {TVGAuth}
 */
export function createAuth(source, options = {}) {
  return authFromUser(getUser(source), options);
}

/**
 * Browser-side: fetches the current user from an endpoint that returns
 * `getUser(headers)` as JSON (either the user object itself or `{ data: user }`),
 * and builds an auth object from it. Resolves with `user: null` if the
 * endpoint returns no user, a non-2xx status, or a redirect (an expired
 * Authentik session redirects to the login page) — it never throws.
 * @param {string} [endpoint="/authapi/me"]
 * @param {AuthOptions} [options]
 * @returns {Promise<TVGAuth>}
 */
export async function fetchAuth(endpoint = "/authapi/me", options = {}) {
  let res;
  try {
    res = await fetch(endpoint, {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    return authFromUser(null, options);
  }
  if (!res.ok) return authFromUser(null, options);

  const body = await res.json().catch(() => null);
  const raw = body && "data" in body ? body.data : body;
  if (!raw || !raw.username) return authFromUser(null, options);

  const groups = Array.isArray(raw.groups) ? raw.groups : parseGroups(raw.groups);
  return authFromUser({ ...raw, name: raw.name || raw.username, groups }, options);
}
