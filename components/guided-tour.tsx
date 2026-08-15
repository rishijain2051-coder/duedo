"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/components/app-context";
import { planSpec } from "@/lib/plan";
import { stepsFor, tourById, tourForPath } from "@/lib/tours";

/**
 * The guided tours: a spotlight on a real control, and a bubble beside it.
 *
 * Three decisions here are load-bearing.
 *
 * **The dim layer is four rectangles, not one sheet with a hole cut in it.** A single
 * overlay with a `clip-path` still swallows the click, so the highlighted button would
 * be lit up and dead — and "press this" is the one instruction a tutorial must not
 * lie about. Four rects around the target leave the target itself untouched by
 * anything, so it behaves exactly as it does when no tour is running.
 *
 * **The geometry is re-read every frame rather than on scroll and resize.** This app's
 * scroll container is a div, not the document (see AppFrame), so a window scroll
 * listener never fires for the page content — the ring would sit still while the page
 * moved under it. A requestAnimationFrame loop catches that, and the modal opening,
 * and a font loading, and every other thing that moves an element without telling
 * anybody. It runs only while a tour is open.
 *
 * **A missing anchor skips its step.** Pages fetch, lists come back empty, and a plan
 * hides whole cards. Each anchor is polled briefly and then given up on, because a
 * tour that stalls on a control that isn't there is worse than one that is a step
 * shorter than it meant to be.
 */

/** Survives a reload so a tour is not lost to an accidental refresh mid-step. */
const SESSION_KEY = "duedo:tour";

const BUBBLE_W = 340;
/** Breathing room between the ring and the bubble, and off the viewport edges. */
const GAP = 12;
const MARGIN = 12;
/** How far the ring stands off the element it is drawn around. */
const PAD = 6;

interface TourApi {
  /** Starts a tour by id, navigating to its page first if need be. */
  start: (id: string) => void;
  stop: () => void;
  /** The running tour's id, or null. */
  running: string | null;
}

const Ctx = createContext<TourApi | null>(null);

export function useGuidedTour(): TourApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useGuidedTour must be used within <GuidedTourProvider>");
  return ctx;
}

/** Whether this page has a tour at all — the header's help button asks. */
export function useTourForCurrentPage() {
  const pathname = usePathname();
  return tourForPath(pathname);
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Puts the anchor in the middle of the screen, and then checks that it got there.
 *
 * `behavior: "smooth"` is a request rather than a guarantee. A tab that is not being
 * composited ignores it outright — no scrolling happens at all — and a scroll already
 * in flight can cancel it. Left unchecked, that is a spotlight drawn around something
 * nobody can see, on a screen dimmed everywhere else, with no way to tell what went
 * wrong. So the smooth attempt is made, and 400ms later, if the element is still off
 * the screen entirely, it is put there instantly.
 *
 * Somebody who has asked for reduced motion skips straight to the instant one: a tour
 * is seven or eight of these in a row, and that is a lot of scrolling to be thrown at
 * a person who has said they would rather not have any.
 *
 * "Off the screen entirely" rather than "fully visible", because an element taller
 * than the viewport can never be the latter and would scroll forever chasing it.
 *
 * `moved` is called after each scroll. Scrolling changes where the element is, and
 * something has to re-read that or the ring stays where the element used to be — a
 * lag the frame loop hides on a tab that is being drawn, and does not hide at all on
 * one that isn't. Telling it directly is both cheaper and true everywhere.
 */
function bringIntoView(el: HTMLElement, moved: () => void) {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
  moved();
  if (reduced) return;
  window.setTimeout(() => {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) {
      el.scrollIntoView({ block: "center", behavior: "auto" });
    }
    moved();
  }, 400);
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
const sameBox = (a: Box | null, b: Box | null) =>
  a === b ||
  Boolean(
    a &&
      b &&
      near(a.top, b.top) &&
      near(a.left, b.left) &&
      near(a.width, b.width) &&
      near(a.height, b.height),
  );

export function GuidedTourProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { settings, families } = useApp();

  const [tourId, setTourId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [anchorDisabled, setAnchorDisabled] = useState(false);
  const [viewport, setViewport] = useState({ w: 1024, h: 768 });
  const [bubbleH, setBubbleH] = useState(200);

  /**
   * The page a start() is still travelling to.
   *
   * Without it the "user navigated away, so stop" rule below fires on the tour's own
   * navigation — setTourId lands a render before the new pathname does, so a tour
   * started from Settings would stop itself on the way to the page it was going to.
   */
  const travellingTo = useRef<string | null>(null);

  const tour = tourById(tourId);
  const plan = planSpec(settings?.plan);
  const steps = useMemo(
    () =>
      tour
        ? stepsFor(tour, {
            // Membership, not the declared account type — see TourContext.
            family: families.length > 0,
            spending: plan.limits.spending,
            voice: plan.limits.voice,
          })
        : [],
    [tour, families.length, plan],
  );
  const step = steps[index] ?? null;
  const last = index >= steps.length - 1;

  const stop = useCallback(() => {
    setTourId(null);
    setIndex(0);
    setAnchorEl(null);
    travellingTo.current = null;
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* nothing to clear */
    }
  }, []);

  const start = useCallback(
    (id: string) => {
      const t = tourById(id);
      if (!t) return;
      setTourId(id);
      setIndex(0);
      setAnchorEl(null);
      setBox(null);
      if (pathname !== t.path) {
        travellingTo.current = t.path;
        router.push(t.path);
      }
    },
    [pathname, router],
  );

  /** Next step, or the end. Also how a missing anchor is dealt with. */
  const advance = useCallback(() => {
    setAnchorEl(null);
    setBox(null);
    setIndex((n) => n + 1);
  }, []);

  // Past the end: either hand over to the next tour or finish.
  useEffect(() => {
    if (!tour) return;
    if (index < steps.length) return;
    stop();
  }, [tour, index, steps.length, stop]);

  // Restore a tour that a reload interrupted.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { tourId?: string; index?: number };
      if (saved.tourId && tourById(saved.tourId)) {
        setTourId(saved.tourId);
        setIndex(typeof saved.index === "number" ? saved.index : 0);
      }
    } catch {
      /* nothing worth recovering */
    }
  }, []);

  useEffect(() => {
    try {
      if (tourId) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ tourId, index }));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* private mode: the tour simply won't survive a reload */
    }
  }, [tourId, index]);

  /**
   * Leaving the page ends the tour.
   *
   * The alternative — dragging somebody back to the page the tour is about — treats a
   * deliberate navigation as a mistake. They pressed a link; the tour is what should
   * give way.
   */
  useEffect(() => {
    if (!tour) return;
    if (travellingTo.current) {
      if (pathname === travellingTo.current) travellingTo.current = null;
      return;
    }
    if (pathname !== tour.path) stop();
  }, [pathname, tour, stop]);

  // Escape gets out of anything.
  useEffect(() => {
    if (!tour) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tour, stop]);

  /**
   * Reads where the anchor currently is. Called from three places, because no one of
   * them is enough on its own — see the callers.
   */
  const measure = useCallback((el: HTMLElement | null) => {
    setViewport((v) =>
      v.w === window.innerWidth && v.h === window.innerHeight
        ? v
        : { w: window.innerWidth, h: window.innerHeight },
    );
    if (!el) return;
    const r = el.getBoundingClientRect();
    const next = { top: r.top, left: r.left, width: r.width, height: r.height };
    setBox((prev) => (sameBox(prev, next) ? prev : next));
    const off =
      Boolean((el as HTMLButtonElement).disabled) ||
      el.getAttribute("aria-disabled") === "true";
    setAnchorDisabled((prev) => (prev === off ? prev : off));
  }, []);

  /** Find this step's anchor, waiting a moment for a page that is still fetching. */
  useEffect(() => {
    setAnchorEl(null);
    setBox(null);
    if (!step?.anchor) return;
    let cancelled = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const find = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(
        `[data-tour="${CSS.escape(step.anchor as string)}"]`,
      );
      // Present but occupying nothing counts as absent, and this is not a
      // hypothetical: the Mine/family switch is built from the list of families you
      // are in, so on an account that has joined none the wrapper is a real element
      // nought pixels tall. Ringing it draws a 12px sliver around empty space and
      // says something confident about a control that is not on the screen. Keeps
      // polling rather than giving up at once, because a card that is still fetching
      // also measures zero for a moment.
      const rect = el?.getBoundingClientRect();
      if (el && rect && rect.width > 0 && rect.height > 0) {
        setAnchorEl(el);
        // Measured here and now, not left to the frame loop below. A tab in the
        // background has its render step suspended, so requestAnimationFrame never
        // fires there — and a tour whose first frame never came would sit invisible
        // behind a dimmed screen, which is the worst of both.
        measure(el);
        bringIntoView(el, () => measure(el));
        return;
      }
      // ~2.5s. Long enough for a fetch on a slow connection, short enough that a step
      // which is never going to appear doesn't hold up the tour.
      if (++tries > 25) {
        advance();
        return;
      }
      timer = setTimeout(find, 100);
    };
    timer = setTimeout(find, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [step, advance, measure]);

  /**
   * Keep the ring on the element as things move.
   *
   * The frame loop is the general answer while the tab is in front: it catches the
   * modal opening, a font landing, an image sizing, and everything else that moves an
   * element without announcing it.
   *
   * The scroll listener is captured, because this app's scroll container is a div and
   * not the document (see AppFrame) — scroll events from an element do not bubble to
   * window, so a plain window listener would never hear the page move.
   *
   * And the interval is the floor under both. A tab that is not being composited has
   * its render step suspended, so requestAnimationFrame simply stops firing: whatever
   * the ring last knew is what it would keep believing. That is not hypothetical — it
   * is how the highlighted button's own enabled state got stuck here, reading as
   * disabled because it had been disabled for the half-second before its categories
   * arrived. Four reads a second cost nothing and cannot be suspended.
   */
  useEffect(() => {
    if (!tour) return;
    const onMove = () => measure(anchorEl);
    let raf = requestAnimationFrame(function tick() {
      onMove();
      raf = requestAnimationFrame(tick);
    });
    const floor = setInterval(onMove, 250);
    document.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(floor);
      document.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [tour, anchorEl, measure]);

  /**
   * Advance when the highlighted control is actually used.
   *
   * Deliberately after a beat: the click this is following is the one that opens the
   * reminder form, and the next step points at a field inside it.
   */
  useEffect(() => {
    if (!anchorEl || !step?.awaitClick) return;
    const onClick = () => setTimeout(advance, 350);
    anchorEl.addEventListener("click", onClick);
    return () => anchorEl.removeEventListener("click", onClick);
  }, [anchorEl, step, advance]);

  /**
   * The bubble's own height, needed to decide whether it fits under the ring.
   *
   * Re-measured when the step changes or the window is resized, which are the two
   * things that change it — and through a functional update, so the effect needs no
   * dependency on the value it is setting and cannot chase its own tail.
   */
  const bubbleRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const h = bubbleRef.current?.offsetHeight;
    if (h) setBubbleH((prev) => (Math.abs(h - prev) > 2 ? h : prev));
  }, [step, viewport.w]);

  const api = useMemo<TourApi>(() => ({ start, stop, running: tourId }), [start, stop, tourId]);

  const nextTour = tour?.next ? tourById(tour.next) : undefined;
  const mobile = viewport.w < 640;
  // Nothing until the anchor is found, so the ring never paints in the wrong place
  // first and then jumps. A step with no anchor is centred and needs no wait.
  const showing = Boolean(tour && step && (!step.anchor || box));

  /** Where the bubble goes. On a phone it is a sheet; on a laptop it follows. */
  let bubbleStyle: React.CSSProperties;
  if (!box) {
    bubbleStyle = {
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      width: Math.min(BUBBLE_W, viewport.w - MARGIN * 2),
    };
  } else if (mobile) {
    // Pinned to whichever half the highlighted element is not in, so the sheet can
    // never sit on top of the thing it is pointing at.
    const top = box.top + box.height / 2 > viewport.h / 2;
    bubbleStyle = {
      left: MARGIN,
      right: MARGIN,
      ...(top ? { top: MARGIN } : { bottom: MARGIN }),
    };
  } else {
    const below = box.top + box.height + GAP + PAD;
    const above = box.top - PAD - GAP - bubbleH;
    // Under it, over it, or — when the highlighted thing is taller than the screen,
    // as the calendar grid is — along the bottom edge. Overlapping something that big
    // is unavoidable; overlapping the *bottom* of it at least leaves the top rows and
    // the ring's own top edge in view.
    const top =
      below + bubbleH + MARGIN <= viewport.h
        ? below
        : above >= MARGIN
          ? above
          : Math.max(MARGIN, viewport.h - bubbleH - MARGIN);
    const wanted = box.left + box.width / 2 - BUBBLE_W / 2;
    const left = Math.min(
      Math.max(MARGIN, wanted),
      Math.max(MARGIN, viewport.w - BUBBLE_W - MARGIN),
    );
    bubbleStyle = { top, left, width: BUBBLE_W };
  }

  const hole = box
    ? {
        top: box.top - PAD,
        left: box.left - PAD,
        width: box.width + PAD * 2,
        height: box.height + PAD * 2,
      }
    : null;

  return (
    <Ctx.Provider value={api}>
      {children}
      {showing && step && tour && (
        <div
          className="fixed inset-0 z-[60]"
          // The container itself catches nothing; the four panels below do. That is
          // what leaves the highlighted control reachable.
          style={{ pointerEvents: "none" }}
          role="dialog"
          aria-modal="false"
          aria-label={`${tour.label} tour, step ${index + 1} of ${steps.length}`}
        >
          {hole ? (
            <>
              <Dim style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
              <Dim
                style={{
                  top: hole.top + hole.height,
                  left: 0,
                  right: 0,
                  bottom: 0,
                }}
              />
              <Dim
                style={{
                  top: hole.top,
                  left: 0,
                  width: Math.max(0, hole.left),
                  height: hole.height,
                }}
              />
              <Dim
                style={{
                  top: hole.top,
                  left: hole.left + hole.width,
                  right: 0,
                  height: hole.height,
                }}
              />
              <div
                aria-hidden="true"
                className="absolute rounded-lg transition-[top,left,width,height] duration-150"
                style={{
                  top: hole.top,
                  left: hole.left,
                  width: hole.width,
                  height: hole.height,
                  boxShadow: "0 0 0 2px var(--primary), 0 0 0 6px rgb(59 130 246 / 0.25)",
                }}
              />
            </>
          ) : (
            <Dim style={{ inset: 0 }} />
          )}

          <div
            ref={bubbleRef}
            className="absolute rounded-xl border border-border bg-card p-4 text-card-foreground shadow-2xl"
            style={{ ...bubbleStyle, pointerEvents: "auto" }}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                {tour.label} · {index + 1} of {steps.length}
              </p>
              <button
                type="button"
                onClick={stop}
                aria-label="End the tour"
                className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:h-9 sm:w-9"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <h3 className="mt-1 font-semibold leading-snug">{step.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {step.body}
            </p>

            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={stop}
                className="min-h-11 rounded-md px-3 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline sm:min-h-9"
              >
                Skip
              </button>
              <div className="flex items-center gap-2">
                {/* Default size, not sm: these are 44px on a phone like every other
                    target in the app, and the tour is most likely to be run on one. */}
                {index > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => setIndex((n) => Math.max(0, n - 1))}
                  >
                    Back
                  </Button>
                )}
                {/* A step that waits for a real press offers no Next — pressing past it
                    would walk somebody into four steps about a form they never opened.
                    Unless the control is disabled, in which case waiting for a press
                    that cannot happen would be a dead end. */}
                {step.awaitClick && !anchorDisabled ? (
                  <span className="text-xs text-muted-foreground">
                    Press the highlighted button
                  </span>
                ) : last && nextTour ? (
                  <Button onClick={() => start(nextTour.id)}>
                    Next: {nextTour.label}
                  </Button>
                ) : (
                  <Button onClick={() => (last ? stop() : advance())}>
                    {last ? "Done" : "Next"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

/** One panel of the dim layer. Swallows clicks so only the lit control is reachable. */
function Dim({ style }: { style: React.CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      className="absolute bg-black/55"
      style={{ ...style, pointerEvents: "auto" }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
