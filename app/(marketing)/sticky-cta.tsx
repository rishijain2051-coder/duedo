"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * A CTA bar that follows a phone down the page.
 *
 * On a desktop the nav is pinned and its button never leaves. On a phone the nav
 * collapses to a hamburger and the hero's buttons scroll away within one screen, so
 * from the ticker onward there is nothing to tap for the entire rest of the page.
 *
 * Two rules keep it from being an annoyance rather than a help:
 *
 *   * it stays hidden until the hero CTA is actually gone, so it never covers the
 *     buttons it is a substitute for and never appears before the page has said
 *     anything;
 *   * it hides again over the final CTA section, where the real buttons are twice the
 *     size and duplicating them would just cover them up.
 *
 * IntersectionObserver rather than a scroll listener: the browser does the work off the
 * main thread and there is no scroll handler competing with Lenis for frames.
 */
export default function StickyCta() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const heroCta = document.querySelector(".hero__cta");
    const finalCta = document.querySelector(".cta");
    if (!heroCta || !finalCta) return;

    // Tracked separately rather than as one predicate, because the two elements report
    // at different moments and a single boolean would flicker while both are crossing.
    let heroVisible = true;
    let finalVisible = false;
    const apply = () => setShown(!heroVisible && !finalVisible);

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === heroCta) heroVisible = entry.isIntersecting;
          if (entry.target === finalCta) finalVisible = entry.isIntersecting;
        }
        apply();
      },
      // A margin at the bottom so the bar is already gone by the time the final CTA is
      // properly on screen, rather than dissolving on top of it.
      { rootMargin: "0px 0px -25% 0px" },
    );

    observer.observe(heroCta);
    observer.observe(finalCta);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={`sticky-cta${shown ? " is-shown" : ""}`} aria-hidden={!shown}>
      <div className="sticky-cta__text">
        <strong>Start free</strong>
        <span>25 reminders a month, no card</span>
      </div>
      {/* tabIndex -1 while hidden, or a keyboard user tabs into a control that is
          translated off the bottom of the screen and appears to have vanished. */}
      <Link
        className="btn btn--sm"
        href="/dashboard"
        prefetch={false}
        tabIndex={shown ? 0 : -1}
      >
        <span>Open the app</span>
      </Link>
    </div>
  );
}
