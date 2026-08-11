/* ═══════════════════════════════════════════════════════════════
   DueDo — motion layer

   An ES module with its dependencies injected rather than read off `window`,
   so the same file drives the standalone site and a React client component
   with no changes:

     // standalone (index.html, over http — see serve.mjs)
     initDueDoMotion({ gsap, ScrollTrigger, Lenis });

     // Next.js
     useEffect(() => {
       let stop;
       (async () => {
         const [g, st, L, { initDueDoMotion }] = await Promise.all([
           import("gsap"), import("gsap/ScrollTrigger"),
           import("lenis"), import("./motion"),
         ]);
         g.gsap.registerPlugin(st.ScrollTrigger);
         stop = initDueDoMotion({ gsap: g.gsap, ScrollTrigger: st.ScrollTrigger, Lenis: L.default });
       })();
       return () => stop?.();
     }, []);

   It returns a teardown function, and that is not optional in React. Effects
   run twice under StrictMode in development, so without it you get two Lenis
   instances, twice the ScrollTriggers, and text split into words twice —
   which reads as randomly duplicated words on the page.

   Everything degrades. If the libraries are missing the page still reads,
   because the failure path makes every hidden element visible.
   ═══════════════════════════════════════════════════════════════ */

const GLYPH = "M143 392 V120 H233 a136 136 0 0 1 0 272 H143";

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/** @param {string} uid Gradient ids must be unique per instance, or the first
 *  copy on the page captures every later reference and the rest render flat. */
const markSVG = (uid) => `
<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="s${uid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#93c5fd"/>
      <stop offset="45%" stop-color="var(--brand)"/>
      <stop offset="100%" stop-color="#8b5cf6"/>
    </linearGradient>
    <linearGradient id="r${uid}" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="var(--brand)" stop-opacity=".15"/>
      <stop offset="60%" stop-color="var(--brand-soft)" stop-opacity=".9"/>
      <stop offset="100%" stop-color="#93c5fd"/>
    </linearGradient>
    <filter id="g${uid}" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="12" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <g class="orbit" fill="none" stroke="url(#r${uid})" stroke-linecap="round">
    <circle cx="233" cy="256" r="186" stroke-width="10" stroke-dasharray="4 22" opacity=".5"/>
    <path class="arc" d="M233 70 a186 186 0 0 1 0 372" stroke-width="16"/>
  </g>
  <g filter="url(#g${uid})">
    <path class="glyph" d="${GLYPH}" fill="none" stroke="url(#s${uid})"
          stroke-width="58" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <circle class="dot" cx="419" cy="256" r="19" fill="#e0edff"/>
</svg>`;

/**
 * @param {object} deps
 * @param {any} [deps.gsap]
 * @param {any} [deps.ScrollTrigger]
 * @param {any} [deps.Lenis]
 * @param {ParentNode} [deps.root] Scope, for a component that isn't the whole document.
 * @returns {() => void} teardown
 */
export function initDueDoMotion(deps = {}) {
  const gsap   = deps.gsap ?? globalThis.gsap;
  const ST     = deps.ScrollTrigger ?? globalThis.ScrollTrigger;
  const LenisC = deps.Lenis ?? globalThis.Lenis;
  const root   = deps.root ?? document;

  const hasGsap = !!gsap;
  const hasST   = !!(gsap && ST);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* The inline script in the layout hid the animated-in elements before first paint
     and armed a 3s timer to un-hide them if nothing claimed the job. This module
     running *is* that claim, so cancel it. If there is nothing to animate with, drop
     the hiding immediately instead. */
  clearTimeout(window.__ddAnimFailsafe);
  const unhide = () => document.documentElement.classList.remove("anim");
  if (!hasST || reduced) unhide();

  /* Everything registered here is undone by teardown(), in reverse. */
  const triggers = [];   // ScrollTrigger instances
  const tweens   = [];   // tweens and timelines
  const unbinds  = [];   // () => void for every listener
  const restores = [];   // () => void to put mutated DOM back
  let lenis = null;
  let torn  = false;

  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    unbinds.push(() => target.removeEventListener(type, fn, opts));
  };
  const track = (t) => { if (t) tweens.push(t); return t; };
  const trigger = (cfg) => { if (!hasST) return null; const t = ST.create(cfg); triggers.push(t); return t; };

  /** Snapshot innerHTML so a DOM-mutating effect can be reversed on teardown. */
  const snapshot = (el) => {
    if (!el) return;
    const html = el.innerHTML;
    restores.push(() => { el.innerHTML = html; });
  };

  /* ── the mark ─────────────────────────────────────────────── */
  let uid = 0;
  $$("#heroMark, #navMark, #footMark", root).forEach((slot) => {
    snapshot(slot);
    slot.innerHTML = markSVG(String(uid++));
  });

  /** Undo animateMark()'s zeroed start state. Clearing the dash array restores the
   *  full stroke, which is the same finished letter the reduced-motion path shows. */
  function showMarks() {
    $$(".glyph, .arc", root).forEach((p) => {
      p.style.strokeDasharray = "none";
      p.style.strokeDashoffset = "0";
    });
    $$(".dot", root).forEach((d) => { d.style.opacity = "1"; });
  }

  function animateMark(host, { loop = true, delay = 0 } = {}) {
    // staticSettled matters here: start() runs after the dead-ticker guard may
    // already have fired, and zeroing the dash offsets at that point hides the
    // letter behind a timeline that will never advance. Measured all four marks
    // at visibleFraction 0 — the brand mark, blank, in the nav, hero and footer.
    if (!hasGsap || reduced || staticSettled || !host) return null;
    const glyph = $(".glyph", host), arc = $(".arc", host), dot = $(".dot", host);
    if (!glyph) return null;

    const gLen = glyph.getTotalLength();
    const aLen = arc ? arc.getTotalLength() : 0;
    gsap.set(glyph, { strokeDasharray: gLen, strokeDashoffset: gLen });
    gsap.set(arc,   { strokeDasharray: aLen, strokeDashoffset: aLen });
    gsap.set(dot,   { opacity: 0 });

    const tl = gsap.timeline({ delay });
    tl.to(glyph, { strokeDashoffset: 0, duration: 1.1, ease: "power2.inOut" })
      .to(arc,   { strokeDashoffset: aLen * 0.24, duration: .9, ease: "power2.out" }, "-=.55")
      .to(dot,   { opacity: 1, duration: .3 }, "-=.4");

    if (loop && dot) {
      // Orbit the bowl's centre (233,256) at r=186, from the 3 o'clock dot.
      tl.to({ a: 0 }, {
        a: Math.PI * 2, duration: 7, ease: "none", repeat: -1,
        onUpdate() {
          const a = this.targets()[0].a;
          gsap.set(dot, { x: Math.cos(a) * 186 - 186, y: Math.sin(a) * 186 });
        },
      });
    }
    return track(tl);
  }

  /* ── splitting ────────────────────────────────────────────── */
  /**
   * Wraps each word of every descendant text node, leaving elements intact.
   *
   * In React this must run in an effect, never during render: it mutates the DOM
   * the server produced, so doing it any earlier is a hydration mismatch and React
   * throws away the subtree and re-renders it on the client.
   */
  function splitWords(el, cls) {
    if (!el) return [];
    snapshot(el);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (walker.currentNode.nodeValue.trim()) nodes.push(walker.currentNode);

    const out = [];
    nodes.forEach((node) => {
      const frag = document.createDocumentFragment();
      node.nodeValue.split(/(\s+)/).forEach((chunk) => {
        if (!chunk) return;
        if (!chunk.trim()) { frag.appendChild(document.createTextNode(chunk)); return; }
        const span = document.createElement("span");
        span.className = cls;
        span.textContent = chunk;
        frag.appendChild(span);
        out.push(span);
      });
      node.parentNode.replaceChild(frag, node);
    });
    return out;
  }

  /* The preloader is gone. It cost about 2.4 seconds before anything was readable —
     the one metric a landing page is judged on — and it fought streaming SSR, which
     exists to put text on screen as early as possible. It also carried a hazard that
     needed a 3-second timeout to contain: GSAP's ticker runs on requestAnimationFrame,
     which browsers do not fire in a hidden tab, so a page opened in a background tab
     sat on the splash with its timeline frozen at zero. Not needing the failsafe is
     better than having one. start() now runs unconditionally. */

  /* ── smooth scroll ────────────────────────────────────────── */

  /** Must match --nav-clearance in the CSS, which sets scroll-margin-top. */
  const NAV_CLEARANCE = 92;

  /** When Lenis's loop last ran. Zero means it has never ticked. */
  let lastRaf = 0;
  /** Lenis only scrolls while something is driving lenis.raf(). */
  const lenisIsRunning = () => lenis && lastRaf > 0 && performance.now() - lastRaf < 250;

  function initLenis() {
    if (!LenisC || reduced) return;
    lenis = new LenisC({ duration: 1.15, smoothWheel: true, wheelMultiplier: 1, touchMultiplier: 1.6 });

    if (hasST) {
      const sync = () => ST.update();
      lenis.on("scroll", sync);
      const tick = (t) => { lastRaf = performance.now(); lenis.raf(t * 1000); };
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
      unbinds.push(() => gsap.ticker.remove(tick));
    } else {
      let id;
      const raf = (t) => { lastRaf = performance.now(); lenis.raf(t); id = requestAnimationFrame(raf); };
      id = requestAnimationFrame(raf);
      unbinds.push(() => cancelAnimationFrame(id));
    }
  }

  /**
   * In-page links.
   *
   * `preventDefault()` is a one-way door, and that is what broke these. Handing off
   * to a smooth scroller that turns out not to be running leaves the link doing
   * nothing at all, with no error to find: Lenis animates inside `lenis.raf()`, so
   * whenever nothing drives that loop (a throttled or non-compositing tab, a ticker
   * that failed to register) `scrollTo` accepts the call and never moves the page.
   * `window.scrollTo({behavior:"smooth"})` is no safer, being animated by the same
   * compositor that just stopped.
   *
   * So the browser's own anchor jump is the floor. It needs nothing to be running,
   * and `scroll-margin-top` in the CSS is what makes it land below the fixed nav
   * instead of under it. This handler only takes over when Lenis can be shown to be
   * ticking, and even then a watchdog finishes the move instantly if the loop stalls
   * on the way. A navigation link is not allowed to be a no-op.
   */
  function initAnchors() {
    $$('a[href^="#"]', root).forEach((a) => {
      on(a, "click", (e) => {
        const id = a.getAttribute("href");
        if (!id || id === "#") return;
        const target = $(id, document);
        if (!target) return;

        closeMenu();
        if (!lenisIsRunning()) return; // native jump, with scroll-margin-top

        e.preventDefault();

        /* Cancelling the navigation also cancels the browser's move of the
           sequential focus navigation starting point, which is the entire job of
           "Skip to content": it would scroll, then send the next Tab back to the
           skip link instead of into the page. Moving focus by hand restores it.
           tabindex="-1" makes a non-interactive target focusable without adding it
           to the tab order, and programmatic focus on it draws no ring. */
        if (!target.hasAttribute("tabindex")) {
          target.setAttribute("tabindex", "-1");
          restores.push(() => target.removeAttribute("tabindex"));
        }
        target.focus({ preventScroll: true });

        const from = window.scrollY;
        const y = Math.max(0, target.getBoundingClientRect().top + from - NAV_CLEARANCE);
        lenis.scrollTo(y);

        setTimeout(() => {
          if (torn) return;
          if (Math.abs(window.scrollY - from) < 2 && Math.abs(from - y) > 4) {
            window.scrollTo(0, y); // instant: the one thing that cannot stall
          }
        }, 200);
      });
    });
  }

  /* ── mobile menu ────────────────────────────────────────────── */
  const nav = $("#nav", root);
  const navToggle = $("#navToggle", root);

  function closeMenu() {
    if (!nav || !navToggle || !nav.classList.contains("is-open")) return;
    nav.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "Open menu");
  }

  function initMenu() {
    if (!nav || !navToggle) return;
    on(navToggle, "click", () => {
      const open = nav.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", String(open));
      navToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });
    // Escape closes it, and focus goes back to the control that opened it.
    on(document, "keydown", (e) => {
      if (e.key === "Escape" && nav.classList.contains("is-open")) {
        closeMenu();
        navToggle.focus();
      }
    });
    // Widening past the breakpoint leaves the panel open but unstyled otherwise.
    on(window, "resize", () => { if (innerWidth > 980) closeMenu(); });
  }

  /* ── magnetic ────────────────────────────────────────────────
     No custom cursor: replacing the system pointer is hostile to anyone
     relying on its size, contrast or shape, and the usual implementation
     animates width/height/margin, which lays out the page on every hover.
     The magnetic lean survives because it moves the button, not the cursor,
     and it interpolates rather than tracking the pointer directly. */
  function initMagnetic() {
    if (!hasGsap || reduced || matchMedia("(hover: none)").matches) return;
    $$(".magnetic", root).forEach((el) => {
      const mx = gsap.quickTo(el, "x", { duration: .45, ease: "power3" });
      const my = gsap.quickTo(el, "y", { duration: .45, ease: "power3" });
      on(el, "mousemove", (e) => {
        const r = el.getBoundingClientRect();
        mx((e.clientX - (r.left + r.width / 2)) * .26);
        my((e.clientY - (r.top + r.height / 2)) * .4);
      });
      on(el, "mouseleave", () => { mx(0); my(0); });
    });
  }

  /* ── nav + progress ──────────────────────────────────────────
     Driven by ScrollTrigger rather than a scroll listener. A raw listener
     fires on every scroll frame with no batching, which is the classic
     source of scroll jank; ScrollTrigger already reads scroll once per
     frame for everything else on the page. */
  function initChrome() {
    const bar = $("#progress", root);
    if (!hasST) return;
    trigger({
      trigger: document.body, start: "top top", end: "bottom bottom", scrub: true,
      onUpdate: (self) => {
        if (bar) gsap.set(bar, { scaleX: self.progress });
        if (nav) nav.classList.toggle("is-stuck", self.scroll() > 40);
      },
    });
  }

  /* ── hero ─────────────────────────────────────────────────── */
  function initHero() {
    if (!hasGsap || reduced || staticSettled) return;
    const words = [];
    $$(".hero__title .split", root).forEach((s) => words.push(...splitWords(s, "w")));

    // Scoped node lists, not selector strings: GSAP and ScrollTrigger resolve
    // strings against the whole document, which would reach past `root` and pick
    // up a second instance's elements when this runs as a mounted component.
    // Arrays are used deliberately so a missing element is a no-op, not a warning.
    const serifEm  = $$(".hero__title em.serif", root);
    const heroSub  = $$(".hero__sub", root);
    const heroCta  = $$(".hero__cta", root);
    const notifs   = $$(".notif", root);
    const heroSect = $(".hero", root);
    const heroIn   = $(".hero__inner", root);

    // The page's one authored moment. Everything below the fold is a quiet
    // arrival by comparison, so this is where the budget goes.
    introTl = track(gsap.timeline({ delay: .15 })
      .from(words, { yPercent: 118, rotate: 4, duration: 1.05, stagger: .035, ease: "expo.out" })
      .from(serifEm, { opacity: 0, scale: .82, duration: .6, ease: "back.out(1.7)" }, "-=.7")
      // fromTo, not from: these carry a CSS start state now, and `.from()` reads the
      // element's current value as its destination, so it would animate 0 to 0.
      .fromTo(heroSub, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: .7 }, "-=.6")
      .fromTo(heroCta, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: .7 }, "-=.55")
      // Stagger stays inside 30-80ms; longer reads as the page still loading.
      .fromTo(notifs,
        { opacity: 0, y: 34, scale: .94 },
        { opacity: 1, y: 0, scale: 1, duration: .85, stagger: .07, ease: "expo.out" }, "-=.85"));

    // Idle drift, each card on its own phase so they never sync up. Only while
    // the cards actually float: below 1180px the notification sits in the flow
    // under the buttons, and drifting it there reads as a rendering fault.
    //
    // Re-evaluated on change rather than read once. The query was sampled at init
    // only, so narrowing the window past the breakpoint left the now-in-flow card
    // still drifting — and widening it never started the drift at all.
    const floatMq = matchMedia("(min-width: 1181px)");
    // Held here rather than in `tweens` so they can be replaced on every change
    // without having to splice them back out of a shared list.
    let drift = [];
    const killDrift = () => { drift.forEach((t) => t.kill()); drift = []; };
    const syncDrift = () => {
      const had = drift.length > 0;
      killDrift();
      if (!floatMq.matches) {
        // Only undo what the drift itself wrote. At init there is nothing to undo,
        // and clearing here would fight the intro timeline's own y on these cards.
        if (had) gsap.set(notifs, { clearProps: "x,y,rotate" });
        return;
      }
      drift = notifs.map((n, i) => gsap.to(n, {
        y: "random(-14, 14)", x: "random(-8, 8)", rotate: "random(-2, 2)",
        duration: 4 + i, repeat: -1, yoyo: true, ease: "sine.inOut", delay: i * .35,
      }));
    };
    syncDrift();
    on(floatMq, "change", syncDrift);
    unbinds.push(killDrift);

    if (!hasST) return;
    track(gsap.to(heroIn, {
      yPercent: 16, opacity: .25, ease: "none",
      scrollTrigger: { trigger: heroSect, start: "top top", end: "bottom top", scrub: true },
    }));
    $$("[data-parallax]", root).forEach((el) => {
      track(gsap.to(el, {
        yPercent: -parseFloat(el.dataset.parallax) * 100, ease: "none",
        scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true },
      }));
    });
  }

  /* ── reveals ─────────────────────────────────────────────── */
  function initReveals() {
    const items = $$(".reveal", root);
    // Nothing to reveal from if we cannot animate: the .anim class is already off.
    if (!hasST || reduced || staticSettled) return;
    items.forEach((el) => {
      track(gsap.to(el, {
        opacity: 1, y: 0, duration: .95, ease: "expo.out",
        scrollTrigger: { trigger: el, start: "top 88%" },
      }));
    });
  }

  /* ── ticker ──────────────────────────────────────────────── */
  function initTicker() {
    if (!hasGsap || reduced) return;
    $$(".ticker__row", root).forEach((row) => {
      const set = $(".ticker__set", row);
      if (!set) return;
      snapshot(row);
      const w = set.scrollWidth;
      // Enough copies to cover two viewports, so the seam is never on screen.
      const copies = Math.max(2, Math.ceil((innerWidth * 2) / w) + 1);
      for (let i = 1; i < copies; i++) row.appendChild(set.cloneNode(true));

      const dir = parseFloat(row.dataset.dir || "1");
      const tween = track(gsap.fromTo(row,
        { x: dir > 0 ? 0 : -w },
        { x: dir > 0 ? -w : 0, duration: w / 55, ease: "none", repeat: -1 }));

      // Reads faster while you scroll, which makes the strip feel physical.
      if (lenis) lenis.on("scroll", ({ velocity }) => {
        tween.timeScale(1 + Math.min(Math.abs(velocity) * .28, 7));
      });
    });
  }

  /* ── manifesto ───────────────────────────────────────────── */
  function initManifesto() {
    const el = $("#manifesto", root);
    if (!el) return;
    const words = splitWords(el, "w");
    // staticSettled included because the words do not exist until this runs: a
    // settle that happened earlier had nothing to light, so light them here.
    if (!hasST || reduced || staticSettled) { words.forEach((w) => w.classList.add("on")); return; }
    trigger({
      trigger: el, start: "top 78%", end: "bottom 55%", scrub: true,
      onUpdate: (self) => {
        const lit = Math.round(self.progress * words.length);
        words.forEach((w, i) => w.classList.toggle("on", i < lit));
      },
    });
  }

  /* ── alert ladder ────────────────────────────────────────── */
  function initLadder() {
    const steps = $$("[data-step]", root);
    if (!steps.length) return;
    if (!hasST || reduced || staticSettled) { steps.forEach((s) => s.classList.add("on")); return; }
    trigger({
      trigger: $("#ladderTrack", root), start: "top 82%", end: "bottom 60%", scrub: .4,
      onUpdate: (self) => {
        const lit = Math.round(self.progress * steps.length);
        steps.forEach((s, i) => s.classList.toggle("on", i < lit));
      },
    });
  }

  /* ── stacking cards ─────────────────────────────────────── */
  function initStack() {
    const cards = $$("[data-card]", root);
    if (!hasST || reduced || staticSettled || !cards.length) return;
    cards.forEach((card, i) => {
      if (i < cards.length - 1) {
        track(gsap.to(card, {
          scale: .93, yPercent: -4, filter: "brightness(.62)", ease: "none",
          scrollTrigger: { trigger: cards[i + 1], start: "top 78%", end: "top 22%", scrub: true },
        }));
      }
      track(gsap.from(card, {
        opacity: 0, y: 60, duration: .9, ease: "expo.out",
        scrollTrigger: { trigger: card, start: "top 92%" },
      }));
    });
  }

  /* ── escalation chain ───────────────────────────────────── */
  function initChain() {
    const nodes = $$("[data-node]", root), wire = $("#chainWire", root);
    if (!nodes.length) return;
    if (!hasST || reduced || staticSettled) {
      if (wire) wire.style.strokeDashoffset = 0;
      return; // the .anim gate is already off, so nodes are visible
    }
    const tl = gsap.timeline({ scrollTrigger: { trigger: $("#chain", root), start: "top 72%" } });
    if (wire) tl.to(wire, { strokeDashoffset: 0, duration: 1.5, ease: "power2.inOut" });
    tl.to(nodes, { opacity: 1, y: 0, duration: .8, stagger: .08, ease: "expo.out" }, "-=1.1");
    track(tl);
  }

  /* ── counters + bars ────────────────────────────────────── */
  function initNumbers() {
    $$(".count", root).forEach((el) => {
      const target = parseFloat(el.dataset.count || "0");
      const pre = el.dataset.prefix || "", suf = el.dataset.suffix || "";
      const paint = (v) => { el.textContent = pre + Math.round(v).toLocaleString("en-IN") + suf; };
      snapshot(el);
      // staticSettled, like the bars below: without it a settled page still builds
      // a tween that starts at zero, so a tab waking up later would blank the
      // figure and count it back up.
      if (!hasST || reduced || staticSettled) { paint(target); return; }
      const o = { v: 0 };
      track(gsap.to(o, {
        v: target, duration: 1.9, ease: "power2.out", onUpdate: () => paint(o.v),
        scrollTrigger: { trigger: el, start: "top 90%" },
      }));
    });

    // scaleX, never width: width is a layout property and animating it forces
    // layout plus paint on every frame. Transform skips both.
    const barsWrap = $("#bars", root);
    $$("[data-bar]", root).forEach((bar, i) => {
      const fill = $("i", bar), to = parseFloat(bar.dataset.bar) / 100;
      if (!fill) return;
      // Plain DOM, not gsap: this branch is reached precisely when GSAP is absent,
      // and `gsap.set?.()` still dereferences `gsap` before the optional call.
      if (!hasST || reduced || staticSettled) {
        fill.style.transform = `scaleX(${to})`;
        return;
      }
      track(gsap.to(fill, {
        scaleX: to, duration: 1.15, delay: i * .07, ease: "expo.out",
        scrollTrigger: { trigger: barsWrap, start: "top 86%" },
      }));
    });
  }

  /* ── pricing tilt ─────────────────────────────────────────────
     Interpolated, not bound straight to the pointer. Tying a decorative
     transform directly to mouse position has no momentum and reads as
     mechanical; quickTo gives it weight and settles it on release. */
  function initTilt() {
    if (!hasGsap || reduced || matchMedia("(hover: none)").matches) return;
    $$("[data-tilt]", root).forEach((card) => {
      gsap.set(card, { transformPerspective: 900 });
      const rx = gsap.quickTo(card, "rotationX", { duration: .5, ease: "power3" });
      const ry = gsap.quickTo(card, "rotationY", { duration: .5, ease: "power3" });
      on(card, "mousemove", (e) => {
        const r = card.getBoundingClientRect();
        ry(((e.clientX - r.left) / r.width - .5) * 11);
        rx(-((e.clientY - r.top) / r.height - .5) * 11);
      });
      on(card, "mouseleave", () => { rx(0); ry(0); });
    });
  }

  /* ── CTA wordmark ───────────────────────────────────────── */
  function initCta() {
    const word = $("#ctaWord", root);
    if (!word || !hasST || reduced || staticSettled) return;
    track(gsap.from(word, {
      scale: .78, yPercent: 12, opacity: 0, ease: "none",
      scrollTrigger: { trigger: $(".cta", root), start: "top 92%", end: "center 62%", scrub: true },
    }));
  }

  /* ── FAQ: one open at a time ───────────────────────────── */
  /**
   * One open at a time.
   *
   * Setting `o.open = false` fires `toggle` on that element too, so closing the
   * other five re-entered this handler five times and each one called
   * ScrollTrigger.refresh(), which recomputes every trigger on the page. The flag
   * makes the cascade silent and leaves exactly one refresh per real interaction.
   */
  function initFaq() {
    const all = $$(".qa", root);
    let cascading = false;

    // `toggle` is dispatched asynchronously, so a synchronous flag cannot catch the
    // events the cascade queues: measured two refreshes per open with the flag
    // alone. A trailing debounce collapses the whole burst into one refresh instead,
    // whenever the events happen to land.
    let queued = null;
    const queueRefresh = () => {
      if (!hasST) return;
      clearTimeout(queued);
      queued = setTimeout(() => { if (!torn) ST.refresh(); }, 60);
    };
    unbinds.push(() => clearTimeout(queued));

    all.forEach((qa) => {
      on(qa, "toggle", () => {
        if (!cascading && qa.open) {
          cascading = true;
          all.forEach((o) => { if (o !== qa) o.open = false; });
          cascading = false;
        }
        queueRefresh();
      });
    });
  }

  /* ── static settle ────────────────────────────────────────────
     Every finished state, applied at once with no animation.
     Two callers: reduced motion, and the watchdog below. */
  let introTl = null;
  /** Set once the static path has been taken; the animated inits then stand down. */
  let staticSettled = false;

  function settleStatic() {
    if (torn) return;
    staticSettled = true;
    const set = (els, vars) => { if (hasGsap) gsap.set(els, vars); };

    unhide(); // stop the CSS start states from hiding anything

    if (introTl && introTl.progress() === 0) introTl.progress(1);
    showMarks();
    set($$(".reveal", root), { opacity: 1, y: 0 });
    set($$("[data-node]", root), { opacity: 1, y: 0 });
    set($(".hero__inner", root), { opacity: 1, y: 0 });
    // These are hidden by .from()'s immediateRender rather than by CSS, so the
    // .anim class coming off does not bring them back.
    set($$("[data-card]", root), { opacity: 1, y: 0, scale: 1, filter: "none" });
    set($$("#ctaWord", root), { opacity: 1, scale: 1, yPercent: 0 });

    const wire = $("#chainWire", root);
    if (wire) wire.style.strokeDashoffset = 0;

    $$("[data-step]", root).forEach((s) => s.classList.add("on"));
    $$("#manifesto .w", root).forEach((w) => w.classList.add("on"));

    $$("[data-bar]", root).forEach((bar) => {
      const fill = $("i", bar);
      if (fill) fill.style.transform = `scaleX(${parseFloat(bar.dataset.bar) / 100})`;
    });
    $$(".count", root).forEach((el) => {
      const v = parseFloat(el.dataset.count || "0");
      el.textContent = (el.dataset.prefix || "") +
        Math.round(v).toLocaleString("en-IN") + (el.dataset.suffix || "");
    });
  }

  /**
   * The blank-page guard.
   *
   * Everything here hides content and animates it back, so if GSAP's ticker never
   * advances the page stays hidden with no error to find. That is not theoretical:
   * measured `gsap.ticker.frame === 0` in a tab that was not compositing, with all
   * 21 reveals stuck at zero. rAF does not run in a hidden, throttled or
   * non-compositing tab, and `.from()` has already rendered its zeroed start state
   * by then.
   *
   * So: check once whether the ticker ever moved, and if it did not, abandon the
   * animated path and show the finished page.
   *
   * Armed as soon as this module runs rather than at the end of start(). A live
   * ticker advances within one frame, so a short window is enough to tell the two
   * apart, and nothing here fires while frames are being produced.
   */
  function guardAgainstDeadTicker() {
    const frameAtStart = hasGsap ? gsap.ticker.frame : 0;
    const id = setTimeout(() => {
      if (torn || staticSettled) return;
      if (!hasGsap || gsap.ticker.frame === frameAtStart) {
        console.warn("[duedo] animation ticker never advanced; showing the static page");
        settleStatic();
      }
    }, 1200);
    unbinds.push(() => clearTimeout(id));
  }

  /* ── go ─────────────────────────────────────────────────── */
  let started = false;
  function start() {
    if (started || torn) return;
    started = true;

    initLenis(); initMenu(); initAnchors(); initMagnetic(); initChrome();
    initReveals(); initTicker(); initManifesto(); initLadder();
    initStack(); initChain(); initNumbers(); initTilt(); initCta(); initFaq();

    animateMark($("#heroMark", root), { delay: .2 });
    animateMark($("#navMark", root),  { delay: .5 });
    animateMark($("#footMark", root), { loop: false });

    initHero();
    if (hasST) ST.refresh();

    // The guard can fire before start(), so it cannot settle what start() had not
    // built yet: the feature cards, the CTA wordmark and the manifesto words were
    // all left at zero that way. Settling once more here covers whatever this pass
    // created, and is idempotent.
    if (reduced || staticSettled) settleStatic();
  }

  const onLoad = () => { if (hasST && !torn) ST.refresh(); };
  on(window, "load", onLoad);

  if (!reduced) guardAgainstDeadTicker();

  // Unconditional, and synchronous. There is nothing left to wait for now the
  // preloader is gone, and the entrance should begin on the frame the module lands.
  try {
    start();
  } catch (err) {
    console.error("[duedo] motion failed, falling back to static:", err);
    unhide();
    settleStatic();
  }

  /* ── teardown ───────────────────────────────────────────── */
  return function destroy() {
    if (torn) return;
    torn = true;
    closeMenu();
    triggers.forEach((t) => t.kill());
    tweens.forEach((t) => t.kill());
    unbinds.forEach((fn) => fn());
    if (lenis) lenis.destroy();
    // Last, and in reverse: undo the DOM edits so a remount re-splits clean text
    // rather than splitting already-split spans.
    restores.reverse().forEach((fn) => fn());
    unhide(); // a remount re-adds it via its own pre-paint script
  };
}

/* Standalone convenience: index.html calls this after the CDN tags load. */
export default initDueDoMotion;
