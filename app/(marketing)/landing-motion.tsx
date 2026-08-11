"use client";

import { useEffect } from "react";

/**
 * Mounts the landing page's motion layer.
 *
 * Renders nothing. The markup above it stays a server component — only the motion
 * needs to be a client one, and it finds what it animates by id, class and data
 * attribute rather than by prop.
 *
 * GSAP, ScrollTrigger and Lenis are imported here and nowhere else. Together they are
 * roughly 75 KB gzipped, and the dynamic import is what keeps them out of the initial
 * document: the page is readable before any of it arrives, and if none of it ever
 * arrives the page is still readable, because lib/landing-motion.js reveals everything
 * it would otherwise have animated.
 */
export default function LandingMotion() {
  useEffect(() => {
    let destroy: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const [{ gsap }, { ScrollTrigger }, { default: Lenis }, { initDueDoMotion }] =
          await Promise.all([
            import("gsap"),
            import("gsap/ScrollTrigger"),
            import("lenis"),
            import("@/lib/landing-motion"),
          ]);
        // The imports resolve asynchronously, so on a fast unmount — Fast Refresh, or
        // StrictMode's double effect in development — the cleanup below has already
        // run by the time we get here. Without this check it would start a motion
        // layer that nothing is left holding a teardown for: two Lenis instances,
        // twice the ScrollTriggers, and every headline split into words twice, which
        // renders as "Everything Everything you you owe owe".
        if (cancelled) return;
        gsap.registerPlugin(ScrollTrigger);
        destroy = initDueDoMotion({ gsap, ScrollTrigger, Lenis });
      } catch (err) {
        // Never fatal. The static page is the fallback and it is a complete one.
        console.error("[duedo] motion layer failed to load:", err);
        document.documentElement.classList.remove("anim");
      }
    })();

    return () => {
      cancelled = true;
      destroy?.();
    };
  }, []);

  return null;
}
