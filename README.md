# tvg-apps-auth

A single shared `GET /authapi/me` endpoint for every Coolify app behind Traefik + Authentik.
Traefik sends `/authapi/me` on **every domain** here through the `authentik` middleware.
This service reads the `X-Authentik-*` headers and returns the user as JSON.
Apps don't need a backend to know who is logged in. This includes static sites.

It also serves the client library at `/authapi/tvg-auth.js`.
Pages can import the current version directly instead of keeping a copy.

```
Browser ──GET https://anyapp.tvgla.com/authapi/me──▶ Traefik
         (authentik middleware adds X-Authentik-*)
                                              └──▶ tvg-apps-auth ──▶ { "data": { username, email, name, groups } }
```

## Responses

| Status | Body |
|---|---|
| 200 | `{ "data": { "username", "email", "name", "groups": [] } }` |
| 401 | `{ "error": "Unauthorized" }` (no Authentik headers present) |
| 404 / 405 | `{ "error": "..." }` |

`GET /authapi/tvg-auth.js` returns this folder's `tvg-auth.js` as a JavaScript module.
It is sent with `Cache-Control: no-cache` and an `ETag`.
Browsers check for changes on every load, but only download the file again after a redeploy.

`GET /health` returns `{ "data": { "ok": true } }` for container health checks.

## Using it from an app

| Where the code runs | How to get `tvg-auth.js` | What to call |
|---|---|---|
| Static site / no build step | Import from `/authapi/tvg-auth.js` | `fetchAuth()` |
| Browser code in a bundled app | Either: import from the service, or install the package | `fetchAuth()` |
| Server code (incl. server rendering) | **Install the package** — required | `createAuth(req.headers)` / `getUser(req.headers)` |

Browser checks only control what the UI shows. Anything sensitive must still be checked server-side.

### Installing as a package

Install the library from GitHub, pinned to a release tag:

```sh
npm install github:TVGla-AI/tvg-apps-auth#v1.0.0
```

```js
import { createAuth, fetchAuth } from "tvg-apps-auth";
import type { TVGAuth, TVGUser } from "tvg-apps-auth";   // TypeScript
```

Only `tvg-auth.js` and its types (`tvg-auth.d.ts`) are installed. The server and Dockerfile are not.
Pinning to a tag means redeploying the service never changes an app's code.
To upgrade, change the tag and reinstall.

### Static sites

Import the library straight from the service:

```html
<script type="module">
  import { fetchAuth } from "/authapi/tvg-auth.js";

  const auth = await fetchAuth();
  if (auth.hasGroup("tvg-editors")) showEditButton();
  if (auth.hasAnyGroup(["tvg-admins", "tvg-finance"])) showReports();
</script>
```

This works on any static site served through Traefik, with no backend, build step or copy of the library.
Every site picks up a new version as soon as tvg-apps-auth is redeployed.

`fetchAuth()` never throws.
If the Authentik session has expired, Authentik redirects to its login page.
`fetchAuth()` then resolves with `auth.user === null`. Show a "sign in again" link rather than auto-reloading (see [`auth.user`](#authuser)).

In local dev there's no Traefik, so `/authapi/tvg-auth.js` returns 404 and the import itself fails.
To test locally, use a local copy of `tvg-auth.js` (or the installed package) and stub `/authapi/me`.

### Bundled apps: browser code (Vite, webpack, …)

Either approach works. Choose per app:

**Import from the service.** The app always gets the current version, and there is no copy to keep in sync.
Bundlers resolve imports at build time, so skip resolution for this one:

```js
const { fetchAuth } = await import(/* @vite-ignore */ "/authapi/tvg-auth.js");
```

Or mark `/authapi/tvg-auth.js` as external in the bundler config.
Trade-offs:
- It fails in local dev without Traefik.
- Editors can't read its types, so there's no autocomplete or type checking.
- It changes under the app whenever tvg-apps-auth is redeployed.

**Install the package** ([see above](#installing-as-a-package)). It works in local dev and gives editor and type support.
The version stays pinned to the tag until you upgrade and test it.
The trade-off is that apps can fall behind the latest release.
The functions (`hasGroup`, `hasAllGroups`, `hasAnyGroup`, `isAdmin`) are kept stable, so an older version keeps working.

### Server code

Always [install the package](#installing-as-a-package):

```js
import { createAuth } from "tvg-apps-auth";

const auth = createAuth(req.headers);          // Express / Node
// const auth = createAuth(await headers());   // Next.js App Router
if (!auth.hasGroup("tvg-editors")) return new Response("Forbidden", { status: 403 });
```

Importing from `/authapi/tvg-auth.js` can't work on the server:
- Node treats `/authapi/tvg-auth.js` as a file path on disk, not a URL.
- A request made from inside the container never passes through Traefik, so it can't reach the tvg-apps-auth service.

This applies to the server-rendering parts of Next.js, Remix, SvelteKit and similar frameworks too.
The server already has the headers, so it doesn't need `/authapi/me` at all.

## `tvg-auth.js` reference

### Getting an auth object

Every entry point returns the same **auth object**, so group checks read the same everywhere.

| Function | Runs in | Returns |
|---|---|---|
| `fetchAuth(endpoint?, options?)` | Browser | `Promise<auth>` from calling `/authapi/me` (default endpoint) |
| `createAuth(headers, options?)` | Server | `auth` from the request headers |
| `authFromUser(user, options?)` | Either | `auth` from a user object you already have (e.g. rendered into the page, or in tests) |

`headers` can be a Fetch/Next.js `Headers` object or a Node-style `req.headers` object.
Header names are matched case-insensitively.

`options`:

| Option | Default | Purpose |
|---|---|---|
| `adminGroup` | `"tvg-admins"` | The group `isAdmin()` checks for |

```js
// Browser
const auth = await fetchAuth();                         // GET /authapi/me
const auth = await fetchAuth("/authapi/me", { adminGroup: "tvg-it" });

// Server
const auth = createAuth(req.headers);                   // Express / Node http
const auth = createAuth(await headers());               // Next.js App Router
const auth = createAuth(request.headers);               // Fetch API (Hono, Remix, workers)

// From a user you already have
const auth = authFromUser(window.__USER__ ?? null);
```

### The auth object

#### `auth.user`

The logged-in user, or `null` when there isn't one.
`null` means no proxy headers were present (local dev), the session expired, or the request failed.

```js
{
  username: "larry",              // always set
  email: "larry@tvgla.com",       // "" if not forwarded
  name: "Larry Davidson",         // falls back to username if X-authentik-name isn't forwarded
  groups: ["tvg-admins", "tvg-editors"]
}
```

```js
if (auth.user) {
  greeting.textContent = `Hi, ${auth.user.name}`;
} else {
  // Don't auto-reload: if tvg-apps-auth is down (or in local dev) that loops forever.
  // Loading any page through Traefik sends the user to Authentik login.
  greeting.innerHTML = `Session expired — <a href="${location.href}">sign in again</a>`;
}
```

#### `auth.hasGroup(groupName)` → `boolean`

True if the user is in `groupName`.
It is always `false` when there is no user.
Group names must match exactly, including case.

```js
if (auth.hasGroup("tvg-editors")) showEditButton();
```

#### `auth.hasAllGroups(groupNames)` → `boolean`

True only if the user is in **every** group listed.
Returns `false` for an empty list or when there is no user.

```js
// Must be both an editor AND in finance
if (auth.hasAllGroups(["tvg-editors", "tvg-finance"])) showBudgetEditor();
```

#### `auth.hasAnyGroup(groupNames)` → `boolean`

True if the user is in **at least one** of the groups listed.
Returns `false` for an empty list or when there is no user.

```js
// Admins OR finance can see reports
if (auth.hasAnyGroup(["tvg-admins", "tvg-finance"])) showReports();
```

#### `auth.isAdmin()` → `boolean`

True if the user is in the admin group: `tvg-admins`, or `options.adminGroup` if set.
It's shorthand for `auth.hasGroup(adminGroup)`, so every app checks admin the same way.

```js
const auth = createAuth(req.headers, { adminGroup: "tvg-admins" });
if (!auth.isAdmin()) return res.status(403).json({ error: "Forbidden" });
```

#### `auth.requireUser()` → `TVGUser`

Returns `auth.user`, or throws a `Response` with status 401 when there is no user.
Frameworks that treat a thrown `Response` as the reply (Remix / React Router loaders and actions) use it as-is.
Elsewhere, catch the thrown `Response` yourself or check `auth.user` instead.

```js
// Remix / React Router loader
export async function loader({ request }) {
  const user = createAuth(request.headers).requireUser();   // 401 if not logged in
  return { user };
}
```

### Other exports

| Function | Purpose |
|---|---|
| `getUser(headers)` | Returns the user from the headers, or `null`. This is what `/authapi/me` returns. |
| `requireUser(headers)` | Like `getUser`, but throws a 401 `Response` when there is no user. |
| `parseGroups(raw)` | Splits a `\|`, `,` or `;` separated string into trimmed group names. |

```js
getUser(req.headers);                     // { username, email, name, groups } | null
parseGroups("tvg-admins|tvg-editors");    // ["tvg-admins", "tvg-editors"]
```

### Putting it together

```html
<!-- Static site -->
<nav>
  <a href="/">Home</a>
  <a href="/reports" id="reports-link" hidden>Reports</a>
  <a href="/admin" id="admin-link" hidden>Admin</a>
  <span id="who"></span>
</nav>

<script type="module">
  import { fetchAuth } from "/authapi/tvg-auth.js";

  const auth = await fetchAuth();
  if (!auth.user) {
    document.querySelector("#who").innerHTML = `<a href="${location.href}">Sign in</a>`;
  } else {
    document.querySelector("#who").textContent = auth.user.name;
    document.querySelector("#reports-link").hidden = !auth.hasAnyGroup(["tvg-admins", "tvg-finance"]);
    document.querySelector("#admin-link").hidden = !auth.isAdmin();
  }
</script>
```

```js
// Express API — enforce the same rules server-side
import { createAuth } from "tvg-apps-auth";

app.get("/api/reports", (req, res) => {
  const auth = createAuth(req.headers);
  if (!auth.user) return res.status(401).json({ error: "Unauthorized" });
  if (!auth.hasAnyGroup(["tvg-admins", "tvg-finance"])) {
    return res.status(403).json({ error: "Forbidden" });
  }
  res.json({ data: getReports() });
});
```

## Deploying

### 1. Run the container on the Coolify network with a stable hostname

Traefik's file provider reaches the service by hostname, the same way it reaches `authentik-proxy`.
So the container needs a fixed name on the `coolify` network.
**Do not give it a domain in Coolify and do not publish its port.**
Any request that skips the middleware could fake the `X-Authentik-*` headers.

For example, as a Docker Compose resource with Coolify's "Connect to Predefined Network" enabled:

```yaml
services:
  tvg-apps-auth:
    build: .              # this folder
    container_name: tvg-apps-auth
    restart: unless-stopped
```

Or build the Dockerfile directly (`docker build -t tvg-apps-auth .` from this folder).
The folder is self-contained, so it can also be moved into its own repo as-is.

### 2. Add the router to the Traefik dynamic config (`authentik-headers.yaml`)

```yaml
http:
  routers:
    authentik-apps-auth:
      rule: PathPrefix(`/authapi/`)
      entryPoints:
        - http            # match the entry points your other authentik routers use
      middlewares:
        - authentik@file  # REQUIRED — this is what authenticates and adds the headers
      service: tvg-apps-auth-svc
      priority: 15000
  services:
    tvg-apps-auth-svc:
      loadBalancer:
        servers:
          - url: 'http://tvg-apps-auth:3000'
```

Also add `X-authentik-name` to the middleware's `authResponseHeaders`.
Otherwise `name` falls back to `username`.

**Note:** because of its high priority, this router takes `/authapi/*` on *every* domain it matches.
Apps must not use `/authapi/` for their own routes. Their `/api/*` routes are unaffected.
To exclude a domain, add a host check:
``PathPrefix(`/authapi/`) && !Host(`thatapp.tvgla.com`)``

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Listen port |
| `BASE_PATH` | `/authapi` | Path prefix. Serves `<BASE_PATH>/me` and `<BASE_PATH>/tvg-auth.js`. Keep in sync with the Traefik rule. |

## Releasing a new version

1. Change `tvg-auth.js`.
2. Run `npm run types` to regenerate `tvg-auth.d.ts`, and commit both files.
3. Bump `version` in `package.json`.
4. Tag and push: `git tag vX.Y.Z && git push origin main --tags`.

Apps upgrade by installing the new tag. Redeploying the service updates `/authapi/tvg-auth.js` for sites that import it remotely.
