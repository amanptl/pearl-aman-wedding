(function () {
  const W = window.WEDDING;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const get = (path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), W);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  $$("[data-bind]").forEach((el) => { el.textContent = get(el.dataset.bind) ?? ""; });

  // ---------- Home ----------
  $("#home-photo").src = W.homePhoto;
  $("#inv-venue").innerHTML = W.venue.lines.map(esc).join("<br />");

  // ---------- Details ----------
  $("#cards").innerHTML = W.cards.map((c) => `
    <article>
      <img src="${esc(c.icon)}" alt="" loading="lazy" />
      <h3>${esc(c.title)}</h3>
      <p>${esc(c.text)}</p>
      ${c.link ? `<a class="pill" href="${esc(c.link.url)}" target="_blank" rel="noopener">${esc(c.link.label)}</a>` : ""}
    </article>`).join("");

  $("#schedule").innerHTML = W.schedule.map((s) => `<tr><td>${esc(s.time)}</td><td>${esc(s.title)}</td></tr>`).join("");

  $("#hotels").innerHTML = W.accommodation.map((h) => `
    <div class="hotel">
      <h3>${esc(h.name)}</h3>
      <p>${esc(h.text)}</p>
      <a class="pill" href="${esc(h.url)}" target="_blank" rel="noopener">View address</a>
    </div>`).join("");

  $("#registry").style.setProperty("--photo", `url("${W.registry.photo}")`);
  $("#registry-text").innerHTML = W.registry.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("");
  $("#registry-link").href = W.registry.url;

  $("#dress-text").textContent = W.dressCode.text;
  $("#swatches").innerHTML = W.dressCode.swatches.map((c) => `<span style="background:${esc(c)}"></span>`).join("");
  $("#dress-notes").innerHTML = W.dressCode.notes.map((n) => `<p class="dress-note"><b>${esc(n.who)}:</b>${esc(n.text)}</p>`).join("");

  const polaroids = (photos) => photos.map((src) => `<figure class="polaroid"><img src="${esc(src)}" alt="" loading="lazy" /></figure>`).join("");
  $("#teaser").style.setProperty("--photo", `url("${W.story.teaserBackground}")`);
  $("#teaser-text").textContent = W.story.teaser;
  $("#teaser-photos").innerHTML = polaroids(W.story.photos);

  $("#faq").innerHTML = W.faq.map((f, i) => `
    <div class="faq-item">
      <h3>${String(i + 1).padStart(2, "0")}- ${esc(f.q)}</h3>
      <p>${esc(f.a)}</p>
    </div>`).join("");

  // ---------- Story ----------
  $("#story-photos").innerHTML = polaroids(W.story.photos);
  $("#story-text").innerHTML = W.story.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("");

  // ---------- Countdown ----------
  const target = new Date(W.date).getTime();
  const cd = $("#countdown");
  function tick() {
    const diff = target - Date.now();
    if (diff <= 0) {
      cd.innerHTML = '<p class="signature">Just married!</p>';
      return;
    }
    const units = [
      ["Days", Math.floor(diff / 864e5)],
      ["Hours", Math.floor(diff / 36e5) % 24],
      ["Minutes", Math.floor(diff / 6e4) % 60],
      ["Seconds", Math.floor(diff / 1e3) % 60],
    ];
    cd.innerHTML = units
      .map(([l, v]) => `<div class="unit"><b>${String(v).padStart(2, "0")}</b><small>${l}</small></div>`)
      .join('<span class="sep">:</span>');
    setTimeout(tick, 1000);
  }
  tick();

  // ---------- Router ----------
  const pages = ["home", "details", "story", "rsvp"];
  const head = $("#inner-head");

  function route() {
    const name = pages.includes(location.hash.slice(1)) ? location.hash.slice(1) : "home";
    $$(".page").forEach((p) => p.classList.toggle("active", p.id === "page-" + name));
    $$(".nav a[data-page]").forEach((a) => a.classList.toggle("active", a.dataset.page === name));
    head.hidden = name === "home";
    window.scrollTo({ top: 0 });
  }
  window.addEventListener("hashchange", route);

  // ---------- Intro ----------
  const intro = $("#intro");
  const app = $("#app");

  function showApp() {
    app.hidden = false;
    document.body.classList.remove("locked");
    route();
  }

  function openIntro() {
    if (intro.classList.contains("opening")) return;
    intro.classList.add("opening");
    sessionStorage.setItem("opened", "1");
    setTimeout(() => {
      if (location.hash && location.hash !== "#home") history.replaceState(null, "", "#home");
      showApp();
      intro.classList.add("gone");
      setTimeout(() => intro.remove(), 900);
    }, 1100);
  }

  if (sessionStorage.getItem("opened")) {
    intro.remove();
    showApp();
  } else {
    document.body.classList.add("locked");
    intro.addEventListener("click", openIntro);
    intro.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openIntro(); }
    });
    intro.focus();
  }

  // ---------- RSVP ----------
  const form = $("#rsvp-form");
  const status = $("#form-status");
  $("#rsvp-intro").innerHTML = W.rsvp.intro.map((p) => `<p>${esc(p)}</p>`).join("");
  $("#rsvp-deadline").textContent = W.rsvp.deadline;
  $("#meal-select").innerHTML = W.rsvp.mealOptions.map((m) => `<option>${esc(m)}</option>`).join("");

  form.addEventListener("change", (e) => {
    if (e.target.name === "attending") {
      form.classList.toggle("declining", e.target.value.startsWith("Regretfully"));
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.className = "form-status";
    if (!form.checkValidity()) {
      status.textContent = "Please fill in your name, email and whether you'll attend.";
      status.classList.add("error");
      form.reportValidity();
      return;
    }

    const data = new FormData(form);
    if (form.classList.contains("declining")) ["guests", "meal", "dietary", "song"].forEach((k) => data.delete(k));
    data.append("submittedAt", new Date().toISOString());

    const button = form.querySelector("button");
    button.disabled = true;
    status.textContent = "Sending…";

    try {
      if (W.rsvpEndpoint) {
        // Apps Script doesn't send CORS headers on its redirect, so the response is opaque.
        await fetch(W.rsvpEndpoint, { method: "POST", mode: "no-cors", body: new URLSearchParams(data) });
      } else {
        console.info("RSVP demo mode (no rsvpEndpoint set):", Object.fromEntries(data));
        await new Promise((r) => setTimeout(r, 600));
      }
      const yes = data.get("attending").startsWith("Joyfully");
      form.innerHTML = `
        <div class="thanks">
          <h3>Thank you</h3>
          <p>${yes ? "We can't wait to celebrate with you!" : "You'll be missed — thank you for letting us know."}</p>
        </div>`;
    } catch (err) {
      status.textContent = "Something went wrong. Please try again, or contact us directly.";
      status.classList.add("error");
      button.disabled = false;
    }
  });
})();
