/**
 * "Newly assigned since my last visit" needs a last-visit time per person. It is kept in a cookie
 * on the browser (path /admin, a year), written by `MyVisit` after My work has rendered, so the
 * server can flag fresh assignments in the very first paint and no database write (and no audit
 * entry) happens just for looking at a page. The name carries the admin id so two people sharing
 * a browser do not share a baseline.
 */
export const myVisitCookie = (adminId: string) => `pdv_my_seen_${adminId}`;
