// Shared Playwright test: every spec imports { test, expect } from here, not from "@playwright/test".
// content/content.json holds the live RSVP endpoint, so a test that submits an RSVP would post to the real Google Sheet.
// This auto fixture serves content.json with site.rsvpEndpoint blanked and refuses any request to script.google.com.
// Tests that need an endpoint mock it with page.route(...), which takes priority over these context routes.
import { test as base, expect } from "@playwright/test";

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route("https://script.google.com/**", (r) => r.abort());
    await context.route("**/content/content.json", async (r) => {
      const res = await r.fetch();
      if (!res.ok()) return r.fulfill({ response: res });
      let body = await res.text();
      try { const c = JSON.parse(body); if (c?.site) c.site.rsvpEndpoint = ""; body = JSON.stringify(c); } catch { /* not JSON: pass it through */ }
      await r.fulfill({ response: res, body });
    });
    await use(context);
  },
});

export { expect };
