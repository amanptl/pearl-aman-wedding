/**
 * The opening film. There is no separate intro scene: the camera starts close on the home board's own envelope
 * (sealed, flap closed, card and photo tucked inside), and the guest's tap plays one 3.5s shot:
 *   seal cracks → flap swings open in 3D → card rises out of the pocket → camera pulls back as the background comes
 *   into focus and the card turns upright and lands in its place → the board's tags and the site chrome fade in.
 * The last frame is the home page exactly as CSS lays it out, because every animation runs *from* a start state
 * *to* the element's own resting style, and finishing just cancels them all.
 *
 * Only transform, opacity, filter and clip-path are animated, on the board's real elements. While the film is up,
 * html[data-film="idle"|"play"] lets CSS hide what hasn't entered yet (see home.css, "Opening film").
 */

const T = 3500; // total shot length after the tap, ms
const EASE = {
  press: "cubic-bezier(.3,0,.2,1)",
  flap: "cubic-bezier(.45,0,.2,1)",
  rise: "cubic-bezier(.25,.6,.3,1)",
  camera: "cubic-bezier(.6,0,.2,1)",
  land: "cubic-bezier(.5,0,.12,1)",
  fade: "cubic-bezier(.3,0,.3,1)",
};

const num = (v, d = 1) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

/**
 * @param {HTMLElement} board  the home `.board`
 * @param {{ chrome?: HTMLElement[], vignette?: HTMLElement|null }} opts
 *   chrome: site header / tab bar / help button, faded in at the end. vignette: overlay layer faded out at the end.
 */
export function createFilm(board, { chrome = [], vignette = null } = {}) {
  const $ = (s) => board.querySelector(s);
  const env = $(".env"), card = $(".invite"), photo = $(".env-photo");
  const flap = $(".env-flap"), flapOut = $(".flap-out"), flapIn = $(".flap-in");
  const sealHi = $(".seal-hi"), sealLo = $(".seal-lo"), shade = $(".env-shade");
  const late = [$(".kindly"), $(".rsvp-word"), $(".tag-respond"), document.querySelector(".scroll-hint")].filter(Boolean);
  const root = document.documentElement;
  const anims = [];
  let camera = null, blur = null, state = "idle";

  const add = (el, keyframes, timing) => {
    if (!el) return null;
    const a = el.animate(keyframes, { fill: "both", ...timing });
    a.pause();
    anims.push(a);
    return a;
  };

  /* ---- Camera: the board is scaled about its top-left so the envelope fills the frame ---- */
  function cameraFrames() {
    const vw = innerWidth, vh = innerHeight;
    const b = board.getBoundingClientRect();
    const e = { x: env.offsetLeft, y: env.offsetTop, w: env.offsetWidth, h: env.offsetHeight };
    // Frame the envelope with headroom for the card when it rises out (its short side is ~0.57 of the envelope width).
    const target = Math.min(vw * 0.84, 600, (vh * 0.42) / 0.732);
    const z = Math.max(1, target / e.w);
    const envH = target * 0.732, rise = target * 0.571 + envH * 0.05;
    const vy = Math.min(vh * 0.62, Math.max(vh * 0.46, vh * 0.04 + rise + envH / 2));
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    const tx = vw / 2 - b.left - z * cx, ty = vy - b.top - z * cy;
    return [{ transform: `translate(${tx}px, ${ty}px) scale(${z})` }, { transform: "translate(0px, 0px) scale(1)" }];
  }
  function buildCamera() {
    board.style.transformOrigin = "0 0";
    if (camera) { camera.cancel(); anims.splice(anims.indexOf(camera), 1); }
    camera = add(board, cameraFrames(), { delay: 1450, duration: 1750, easing: EASE.camera });
  }

  root.dataset.film = "idle";
  buildCamera();
  // Background out of focus while we're close on the envelope (pseudo-element animation: skipped where unsupported).
  try {
    blur = add(board, [{ filter: "blur(7px) brightness(.82)" }, { filter: "blur(0px) brightness(1)" }], { delay: 1450, duration: 1750, easing: EASE.camera, pseudoElement: "::before" });
  } catch { blur = null; }
  try {
    const stage = board.parentElement;
    add(board, [{ "--film-fade": "40px" }, { "--film-fade": "0px" }], { delay: 1450, duration: 1750, easing: EASE.camera });
    if (stage?.classList.contains("stage")) add(stage, [{ filter: "blur(7px) brightness(.82)" }, { filter: "blur(0px) brightness(1)" }], { delay: 1450, duration: 1750, easing: EASE.camera, pseudoElement: "::before" });
  } catch { /* the felt stays as CSS sets it */ }

  // Seal: a small press, then it cracks; the top half leaves with the flap, the bottom half fades with the shot.
  add(sealHi, [{ transform: "none" }, { transform: "scale(.95)", offset: 0.35 }, { transform: "translate(0, -5%) rotate(-7deg)" }], { duration: 380, easing: EASE.press });
  add(sealLo, [{ transform: "none" }, { transform: "scale(.95)", offset: 0.35 }, { transform: "translate(2%, 4%) rotate(6deg)" }], { duration: 380, easing: EASE.press });
  add(sealLo, [{ opacity: 1 }, { opacity: 0 }], { delay: 1500, duration: 700, easing: EASE.fade, composite: "replace" });

  // Flap: swings up and over on its hinge; passes behind the photo at 90°. Its faces darken towards edge-on.
  // A 2D fold, so it stays sharp under the zoom (see home.css): its height follows cos(angle). The outside shows for
  // the first half, the liner for the second.
  const flapTiming = { delay: 260, duration: 900, easing: EASE.flap };
  const fold = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16, sy = Math.cos(Math.PI * t);
    if (i === 8) { // edge-on: swap faces and drop behind the photo
      fold.push({ transform: "scaleY(0.001)", zIndex: 5, offset: 0.5 });
      fold.push({ transform: "scaleY(-0.001)", zIndex: 1, offset: 0.505 });
    } else fold.push({ transform: `scaleY(${sy.toFixed(4)})`, zIndex: t < 0.5 ? 5 : 1, offset: t });
  }
  add(flap, fold, flapTiming);
  add(flapOut, [{ filter: "brightness(1)", opacity: 1 }, { filter: "brightness(.55)", opacity: 1, offset: 0.5 }, { filter: "brightness(.55)", opacity: 0, offset: 0.5 }, { filter: "brightness(.55)", opacity: 0 }], flapTiming);
  add(flapIn, [{ filter: "brightness(.45)", opacity: 0 }, { filter: "brightness(.45)", opacity: 0, offset: 0.5 }, { filter: "brightness(.45)", opacity: 1, offset: 0.5 }, { filter: "brightness(1)", opacity: 1 }], flapTiming);
  add(shade, [{ opacity: 0 }, { opacity: 0.85, offset: 0.4 }, { opacity: 0 }], flapTiming);

  // Photo: tucked in the pocket (clipped so it never shows below the envelope), slides up once the card is out.
  add(photo, [{ transform: "translateY(86%)", clipPath: "inset(0 0 86% 0)" }, { transform: "translateY(0%)", clipPath: "inset(0 0 0% 0)" }], { delay: 2250, duration: 950, easing: EASE.rise });

  // The board's own pieces and the site chrome enter last, in order.
  late.forEach((el, i) => add(el, [{ opacity: 0 }, { opacity: 1 }], { delay: 2850 + i * 110, duration: 450, easing: EASE.fade }));
  chrome.filter(Boolean).forEach((el) => add(el, [{ opacity: 0 }, { opacity: 1 }], { delay: 3000, duration: 500, easing: EASE.fade }));
  if (vignette) add(vignette, [{ opacity: 1 }, { opacity: 0 }], { delay: 2300, duration: 1100, easing: EASE.fade });

  /* ---- Card: lies sideways in the envelope (it's portrait, the envelope is landscape), rises, turns, lands ---- */
  function cardFrames() {
    // Read the card's resting scale/origin without the film's override (html[data-film] .invite in home.css).
    const mode = root.dataset.film;
    delete root.dataset.film;
    const cs = getComputedStyle(card);
    const s = cs.scale === "none" ? 1 : num(cs.scale.split(" ")[0]);
    const [ox, oy] = cs.transformOrigin.split(" ").map((v) => num(v, 0));
    root.dataset.film = mode;
    const L = card.offsetLeft, Tp = card.offsetTop, w = card.offsetWidth, h = card.offsetHeight;
    // Resting visual centre with the CSS `scale` about its own origin.
    const Ox = L + ox, Oy = Tp + oy, lcx = L + w / 2, lcy = Tp + h / 2;
    const C = { x: Ox + s * (lcx - Ox), y: Oy + s * (lcy - Oy) };
    // During the film the card is scaled about its centre with no CSS `scale` (html[data-film] in home.css),
    // so its transform is simply: move the centre, rotate, scale.
    const e = { x: env.offsetLeft, y: env.offsetTop, w: env.offsetWidth, h: env.offsetHeight };
    const k0 = (0.8 * e.w) / h; // long side = 80% of the envelope width
    const shortSide = k0 * w;
    const inside = { x: e.x + e.w / 2, y: e.y + e.h * 0.54 };
    const risen = { x: inside.x, y: e.y - shortSide / 2 - e.h * 0.05 };
    const f = (c, k, r) => `translate(${c.x - lcx}px, ${c.y - lcy}px) rotate(${r}deg) scale(${k})`;
    // Each leg has its own easing: the rise settles, hangs for a beat, then one long glide down into place.
    return [
      { transform: f(inside, k0, -90), zIndex: 3, easing: EASE.rise },
      { transform: f(risen, k0, -88), zIndex: 3, offset: 0.37 },
      { transform: f(risen, k0, -88), zIndex: 6, offset: 0.375, easing: EASE.land },
      { transform: f(C, s, 0), zIndex: 6 },
    ];
  }

  function onResize() { if (state === "idle") { buildCamera(); } }
  addEventListener("resize", onResize);

  function cleanup() {
    removeEventListener("resize", onResize);
    anims.forEach((a) => a.cancel());
    anims.length = 0;
    board.style.transformOrigin = "";
    delete root.dataset.film;
  }

  return {
    /** Plays the shot; resolves when the last frame (the home page) is reached. */
    play() {
      if (state !== "idle") return Promise.resolve();
      state = "play";
      root.dataset.film = "play";
      // Measure the card in its film layout (no CSS scale, centred origin) after the attribute switch.
      add(card, cardFrames(), { delay: 950, duration: 2250 });
      const t0 = document.timeline.currentTime;
      anims.forEach((a) => { a.startTime = t0; });
      return Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(() => { if (state === "play") { state = "done"; cleanup(); } });
    },
    /** Jump to the last frame (Skip, Escape, or leaving the page). */
    finish() { if (state === "done") return; state = "done"; cleanup(); },
    get state() { return state; },
    duration: T,
  };
}
