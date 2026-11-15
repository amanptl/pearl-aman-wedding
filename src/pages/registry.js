import { html, editAttrs, listAttrs, itemAttrs, imgTag, multiline } from "../lib/dom.js";
import * as icon from "../lib/icons.js";

export default {
  id: "registry",
  navLabel: "Registry",
  title: () => "Gift Registry",
  isEmpty: (ctx) => {
    const r = ctx.content.registry || {};
    return !(r.paragraphs || []).length && !(r.links || []).length;
  },
  render(root, ctx) {
    const r = ctx.content.registry || {};
    const links = r.links || [];
    const paras = r.paragraphs || [];
    root.innerHTML = html`
      <div class="section section--photo registry-band">
        <div class="registry-bg">${imgTag(r.photo, { path: "registry.photo", sizes: "100vw" })}</div>
        <div class="container container--text center stack page-head">
          <h1 class="page-title">Gift Registry</h1>
          <div class="stack" ${listAttrs("registry.paragraphs")}>
            ${paras.map((p, i) => html`<p class="lede" ${editAttrs("multiline", `registry.paragraphs.${i}`, { placeholder: "Write a paragraph" })} data-index="${i}">${multiline(p)}</p>`)}
          </div>
          ${links.length ? html`<div class="registry-links" ${listAttrs("registry.links")}>
            ${links.map((l, i) => html`<a class="btn btn--light registry-link" href="${l.url}" target="_blank" rel="noopener" ${itemAttrs("registry.links", i)}>${icon.gift()}<span ${editAttrs("text", `registry.links.${i}.label`, { placeholder: "Link label" })}>${l.label}</span>${icon.external()}<span class="visually-hidden">(opens in a new tab)</span></a>`)}
          </div>` : ""}
        </div>
      </div>`;
  },
};
