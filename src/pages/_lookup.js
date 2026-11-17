// "Find your invitation" name lookup. Never logs codes or guest data.
import { html } from "../lib/dom.js";
import { lookupByName, rememberGuest, BADCODE_KEY } from "../lib/guest.js";
import { telUrl, whatsappUrl } from "../lib/maps.js";
import * as icon from "../lib/icons.js";

let uid = 0;
const safe = (fn) => { try { return fn(); } catch { return null; } };

/** Split "Raj Kumar Sharma" -> first "Raj", last "Kumar Sharma" (lookup normalises either way). */
function splitName(v) {
  const parts = String(v).trim().split(/\s+/);
  return { first: parts[0] || "", last: parts.slice(1).join(" ") };
}

function contactsHtml(ctx) {
  const contacts = ctx?.content?.site?.contacts || [];
  if (!contacts.length) return "";
  return html`<ul class="lookup__contacts">${contacts.map((c) => html`<li>
    <span class="lookup__contact-name">${c.name}${c.role ? html` <span class="muted">(${c.role})</span>` : ""}</span>
    <span class="cluster">
      ${c.phone && c.whatsapp ? html`<a class="btn btn--secondary btn--small" href="${whatsappUrl(c.phone)}" target="_blank" rel="noopener">${icon.whatsapp()}WhatsApp</a>` : ""}
      ${c.phone ? html`<a class="btn btn--secondary btn--small" href="${telUrl(c.phone)}">${icon.phone()}Call</a>` : ""}
    </span></li>`)}</ul>`;
}

/**
 * Render the lookup UI into `container`. On success: remembers the guest and reloads into their personal view.
 * @param {HTMLElement} container @param {object} ctx @param {{heading?:string, intro?:string}} [opts]
 */
export function renderLookup(container, ctx, { heading = "Find your invitation", intro = "Type your name as it appears on your invitation and we will show you your events." } = {}) {
  const id = `lookup-${++uid}`;
  const bad = safe(() => sessionStorage.getItem(BADCODE_KEY)) === "1";
  // Name lookup is off unless site.nameLookup is true: a name is easy to know, and whoever finds a household can change
  // its RSVP. With it off, the personal link (an unguessable code) is the only way in, and the editor publishes no name index.
  if (!ctx?.content?.site?.nameLookup) {
    container.innerHTML = html`
      <div class="lookup" data-lookup-root data-link-only>
        <h2 class="lookup__title" id="${id}-h">${heading}</h2>
        ${bad ? html`<p class="lookup__notice" role="status" data-badcode>That link didn't work. Please check you copied all of it, or message us for a new one.</p>` : ""}
        <p class="lookup__intro">Please open the personal link we sent you on WhatsApp. It takes you straight to your invitation, your events and your RSVP.</p>
        <div class="lookup__msg" data-msg>${contactsHtml(ctx) ? html`<p>Can't find your link? Message us and we'll send it again.</p>${contactsHtml(ctx)}` : ""}</div>
      </div>`.toString();
    return;
  }
  container.innerHTML = html`
    <div class="lookup" data-lookup-root>
      <h2 class="lookup__title" id="${id}-h">${heading}</h2>
      ${bad ? html`<p class="lookup__notice" role="status" data-badcode>That link didn't work. Find your invitation below.</p>` : ""}
      <p class="lookup__intro">${intro}</p>
      <form class="lookup__form" novalidate aria-labelledby="${id}-h">
        <label class="lookup__label" for="${id}-name">Your full name</label>
        <input class="lookup__input" id="${id}-name" name="name" type="text" autocomplete="name" autocapitalize="words" spellcheck="false" required aria-describedby="${id}-msg" placeholder="e.g. Raj Sharma" />
        <div class="lookup__choices" data-choices hidden></div>
        <button class="btn btn--primary btn--block" type="submit" data-submit>Find my invitation</button>
      </form>
      <div class="lookup__msg" id="${id}-msg" aria-live="polite" data-msg></div>
    </div>`.toString();

  const form = container.querySelector("form");
  const input = form.querySelector("input[name=name]");
  const btn = form.querySelector("[data-submit]");
  const msg = container.querySelector("[data-msg]");
  const choicesBox = form.querySelector("[data-choices]");

  const setBusy = (b) => {
    btn.disabled = b;
    btn.setAttribute("aria-busy", String(b));
    btn.textContent = b ? "Finding your invitation…" : "Find my invitation";
  };
  const say = (text, { error = true } = {}) => {
    msg.className = "lookup__msg" + (error ? " is-error" : "");
    msg.textContent = text;
  };
  const go = (code) => {
    rememberGuest(code);
    safe(() => sessionStorage.removeItem(BADCODE_KEY));
    location.replace(location.pathname + "?i=" + encodeURIComponent(code) + "#home");
  };

  input.addEventListener("input", () => { choicesBox.hidden = true; choicesBox.innerHTML = ""; });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (btn.disabled) return;
    // Picking one of several households
    const picked = form.querySelector("input[name=household]:checked");
    if (!choicesBox.hidden && picked) return go(picked.value);

    const value = input.value.trim();
    if (!value) { say("Please type your name."); input.focus(); return; }
    msg.textContent = "";
    setBusy(true);
    let res = null;
    try {
      const { first, last } = splitName(value);
      res = await lookupByName(first, last);
    } catch { res = null; }
    setBusy(false);

    if (res && res.code) return go(res.code);
    if (res && res.choices) {
      choicesBox.hidden = false;
      choicesBox.innerHTML = html`<fieldset class="lookup__fieldset">
        <legend>More than one invitation matches. Which is yours?</legend>
        ${res.choices.map((c, i) => html`<label class="lookup__choice"><input type="radio" name="household" value="${c.code}" ${i === 0 ? "checked" : ""} /><span>${c.household}</span></label>`)}
      </fieldset>`.toString();
      btn.textContent = "Continue";
      say("");
      choicesBox.querySelector("input")?.focus();
      return;
    }
    say("We couldn't find that name. Try the spelling on your invitation, or message us.");
    const extra = contactsHtml(ctx);
    if (extra.toString()) msg.insertAdjacentHTML("beforeend", extra.toString());
    input.focus();
  });
}

export default renderLookup;
