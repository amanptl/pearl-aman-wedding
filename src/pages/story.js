import { html, editAttrs, listAttrs, itemAttrs, imgTag, multiline, showField } from "../lib/dom.js";

function person(pe, i) {
  const p = (f) => `people.${i}.${f}`;
  return html`
    <li class="person card" ${itemAttrs("people", i)}>
      <div class="person-photo">${imgTag(pe.photo, { path: p("photo"), sizes: "(min-width: 768px) 16rem, 60vw" })}</div>
      <div class="person-body stack stack--s">
        <h3 class="display display--m" ${editAttrs("text", p("name"), { placeholder: "Add a name" })}>${pe.name || ""}</h3>
        ${showField(pe.role) || showField(pe.side) ? html`<p class="eyebrow person-meta">${showField(pe.role) ? html`<span ${editAttrs("text", p("role"), { placeholder: "Add a role" })}>${pe.role || ""}</span>` : ""}${showField(pe.role) && showField(pe.side) ? html`<span aria-hidden="true"> &middot; </span>` : ""}${showField(pe.side) ? html`<span ${editAttrs("text", p("side"), { placeholder: "Add a side" })}>${pe.side || ""}</span>` : ""}</p>` : ""}
        ${showField(pe.bio) ? html`<p ${editAttrs("multiline", p("bio"), { placeholder: "Add a short bio" })}>${multiline(pe.bio || "")}</p>` : ""}
      </div>
    </li>`;
}

export default {
  id: "story",
  navLabel: "Our Story",
  title: () => "Our Love Story",
  isEmpty: (ctx) => !(ctx.content.story?.paragraphs || []).length && !(ctx.content.people || []).length,
  render(root, ctx) {
    const s = ctx.content.story || {};
    const photos = s.photos || [];
    const paras = s.paragraphs || [];
    const people = ctx.content.people || [];
    root.innerHTML = html`
      <div class="section section--paper page-head">
        <div class="container story-grid ${photos.length ? "has-photos" : ""}">
          ${photos.length ? html`<div class="polaroids" ${listAttrs("story.photos")}>
            ${photos.map((ph, i) => html`<figure class="polaroid" ${itemAttrs("story.photos", i)}>${imgTag(ph, { path: `story.photos.${i}`, sizes: "(min-width: 768px) 24rem, 80vw" })}</figure>`)}
          </div>` : ""}
          <div class="story-text prose stack">
            <h1 class="page-title">Our Love Story</h1>
            <div class="stack" ${listAttrs("story.paragraphs")}>
              ${paras.map((p, i) => html`<p ${editAttrs("multiline", `story.paragraphs.${i}`, { placeholder: "Write a paragraph" })} data-index="${i}">${multiline(p)}</p>`)}
            </div>
          </div>
        </div>
      </div>
      ${people.length ? html`
        <div class="section section--ivory families">
          <div class="container stack stack--l">
            <h2 class="display display--l center">Meet the families</h2>
            <ul class="people" ${listAttrs("people")}>${people.map((pe, i) => person(pe, i))}</ul>
          </div>
        </div>` : ""}`;
  },
};
