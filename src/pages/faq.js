import { html, raw, esc, editAttrs, listAttrs, itemAttrs, multiline, isEdit } from "../lib/dom.js";
import { telUrl, whatsappUrl } from "../lib/maps.js";
import { copyText } from "../lib/ui.js";
import * as icon from "../lib/icons.js";

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* ---------- Search helpers (diacritic- and case-insensitive) ---------- */
const fold = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Fold a string and remember where every folded char came from in the original. */
function foldMap(s) {
  let out = "";
  const from = [], to = [];
  let i = 0;
  for (const ch of String(s)) {
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) { from.push(i); to.push(i + ch.length); }
    out += f;
    i += ch.length;
  }
  return { out, from, to };
}

/** Escape text, wrapping every case/diacritic-insensitive term match in <mark>. */
function highlight(text, terms) {
  text = String(text ?? "");
  if (!terms.length) return esc(text);
  const { out, from, to } = foldMap(text);
  const ranges = [];
  for (const t of terms) {
    let p = 0;
    while ((p = out.indexOf(t, p)) !== -1) {
      ranges.push([from[p], to[p + t.length - 1]]);
      p += t.length;
    }
  }
  if (!ranges.length) return esc(text);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  let res = "", pos = 0;
  for (const [a, b] of merged) {
    res += esc(text.slice(pos, a)) + "<mark>" + esc(text.slice(a, b)) + "</mark>";
    pos = b;
  }
  return res + esc(text.slice(pos));
}

/** Answer text -> safe HTML: escaped, URLs linked, matches marked, newlines to <br>. */
function answerHtml(text, terms) {
  text = String(text ?? "");
  const re = /https?:\/\/[^\s<>"]+/g;
  let res = "", pos = 0, m;
  while ((m = re.exec(text))) {
    let url = m[0];
    const trail = url.match(/[.,;:!?)\]]+$/);
    if (trail) url = url.slice(0, -trail[0].length);
    res += highlight(text.slice(pos, m.index), terms);
    res += `<a href="${esc(url)}" target="_blank" rel="noopener">${highlight(url, terms)}</a>`;
    pos = m.index + url.length;
    re.lastIndex = pos;
  }
  res += highlight(text.slice(pos), terms);
  return res.replace(/\r?\n/g, "<br>");
}

const termsOf = (q) => fold(q).split(/\s+/).filter(Boolean);

function contactsOf(ctx) {
  return (ctx.content.site?.contacts || []).filter((c) => c.phone);
}

function buildGroups(ctx, st) {
  const faq = ctx.content.faq || [];
  const cats = ctx.content.faqCategories || [];
  const known = new Set(cats.map((c) => c.id));
  const terms = termsOf(st.q);
  const hit = (f) => !terms.length || terms.every((t) => fold(f.q + " " + f.a).includes(t));
  const all = faq.map((f, i) => ({ f, i }));
  const groups = cats.map((c, ci) => ({ c, ci, items: all.filter((x) => x.f.category === c.id) }));
  const other = all.filter((x) => !known.has(x.f.category));
  if (other.length) groups.push({ c: { id: "other", title: "More questions" }, ci: -1, items: other });
  for (const g of groups) g.items = g.items.filter((x) => (st.cat === "all" || st.cat === g.c.id) && hit(x.f));
  return { groups: groups.filter((g) => g.items.length), terms };
}

function item({ f, i }, terms, open, edit) {
  const q = edit ? f.q : raw(highlight(f.q, terms));
  const a = edit ? multiline(f.a) : raw(answerHtml(f.a, terms));
  return html`
    <details class="faq-item" id="faq-${f.id}" data-id="${f.id}" ${itemAttrs("faq", i)}${open.has(f.id) ? raw(" open") : ""}>
      <summary><span class="faq-q" ${editAttrs("text", `faq.${i}.q`, { placeholder: "Add a question" })}>${q}</span>${icon.chevron()}</summary>
      <div class="faq-body"><div class="faq-answer">
        <p ${editAttrs("multiline", `faq.${i}.a`, { placeholder: "Write the answer" })}>${a}</p>
        <button type="button" class="btn btn--ghost btn--small faq-link" data-copy-link="${f.id}" aria-label="Copy link to this question">${icon.share()}Copy link</button>
      </div></div>
    </details>`;
}

function listHtml(ctx, st, edit) {
  const { groups, terms } = buildGroups(ctx, st);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const hasQuery = terms.length > 0;
  const wa = contactsOf(ctx).find((c) => c.whatsapp) || contactsOf(ctx)[0];
  const body = total
    ? html`${groups.map((g) => html`
      <section class="faq-group" aria-labelledby="faqcat-${g.c.id}">
        <h2 class="faq-cat" id="faqcat-${g.c.id}" ${g.ci >= 0 ? editAttrs("text", `faqCategories.${g.ci}.title`, { placeholder: "Category name" }) : ""}>${g.c.title}</h2>
        <div class="faq-list" ${listAttrs("faq")}>${g.items.map((x) => item(x, terms, st.open, edit))}</div>
      </section>`)}`
    : html`<div class="faq-empty card" >
        <p class="faq-empty-title">${hasQuery ? html`No answers match “${st.q.trim()}”` : "No questions here yet"}</p>
        <p class="muted">Try a different word, or ask us directly and we will get back to you.</p>
        <div class="cluster cluster--center">
          ${wa ? (wa.whatsapp
            ? html`<a class="btn btn--primary" href="${whatsappUrl(wa.phone, hasQuery ? `Hi! I have a question about the wedding: ${st.q.trim()}` : "Hi! I have a question about the wedding.")}" target="_blank" rel="noopener">${icon.whatsapp()}Ask us on WhatsApp</a>`
            : html`<a class="btn btn--primary" href="${telUrl(wa.phone)}">${icon.phone()}Call ${wa.name}</a>`) : ""}
          ${hasQuery || st.cat !== "all" ? html`<button type="button" class="btn btn--secondary" data-reset>Clear filters</button>` : ""}
        </div>
      </div>`;
  return { html: body, total, hasQuery };
}

function footerCard(ctx) {
  const cs = contactsOf(ctx);
  if (!cs.length) return "";
  return html`<aside class="faq-foot card" aria-labelledby="faq-foot-h">
    <h2 class="faq-foot-title" id="faq-foot-h">Didn't find your answer?</h2>
    <p class="muted">We are happy to help. Message a coordinator.</p>
    <ul class="faq-contacts">
      ${cs.map((c) => html`<li class="faq-contact">
        <div class="faq-contact-who"><strong>${c.name}</strong>${c.role ? html`<span class="muted">${c.role}</span>` : ""}</div>
        <div class="faq-contact-act">
          ${c.whatsapp ? html`<a class="btn btn--primary btn--small" href="${whatsappUrl(c.phone, "Hi! I have a question about the wedding.")}" target="_blank" rel="noopener" aria-label="WhatsApp ${c.name} (opens in a new tab)">${icon.whatsapp()}WhatsApp</a>` : ""}
          <a class="btn btn--secondary btn--small" href="${telUrl(c.phone)}" aria-label="Call ${c.name}">${icon.phone()}Call</a>
        </div>
      </li>`)}
    </ul>
  </aside>`;
}

/** Smooth open/close for <details>, skipped under reduced motion. */
function toggleAnimated(d) {
  const body = d.querySelector(".faq-body");
  const opening = !d.open;
  if (reduced() || !body || !body.animate) { d.open = opening; return; }
  body.getAnimations().forEach((a) => a.cancel());
  body.style.overflow = "hidden";
  const done = () => { body.style.overflow = ""; };
  if (opening) {
    d.open = true;
    const h = body.scrollHeight;
    body.animate([{ height: "0px", opacity: 0 }, { height: h + "px", opacity: 1 }], { duration: 260, easing: "cubic-bezier(0.3, 0.7, 0.2, 1)" }).finished.then(done, done);
  } else {
    const h = body.offsetHeight;
    body.animate([{ height: h + "px", opacity: 1 }, { height: "0px", opacity: 0 }], { duration: 220, easing: "cubic-bezier(0.3, 0.7, 0.2, 1)" })
      .finished.then(() => { d.open = false; done(); }, done);
  }
}

export default {
  id: "faq",
  navLabel: "Q&A",
  title: () => "Questions & Answers",
  isEmpty: (ctx) => !(ctx.content.faq || []).length,
  render(root, ctx) {
    const faq = ctx.content.faq || [];
    const cats = ctx.content.faqCategories || [];
    const known = new Set(cats.map((c) => c.id));
    const chips = cats.filter((c) => faq.some((f) => f.category === c.id));
    if (faq.some((f) => !known.has(f.category))) chips.push({ id: "other", title: "More questions" });
    const edit = ctx.mode === "edit" || isEdit();
    const prev = root._faq;
    const st = { q: prev?.q || "", cat: prev?.cat || "all", open: prev?.open || new Set() };
    if (st.cat !== "all" && !chips.some((c) => c.id === st.cat)) st.cat = "all";
    root._faq = { ctx, st, edit };

    root.innerHTML = html`
      <div class="section section--paper page-head">
        <div class="container container--narrow center stack">
          <h1 class="page-title">Questions &amp; Answers</h1>
          <p class="lede">Anything we missed? Search below, or message a coordinator.</p>
        </div>
      </div>
      <div class="section section--ivory faq-section">
        <div class="container container--narrow stack stack--l">
          <form class="faq-search" role="search" data-faq-form>
            <label class="visually-hidden" for="faq-q">Search questions</label>
            <span class="faq-search-icon">${icon.search()}</span>
            <input id="faq-q" class="faq-input" type="search" name="q" placeholder="Search questions" autocomplete="off" enterkeyhint="search" value="${st.q}">
            <button type="button" class="faq-clear" data-clear aria-label="Clear search" ${st.q ? "" : raw("hidden")}>${icon.x()}</button>
          </form>
          ${chips.length > 1 ? html`<div class="faq-chips" role="group" aria-label="Filter by category">
            <button type="button" class="chip" data-cat="all" aria-pressed="${String(st.cat === "all")}">All</button>
            ${chips.map((c) => html`<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${String(st.cat === c.id)}">${c.title}</button>`)}
          </div>` : ""}
          <p class="faq-count muted" role="status" aria-live="polite" data-count></p>
          <div class="faq-results stack stack--xl" data-results></div>
          ${footerCard(ctx)}
        </div>
      </div>`;

    const apply = () => {
      const { ctx, st, edit } = root._faq;
      const r = listHtml(ctx, st, edit);
      root.querySelector("[data-results]").innerHTML = r.html;
      const n = r.total;
      const noun = n === 1 ? "question" : "questions";
      root.querySelector("[data-count]").textContent = r.hasQuery ? `${n} ${noun} match${n === 1 ? "es" : ""}` : `${n} ${noun}`;
      root.querySelector("[data-clear]").hidden = !st.q;
      root.querySelectorAll("[data-cat]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.cat === st.cat)));
    };
    root._faqApply = apply;
    apply();

    if (root.dataset.bound) return;
    root.dataset.bound = "1";

    const input = () => root.querySelector("#faq-q");
    const setQuery = (v, focus) => {
      root._faq.st.q = v;
      const el = input();
      if (el && el.value !== v) el.value = v;
      root._faqApply();
      if (focus) el?.focus();
    };

    root.addEventListener("input", (e) => { if (e.target.id === "faq-q") setQuery(e.target.value); });
    root.addEventListener("submit", (e) => { if (e.target.matches("[data-faq-form]")) e.preventDefault(); });
    root.addEventListener("keydown", (e) => { if (e.key === "Escape" && e.target.id === "faq-q" && e.target.value) { e.preventDefault(); setQuery("", true); } });
    root.addEventListener("click", (e) => {
      const t = e.target;
      const summary = t.closest("summary");
      if (summary && !root._faq.edit) {
        e.preventDefault();
        toggleAnimated(summary.parentElement);
        return;
      }
      if (t.closest("[data-clear]")) return setQuery("", true);
      const cat = t.closest("[data-cat]");
      if (cat) { root._faq.st.cat = cat.dataset.cat; return root._faqApply(); }
      if (t.closest("[data-reset]")) { root._faq.st.cat = "all"; return setQuery("", true); }
      const link = t.closest("[data-copy-link]");
      if (link) copyText(`${location.origin}${location.pathname}#faq/${link.dataset.copyLink}`, "link");
    });
    // Keep the URL shareable and remember which items are open across filtering.
    root.addEventListener("toggle", (e) => {
      const d = e.target;
      if (!d.matches?.("details.faq-item")) return;
      const open = root._faq.st.open;
      if (d.open) { open.add(d.dataset.id); history.replaceState(null, "", `#faq/${d.dataset.id}`); }
      else open.delete(d.dataset.id);
    }, true);
    // Deep link #faq/<id>: open, scroll to and focus the question.
    root.addEventListener("subroute", (e) => {
      const id = e.detail.sub;
      const { ctx, st } = root._faq;
      if (!(ctx.content.faq || []).some((f) => f.id === id)) return;
      st.open.add(id);
      let el = root.querySelector(`#faq-${CSS.escape(id)}`);
      if (!el) { st.cat = "all"; st.q = ""; const inp = input(); if (inp) inp.value = ""; root._faqApply(); el = root.querySelector(`#faq-${CSS.escape(id)}`); }
      if (!el) return;
      el.open = true;
      root.querySelectorAll(".faq-item.is-linked").forEach((x) => x.classList.remove("is-linked"));
      el.classList.add("is-linked");
      const s = el.querySelector("summary");
      requestAnimationFrame(() => {
        el.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
        s?.focus({ preventScroll: true });
      });
    });
  },
};
