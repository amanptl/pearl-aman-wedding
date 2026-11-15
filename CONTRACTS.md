# Build Contracts — read before writing any code

This file is the single source of truth shared by every agent. If you need to change a contract, stop and report it; do not silently diverge.

## 0. Ground rules
- **No build step.** Plain ES modules (`<script type="module">`), plain CSS. Served as static files by GitHub Pages. The only npm deps are dev-only (Playwright, axe, serve).
- **External scripts:** only from cdn.jsdelivr.net or cdnjs with an exact pinned version, or vendored into `vendor/`. Fonts come from Google Fonts (already in use: Bodoni Moda, Gilda Display, Corinthia, Pinyon Script).
- **Assets:** use only files in `assets/` or ones you generate. Never download anything from the Canva site.
- **File ownership:** each agent edits only the files it owns (see §9). Shared files (`tokens.css`, `dom.js`, `schema.json`, `content.json`) change only in Phase 0 or by the integrator.
- **Layout rule (alignment):** use flex/grid and normal flow for all content. Absolute positioning is allowed only for decorative layers that are `aria-hidden="true"` and `pointer-events:none`, and for the home flat-lay board (fixed-aspect artwork). Every component must look right with 0 items, 1 item, many items, and very long strings (see `tests/fixtures/stress.json`). No horizontal page scroll at 320px.
- **Accessibility:**
  - Body text ≥ 17px; contrast ≥ 4.5:1 (large text ≥ 3:1).
  - Tap targets ≥ 44×44px; visible `:focus-visible` rings.
  - Script fonts (Corinthia, Pinyon) only for decorative words ≥ 32px, and the same information must also exist in readable text.
  - All interactive elements are real `<button>`/`<a>`; respect `prefers-reduced-motion`; every image has alt text (decorative images use `alt=""`).
- **Escaping:** never inject unescaped content. Use `html\`\`` from `dom.js`, which auto-escapes interpolations, or `textContent`.
- **No `alert`/`confirm`/`prompt`.** Use the in-page toast (`ctx.toast(msg)`) or a `<dialog>`.

## 1. Files
```
index.html              guest shell: header, nav, <main> with one <section data-page> per page, intro
src/main.js             boot: load content → resolve guest → build ctx → router → render pages
src/lib/dom.js          $, $$, html, raw, esc, getPath, setPath, editAttrs
src/lib/store.js        loadContent(), loadGuests(), validate(content)
src/lib/crypto.js       sha256Hex, deriveKey, encryptJSON, decryptJSON
src/lib/guest.js        resolveGuest(), lookupByName(), rememberGuest(), forgetGuest()
src/lib/time.js         venue-time formatting, day grouping, now/next
src/lib/calendar.js     icsForEvents(), googleCalUrl()
src/lib/maps.js         directionsUrl(), mapEmbedUrl(), driveEstimate()
src/lib/ui.js           toast(), copyToClipboard(), dialog helpers (owner: utilities agent)
src/pages/<id>.js       one module per page (contract in §4)
src/styles/tokens.css   design tokens (colours, type scale, spacing, radii, shadows)
src/styles/base.css     reset, typography, buttons (.btn), cards, layout primitives, nav, intro
src/styles/pages/<id>.css
edit/                   editor (its own index.html, loads the same page modules with ctx.mode = "edit")
content/content.json    public content
content/schema.json     JSON Schema (draft 2020-12) for content.json
content/guests.json     encrypted guest index (§6)
content/admin.enc.json  encrypted admin bundle (§6)
apps-script/Code.gs     RSVP backend (§7)
sw.js, manifest.webmanifest
tests/                  Playwright specs, tests/fixtures/*.json, tests/helpers/layout.js
```

## 2. Routing
- Hash routes: `#home` (default), `#schedule`, `#travel`, `#story`, `#faq`, `#registry`, `#rsvp`. Deep link into Q&A: `#faq/<faqId>`. Into an event: `#schedule/<eventId>`.
- Personal link: `/?i=<CODE>`. The code is case-insensitive, 10 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. After it resolves, the guest is remembered (§6) and `?i=` is removed with `history.replaceState`.
- A page is hidden from navigation when `page.isEmpty(ctx)` is true or `content.pages[id].enabled === false`.
- Navigation:
  - **≥ 768px:** a horizontal nav under the banner.
  - **< 768px:** a sticky bottom tab bar with Home · Schedule · Travel · Q&A · RSVP, plus a "More" button that opens a sheet listing the remaining pages. Respect `env(safe-area-inset-bottom)`.
- Page changes move focus to the page `<h1>` and scroll to the top, instantly when motion is reduced. Page changes use the View Transitions API when available (falling back to a short opacity fade); the home board reveal runs only after the intro opens.

## 3. ctx (passed to every page)
```js
ctx = {
  content,            // parsed content.json (in edit mode: the live draft, merged with private events)
  guest,              // null | Guest (§6)
  events,             // Event[] visible to this viewer, sorted by start. Public events + guest's private events. Edit mode (no preview): all events.
  mode,               // "guest" | "edit"
  now: () => Date,    // use this rather than new Date(), so tests can freeze time
  tz,                 // content.site.timezone, e.g. "America/Toronto"
  navigate(route),    // e.g. ctx.navigate("rsvp")
  toast(message),     // non-blocking status message (aria-live polite)
  rerender(pageId?),  // re-render one page or all
}
```

## 4. Page module contract (`src/pages/<id>.js`)
```js
export default {
  id: "travel",
  navLabel: "Travel",
  title: (ctx) => "Travel & Stay",          // becomes the <h1>
  isEmpty: (ctx) => boolean,
  render(root, ctx) { ... },                // root = <section data-page="travel">. Must be idempotent: replace root's contents entirely.
}
```
- No global listeners that pile up across re-renders. Use event delegation on `root`, attached once (guard with `root.dataset.bound`).
- Pages must not reach into other pages' DOM.

## 5. Editing hooks (renderers MUST emit these; the editor relies on them)
Use `editAttrs(kind, path)` from `dom.js`. It returns an attribute string, and is safe to call in guest mode (it then emits only `data-path`).

| What | Markup |
|---|---|
| Single-line text | `<h3 data-edit="text" data-path="hotels.0.name">…</h3>` |
| Multi-line text (one string; `\n` means line break) | `data-edit="multiline"`. Render `\n` as `<br>`. |
| Paragraph list (`string[]`) | container: `data-list="story.paragraphs"`; each `<p data-edit="multiline" data-path="story.paragraphs.2" data-index="2">` |
| Image (an Image object, §5.1) | `<img data-edit="image" data-path="hotels.0.photo" …>` |
| Reorderable list | container `data-list="hotels"`; each child `data-item="hotels.3" data-index="3"` |
| Item with hidden fields (URLs, dates, codes) | the same `data-item` element; the editor opens a side panel generated from schema.json for that path |
| Page section toggle/order | `content.pages` (§8). The editor handles it, not renderers. |

Notes:
- Events are always shown sorted by `start`. They are not drag-reordered, so the events container is `data-list="events"` for add/delete only, with `data-sort="auto"`.
- A text element whose value is empty in edit mode must still render, with a `data-placeholder="Add hotel name"` attribute, so it can be clicked. In guest mode, empty optional fields are omitted entirely, with no empty boxes or dangling labels.

### 5.1 Image object
`{ "src": "assets/x.webp", "srcSmall": "assets/x-600.webp", "alt": "…", "focal": [50, 50] }`

Render with `object-fit: cover; object-position: <focal[0]>% <focal[1]>%`. Use `srcset` when `srcSmall` exists. Add `loading="lazy"` except for above-the-fold images.

## 6. Guests & privacy
**Guest (decrypted household record):**
```js
{ code, household: "Sharma Family", greeting: "Dear Sharma Family",
  members: [{ id: "m1", name: "Raj Sharma" }, { id: "m2", name: "Priya Sharma" }],
  plusOnes: 0,                       // extra unnamed guests allowed
  eventIds: ["mehndi","sangeet","wedding","reception"],
  privateEvents: [Event, ...],       // full copies of the private events this household is invited to
  tags: ["close-family"] }
```

**content/guests.json (public, all values opaque):**
```json
{ "v": 1, "kdf": { "iter": 150000, "salt": "<base64>" },
  "records": { "<sha256hex(CODE)>": { "iv": "<b64>", "ct": "<b64>" } },
  "names":   { "<sha256hex(normName)>": { "iv": "<b64>", "ct": "<b64>" } } }
```
- **records:** AES-GCM-256. The key is `PBKDF2-SHA256(CODE, salt, iter)`. The plaintext is the Guest object.
- **names:** one entry per member. `normName` = lowercased, NFD with diacritics stripped, non-letters removed, whitespace collapsed, in the form `"first last"`. Also add a `"last first"` variant. The key is `PBKDF2(normName, salt, iter)`. The plaintext is `{ code }`.

**content/admin.enc.json:** `{ v, kdf, iv, ct }`. The key comes from PBKDF2 of the couple's passphrase. The plaintext is:
```js
{ households: [Guest without privateEvents], privateEvents: [Event], rsvpAdminKey }
```

- **Editor extras in the admin bundle (never in public files):** `presets: [{ id, name, tag, eventIds: [ids] | ["*"] }]` (group presets, `"*"` = every event), `waTemplate` / `waReminder` (WhatsApp message texts with `{greeting} {link} {couple} {household} {deadline}`), and `rsvpAdminKey`. Households may carry an `id` (kept for matching only; it is stripped from guest records).
- **Editor draft:** `draft.events` holds ALL events (public + private) and `draft._admin` holds `{ households, presets, waTemplate, waReminder, rsvpAdminKey }`. On publish `content.json` gets the public events only; `guests.json` + `admin.enc.json` are rebuilt only when the guest list or private events changed, all in one commit.
- **Public vs private events:** `content.json` holds only events with `visibility: "public"`. Private events live only in `admin.enc.json`, plus copies inside each invited household's record. The editor regenerates `guests.json` on every publish.
- **Remembering a guest:** localStorage key `pa.guest.v1` holds `{ code }`. Wrap every storage access in try/catch.
- **Lookup failure:** the UI shows "We couldn't find that name. Try the spelling on your invitation, or message us." along with the coordinator contact.

## 7. RSVP backend contract (Apps Script web app)
**POST** (`mode: "no-cors"`), body `URLSearchParams({ payload: JSON.stringify(P) })`:
```js
P = { code, household, submittedAt,
      members: [{ id, name, meal, dietary }],           // includes named plus-ones as id "p1".. with entered name
      responses: [{ memberId, eventId, attending: "yes"|"no" }],
      extras: { hotel: "need"|"booked"|"local"|"", arrival, departure, flight, address, shuttle: { [eventId]: seats }, phone, message } }
```
The backend upserts rows keyed by (code, memberId, eventId) in the **Responses** sheet, and one row per code in the **Households** sheet (with extras). Re-submitting replaces rather than duplicates.

- **GET `?action=get&code=CODE`:** returns `{ ok, P | null }`, the household's latest submission, used to pre-fill the form.
- **GET `?action=summary&key=ADMIN_KEY`:** returns `{ ok, households:[…], responses:[…] }` for the editor dashboard.
- The endpoint URL lives in `content.site.rsvpEndpoint`. If it's empty, the site runs in demo mode: it logs to the console and stores the submission in localStorage under `pa.rsvp.v1.<code>`.

## 8. content.json shape (summary; schema.json is authoritative)
```js
{
  site: { title, couple: { first, second }, initials, hashtag, timezone: "America/Toronto",
          weddingDate /* ISO local, used for countdown */, dateText, city,
          rsvpEndpoint, siteUrl, ogImage: Image,
          contacts: [{ name, role, phone, whatsapp: true|false }] },
  pages: { home: { enabled, order }, schedule: {…}, travel: {…}, story: {…}, faq: {…}, registry: {…}, rsvp: {…} },
  home: { photo: Image, invitationLines: { small, venueLines: [] }, welcome },
  events: [{ id, name, subtitle, start: "2027-07-23T18:00", end, timezone?,
             venue: { name, address, lat, lng, mapsQuery, parking, notes },
             description, dressCode: { title, text, swatches: ["#hex"], tips: [] },
             notes: [] /* e.g. "Phone-free ceremony" */, photo: Image|null,
             visibility: "public"|"private", rsvp: true|false, shuttle: true|false }],
  hotels: [{ id, name, type: "block"|"nearby", recommended, photo: Image|null, rate, rateNote,
             bookingUrl, groupCode, bookBy: "2027-06-01", address, lat, lng, phone,
             perks: [], driveMinutes: { [eventId]: number } /* overrides */, notes }],
  travel: { intro,
            airports: [{ id, code, name, primary, driveMinutes, tips }],
            gettingAround: [{ id, title, text }],      // rideshare, car rental, transit
            shuttles: [{ id, eventId, from, departs, returns }],
            international: { title, text },
            aroundTown: [{ id, category, name, text, url, address }] },
  story: { teaser, paragraphs: [], photos: [Image] },
  people: [{ id, name, role, side, bio, photo }],      // optional, the page is hidden when empty
  registry: { photo: Image, paragraphs: [], links: [{ label, url }] },
  faqCategories: [{ id, title }],
  faq: [{ id, category, q, a }],
  rsvp: { deadline: "2027-06-01", deadlineText, intro: [], mealOptions: [], dietaryOptions: [],
          questions: { hotel, travelDates, flight, address, shuttle, phone, song } }
}
```

## 9. Ownership map
| Agent | Owns |
|---|---|
| P0 foundation | everything in §1 except the files listed for other agents below; it creates stubs for those |
| 1a guest UI A | `src/pages/{home,schedule,story,registry}.js`, `src/styles/pages/{home,schedule,story,registry}.css` |
| 1b guest UI B | `src/pages/{travel,faq}.js`, `src/styles/pages/{travel,faq}.css` |
| 2 privacy | `src/lib/{crypto,guest}.js`, the name-lookup UI (`src/pages/_lookup.js`, `src/styles/pages/lookup.css`), `tools/make-guests.mjs` (a CLI to build sample guests.json/admin.enc.json) |
| 3 RSVP | `src/pages/rsvp.js`, `src/styles/pages/rsvp.css`, `apps-script/Code.gs`, `apps-script/README.md` |
| 4 utilities | `src/lib/{time,calendar,maps,ui}.js`, `sw.js`, `manifest.webmanifest`, `tools/images.mjs` |
| 5 editor | `edit/**` |
| integrator | `index.html`, `src/main.js`, `base.css`, `tokens.css`, content files |

Each agent adds Playwright specs for its own area at `tests/<area>.spec.js`.
