# Pearl & Aman — Wedding Website

Plain HTML, CSS and ES modules. No build step. See `CONTRACTS.md` for the architecture.

This guide has two audiences. The first half is for the couple (editing, guests, sending links, privacy). The second half is for whoever sets things up and develops (Apps Script, dev commands).

---

## 1. Editing the site (no code needed)

1. Open **`/edit/`** on your published site (for example `https://YOURNAME.github.io/REPO/edit/`).
2. Click any text on the page to change it. Drag cards to reorder, drop photos onto pictures, and use the side panel for details such as links and dates. Undo and redo work as you expect (Ctrl/Cmd+Z). Your draft is saved on this computer as you go.
3. **Connect to GitHub once** so Publish works: open the `···` menu, then *Publishing settings*. You need a fine-grained personal access token:
   - GitHub, then Settings, Developer settings, Personal access tokens, Fine-grained tokens, *Generate new token*.
   - Repository access: *Only select repositories*, then pick the wedding repository.
   - Permissions: *Contents: Read and write*. Nothing else.
   - Paste the token into the editor. It is stored only in this browser.
4. Press **Publish**. Everything you changed goes live in one step (usually under a minute).

### Unlock the guest list
Private events (for example Mehndi, Haldi, Sangeet) and your households are stored **encrypted**. A grey-blue banner at the top says *Unlock guest list to edit private events and guests* until you unlock.

- Press **Unlock** and type your guest-list passphrase. The very first time there is no guest list yet, and the editor asks you to **create a passphrase** (at least 8 characters). Write it down: if it is lost, the guest list cannot be recovered. You can always rebuild it from your spreadsheet.
- The passphrase is remembered for this browser tab only and is forgotten when you close the tab.
- While locked you can still edit all public content. Publishing is refused if a private event is part of the draft ("Unlock to publish private events").

## 2. Guests and personal links

Open the **Guests** tab (after unlocking).

- **Households:** one row per invitation. Edit the household name, the guests (type a name, press Enter), plus-ones (extra unnamed guests), groups, and tick the events they are invited to. Ticking an event decides what that household sees on its Schedule and RSVP pages.
- **Groups (presets):** tick some households, then press a group such as *Close family* (all events) or *Friends* (Sangeet + Wedding + Reception) to set their events in one go. *Edit groups…* lets you change what each group means.
- **Add household** adds a row and puts the cursor in the name field. **Delete** asks first.
- **Search and filters:** by name, group or event.
- **Import CSV:** columns `household, members, tags, events, plusOnes`. Separate several names or events with `;`. `events` can be event ids (`wedding;reception`), `all`, or a group name (`Friends`). You see a preview with any problems before anything is added. Existing households (same name) keep their personal link.
- **Export CSV** gives every household with its personal link, handy for mail merges.
- Per household:
  - **Copy link:** the personal link `https://yoursite/?i=CODE`.
  - **Copy WhatsApp message:** a warm, ready-to-paste message starting "Dear Sharma Family, ...". Edit the wording with **Message text** (the same box edits the reminder message).
  - **QR code:** shows a QR code you can download as a PNG (for printed invitations).
  - **Preview as:** shows the website exactly as that household sees it. The toolbar's *Preview as* menu also offers *Everyone* (all events) and *Public visitor* (public events only, no greeting).

A household's personal link never changes once created, so links already sent keep working. Press **Publish** so new households' links start working.

### Sending links
1. Publish, then open the Guests tab.
2. Press the speech-bubble button next to a household, open WhatsApp, and paste. Or export the CSV and use a mail merge.
3. When guests open their link they see their own events and a "Viewing as ..." line. Guests without a link can type their name on the home page to find their invitation.

### Responses dashboard
**Guests, then Responses** shows who has replied (it reads your Google Sheet), attendance per event (yes, no and pending, where pending means invited guests who haven't answered), meal and dietary totals, households that haven't replied yet (each with a *Copy reminder* button), hotel needs, arrivals and flights, and an *Export CSV*.

To connect it:
1. Deploy the Apps Script (section 4) and paste its web-app URL into the editor at *Home, Site, RSVP address* (`site.rsvpEndpoint`). Publish.
2. In the Responses view open *RSVP connection and admin key* and press **Copy key** (use **Generate admin key** to make a new one).
3. In your Google Sheet: *Extensions, Apps Script*, then *Project Settings* (the gear), scroll to **Script properties**, add a property named `ADMIN_KEY` and paste the key as its value. Save.
4. Back in the editor, Publish (this stores the key encrypted with the guest list), then press **Refresh responses**.

If the dashboard says the key wasn't accepted, the key in Apps Script and the one shown in the editor don't match.

## 3. How privacy works (plain language)

- **What anyone can read:** `content/content.json` (the public events, hotels, FAQ and so on) and two scrambled files, `guests.json` and `admin.enc.json`. Anyone can download those, but they contain no readable names or private events.
- **Personal links:** each household's details (names, private events) are locked with its own secret code, which only appears in that household's link. Opening the link unlocks just that household. There is no list of names on the website.
- **Name lookup:** each name is also locked with itself as the key, so typing a name unlocks only the matching invitation. A stranger can't browse or download a list of guests.
- **The admin file** (`admin.enc.json`) holds the whole guest list and private events, locked with **your passphrase**. Without the passphrase it is unreadable, even to GitHub.
- **Honest limits:** anyone who guesses a guest's exact name can see that guest's invitation (that is how the name lookup works), and anyone with a link sees that household's events. Private event names that you mention in public text (for example the FAQ or hotel notes) are public. Photos uploaded for a private event are stored as ordinary public files.
- **On this computer:** the editor never saves private events or households to long-term browser storage. They live in the tab's session storage only.

## 4. Deploy the RSVP backend (Google Apps Script)

Full notes are in `apps-script/README.md`. In short:
1. Create a Google Sheet. *Extensions, Apps Script*, paste `apps-script/Code.gs`.
2. *Deploy, New deployment, Web app*. Execute as: **Me**. Who has access: **Anyone**. Copy the web-app URL.
3. Paste the URL into `site.rsvpEndpoint` (editor: Home, Site, RSVP address) and publish. An empty address means demo mode (replies are only logged in the browser).
4. Add the `ADMIN_KEY` script property as in the Responses section above.
5. After changing `Code.gs`, deploy a **new version** of the web app.

## 5. Developing

```
npm install
npm start                 # http://localhost:5173
npm test                  # Playwright on six device projects
node --test tests/unit/*.test.mjs
node apps-script/test-harness.mjs
```
- Use another port with `PORT=5207 npx playwright test --workers=4` (output goes to `test-results/<port>`). Keep to 4 workers or WebKit gets flaky.
- `SHOTS=1 npx playwright test tests/guests-editor.spec.js` saves screenshots to `tests/screens/`.
- Dev switches (localhost only): `?content=tests/fixtures/stress.json` loads a content fixture; `?guest=tests/fixtures/guest-family.json` loads a plaintext guest; `?all=1` shows every event of the loaded content, but private events are no longer in `content.json`, so **`?all=1` only reveals them together with `?guest=`** (the guest fixture carries its private events). `?intro=0` skips the envelope.
- **Rebuild the sample guest files** (dev passphrase is `dev-passphrase`; never use it for the real list):
  `node tools/make-guests.mjs --households tools/sample-households.json --passphrase dev-passphrase`
  Existing codes are kept. In real use the editor writes `guests.json` and `admin.enc.json` for you on Publish.
- **Service worker:** `sw.js` must list every `src/**/*.js|css` file in `SHELL` (`tests/unit/sw.test.mjs` checks it). Bump `VERSION` when cached files change.
- **Images:** `node tools/images.mjs` writes WebP versions (`assets/img/<name>.webp` and `-600.webp`). Icons: `node tools/icons.mjs`.
- `vendor/qrcode.min.js` is `qrcodejs@1.0.0`, used by the editor's QR sheet and `/qr/`.

## Structure
- `index.html`, `src/main.js`: shell, boot and router.
- `src/pages/*.js`: one module per page (home, schedule, travel, story, faq, registry, rsvp).
- `src/lib/*.js`: helpers (dom, store, time, calendar, maps, ui, icons, crypto, guest, guestfiles).
- `src/styles/`: `tokens.css`, `base.css`, `pages/*.css`.
- `content/content.json` (+ `schema.json`): public content. `guests.json`, `admin.enc.json`: encrypted guest files.
- `edit/`: the editor (`guests.js` is the guest manager, `guestlib.js` its pure helpers, `publish.js` the one-commit publish).
- `legacy/`: the previous single-page version.

## QR code and email
`/qr/` renders a QR code for `site.siteUrl`. `email/invite.html` is a ready-made email; replace `../assets/` and the site URL with real addresses before sending. Set `site.siteUrl` once the site is published: it is used for personal links and QR codes.
