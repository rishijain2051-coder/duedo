"use client";

import { useEffect, useState } from "react";

/**
 * A value that can only be known in a browser, read *after* hydration.
 *
 * The problem it solves is narrow and easy to reintroduce. Every page here is a client
 * component that is still server-rendered first, so a capability check written the
 * obvious way —
 *
 *     const canPush = isPushSupported();   // during render
 *
 * — returns false on the server and true in Chrome, and React's first client render
 * therefore disagrees with the HTML it was given. That is a hydration mismatch: React
 * throws away the server markup for that subtree and re-renders it on the client, so
 * the page still ends up correct and nothing looks broken. What it costs is the fast
 * path on every single load, and the only evidence is a console error nobody reads.
 *
 * Returning `null` until mounted is the whole point, and is why this is not just
 * `useState(false)` plus an effect. A boolean default has to guess, and a wrong guess
 * renders a real sentence for one frame: "This browser doesn't support push
 * notifications" flashing at somebody whose browser supports it perfectly is worse
 * than the warning this exists to remove. `null` means *not known yet*, so a caller
 * can render nothing at all until it is.
 *
 *     const caps = useClientOnly(() => ({ push: isPushSupported() }));
 *     {caps && !caps.push && <p>…</p>}
 *
 * `probe` runs once, on mount. It is not re-run when it changes identity — an inline
 * arrow is a new function every render, and depending on it would loop.
 */
export function useClientOnly<T>(probe: () => T): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    setValue(probe());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}
