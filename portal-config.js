/*
 * Settings for the owner dashboard (dashboard/) and the GC bid page (bid/).
 * Neither value is a secret: the API refuses anything without an owner's Google sign-in
 * (or, for the bid page, the deal's own link key). See owner-dashboard/README.md.
 */
window.FUND_PORTAL = {
  // The Apps Script web app URL (Deploy → Manage deployments; ends in /exec).
  API_URL: "PASTE_THE_WEB_APP_URL_HERE",

  // The OAuth client ID from Google Cloud (ends in .apps.googleusercontent.com).
  // Same value as GOOGLE_CLIENT_ID in owner-dashboard/Code.gs.
  GOOGLE_CLIENT_ID: "PASTE_THE_CLIENT_ID_HERE",
};
