# RSVP backend (Google Apps Script)

Stores RSVPs in a Google Sheet you own. Sheets created automatically: **Responses**, **Households**, **History** (raw audit trail of every submission).

## Deploy

1. Create a new Google Sheet (e.g. "Wedding RSVPs").
2. **Extensions -> Apps Script**.
3. Delete the starter code, paste all of `Code.gs`, and save.
4. **Project Settings (gear) -> Script properties -> Add script property**: name `ADMIN_KEY`, value a long random string. This protects the `summary` view; keep it private.
5. **Deploy -> New deployment -> Select type: Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click Deploy and authorise when prompted.
6. Copy the **Web app URL** (ends in `/exec`).
7. Put it in `content/content.json` at `site.rsvpEndpoint` (or paste it in the editor's site settings), then publish.
8. Test: open the site with a personal link, submit an RSVP, and check the Sheet.

## Updating the code later (URL stays the same)

Edit the code, then **Deploy -> Manage deployments -> pencil icon -> Version: New version -> Deploy**. Do not use "New deployment" (it creates a new URL).

## API

- `POST` body `payload=<JSON>` (see CONTRACTS.md section 7). Re-submitting replaces that household's rows (keyed by code + memberId + eventId); members removed from the payload have their rows deleted. Codes must match `^[A-Z2-9]{10}$`.
- `GET ?action=get&code=CODE` returns `{ ok, P }` with the household's latest submission.
- `GET ?action=summary&key=ADMIN_KEY` returns households, responses, per-event counts, meal and dietary tallies.
- Anything else returns `ok`.

## Tests

`node apps-script/test-harness.mjs` loads `Code.gs` against mocked Apps Script services and checks upsert, deletion, `get` and `summary`.
