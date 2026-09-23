export type TVGUser = {
    username: string;
    email: string;
    name: string;
    groups: string[];
};
export type HeaderSource = {
    get(name: string): string | null;
} | Record<string, string | string[] | undefined>;
export type AuthOptions = {
    /**
     * Group that grants admin access.
     */
    adminGroup?: string;
};
export type TVGAuth = ReturnType<typeof authFromUser>;
/**
 * Splits a `|`, `,` or `;` separated group string into trimmed group names.
 * @param {string} raw
 * @returns {string[]}
 */
export declare function parseGroups(raw: string): string[];
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
export declare function getUser(source: HeaderSource): TVGUser | null;
/**
 * Like getUser, but throws a 401 Response when no user is present.
 * @param {HeaderSource} source
 * @returns {TVGUser}
 */
export declare function requireUser(source: HeaderSource): TVGUser;
/**
 * Builds an auth object around an already-resolved user (or null).
 * @param {TVGUser | null} user
 * @param {AuthOptions} [options]
 */
export declare function authFromUser(user: TVGUser | null, options?: AuthOptions): {
    /** @type {TVGUser | null} */
    user: TVGUser | null;
    /** @returns {TVGUser} */
    requireUser(): TVGUser;
    /**
     * True if the current user belongs to `groupName`.
     * Always false when there is no authenticated user.
     * @param {string} groupName
     * @returns {boolean}
     */
    hasGroup(groupName: string): boolean;
    /**
     * True if the current user belongs to every group in `groupNames`.
     * Returns false for an empty list or when there is no authenticated user.
     * @param {string[]} groupNames
     * @returns {boolean}
     */
    hasAllGroups(groupNames: string[]): boolean;
    /**
     * True if the current user belongs to at least one group in `groupNames`.
     * Returns false for an empty list or when there is no authenticated user.
     * @param {string[]} groupNames
     * @returns {boolean}
     */
    hasAnyGroup(groupNames: string[]): boolean;
    /** @returns {boolean} */
    isAdmin(): boolean;
};
/**
 * Server-side: builds an auth object bound to one request's headers.
 * @param {HeaderSource} source
 * @param {AuthOptions} [options]
 * @returns {TVGAuth}
 */
export declare function createAuth(source: HeaderSource, options?: AuthOptions): TVGAuth;
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
export declare function fetchAuth(endpoint?: string, options?: AuthOptions): Promise<TVGAuth>;
