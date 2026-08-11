import Image from "next/image";

/**
 * The DueDo mark: the letter, a dashed countdown arc, and the dot travelling it.
 *
 * One file, `public/logo.svg`, shared with the marketing site — the same artwork the
 * landing page injects and animates. Drawn as stroked paths on the same geometry as
 * `scripts/generate-icons.mjs` (stem at x=143, a true semicircular bowl at r=136), so
 * the tab icon, the Home Screen icon and this are one letter rather than three drawings
 * of one.
 *
 * `unoptimized` because it is already an SVG: the image optimizer refuses SVG without
 * `dangerouslyAllowSVG`, and there is nothing for it to do to a 2 KB vector anyway.
 *
 * `alt=""` on purpose. It is always rendered beside the word "DueDo", so a name here
 * would have a screen reader announce the app twice in a row. It is decoration in the
 * accessibility tree and the text beside it is the content.
 */
export function Mark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/logo.svg"
      alt=""
      width={size}
      height={size}
      unoptimized
      // next/image lazy-loads by default, which is wrong for this one: it is above the
      // fold on every screen it appears on, so lazy buys nothing and costs a beat where
      // the app has no name on it. Eager rather than `priority` — a 2 KB vector wants
      // loading now, not a <link rel=preload> injected into every route in the app.
      loading="eager"
      className={className}
    />
  );
}
