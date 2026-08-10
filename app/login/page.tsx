"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  ScanFace,
  KeyRound,
  UserPlus,
  MailCheck,
  User,
  Users,
} from "lucide-react";
import { startAuthentication } from "@simplewebauthn/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Credit } from "@/components/credit";
import { lastEmail, rememberEmail, setCacheOwner } from "@/lib/cache";
import { api } from "@/services/api";
import { PIN_LENGTH, type AccountType } from "@/types";

type Mode = "signin" | "register";

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [mode, setMode] = useState<Mode>("signin");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("solo");

  const [busy, setBusy] = useState<"pin" | "passkey" | "register" | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Set once a signup completes. Carries whether the confirmation link went out,
   * because the two outcomes need different instructions: one is "go and click it",
   * the other is "an admin has to do this by hand".
   */
  const [signedUp, setSignedUp] = useState<
    { verificationSent: boolean; message: string } | null
  >(null);
  /** Outcome of following a link, read out of the query string on arrival. */
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  /** Set when a correct PIN was refused only because the address isn't confirmed. */
  const [needsVerification, setNeedsVerification] = useState(false);

  const goToApp = useCallback(() => {
    router.replace("/");
    router.refresh();
  }, [router]);

  const signInWithPasskey = useCallback(async () => {
    setBusy("passkey");
    setError(null);
    try {
      const options = await api.passkeys.authOptions();
      // The biometric prompt happens here. No credential list was sent, so the
      // device offers whichever passkey it holds for this site and tells the
      // server which one was used — that's what identifies the account.
      const assertion = await startAuthentication({
        optionsJSON: options as never,
      });
      const me = await api.passkeys.authVerify(
        assertion as unknown as Record<string, unknown>,
      );
      // Drops any cached data belonging to a different account before the app
      // shell can paint it.
      setCacheOwner(me.id);
      goToApp();
    } catch (e) {
      const message = (e as Error).message || "Passkey sign-in failed.";
      // Cancelling the sheet, or having no passkey on this device, is not an
      // error worth shouting about.
      setError(
        /abort|not allowed|cancel|no available|no credentials/i.test(message)
          ? null
          : message,
      );
      setBusy(null);
    }
  }, [goToApp]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Already signed in? Skip the screen entirely.
        await api.auth.me();
        if (!cancelled) goToApp();
        return;
      } catch {
        /* not signed in — carry on */
      }
      try {
        const status = await api.auth.status();
        if (cancelled) return;
        setSetupNeeded(status.setupNeeded);
        // An empty install has nobody to sign in as, so go straight to signup.
        if (status.setupNeeded) setMode("register");
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [goToApp]);

  /**
   * The verify route redirects here with ?verified=… rather than rendering its own
   * page: the person is in a mail client's browser, and a login screen that says what
   * happened is more use than a bare confirmation they then have to navigate away
   * from. The parameter is removed afterwards so a refresh doesn't repeat it.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("verified");
    const prefill = params.get("email");

    // The address last signed in with here, so only the PIN is left to type. Read in
    // an effect rather than in useState: localStorage does not exist during the server
    // render, and seeding state from it would mismatch on hydration.
    //
    // The link's own address wins when there is one — somebody arriving from a
    // verification email is confirming *that* address, which may not be the one last
    // used on this device.
    if (prefill) setEmail(prefill);
    else setEmail(lastEmail());

    if (!outcome) return;
    setVerifyNotice(
      outcome === "ok"
        ? "Email confirmed — your account is active. Sign in with your PIN."
        : outcome === "expired"
          ? "That link has expired. Sign in to send yourself a fresh one."
          : "That link isn't valid any more. It may already have been used.",
    );
    if (outcome !== "ok") setNeedsVerification(true);
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const submitSignIn = useCallback(async () => {
    setBusy("pin");
    setError(null);
    try {
      const me = await api.auth.login(email, pin);
      setCacheOwner(me.id);
      // Only after it worked. Remembering a typo would make the next sign-in worse,
      // not better — the field would start wrong instead of empty.
      rememberEmail(email);
      goToApp();
    } catch (e) {
      setError((e as Error).message);
      // The API flags this case explicitly. Reached only after the PIN was accepted,
      // so offering the resend here tells an outsider nothing.
      setNeedsVerification(
        (e as { needsVerification?: boolean }).needsVerification === true,
      );
      setBusy(null);
    }
  }, [email, pin, goToApp]);

  /**
   * The PIN this effect has already submitted.
   *
   * Load-bearing. `busy` has to be a dependency (the effect must not fire mid
   * request), but that means it re-runs when `busy` returns to null after a
   * failure — at which point the rejected PIN is still sitting there at full
   * length, and without this guard the effect resubmits it immediately, forever.
   */
  const attemptedPin = useRef<string | null>(null);

  /** Editing the PIN arms it again, so retyping the same digits does retry. */
  useEffect(() => {
    if (pin.length < PIN_LENGTH) attemptedPin.current = null;
  }, [pin]);

  /**
   * Signs in the moment the last digit lands, so unlocking is four taps and no
   * button. Only possible because the PIN is a fixed length — with a range there
   * is no "last digit" to detect.
   */
  useEffect(() => {
    if (mode !== "signin") return;
    if (busy !== null) return;
    if (pin.length !== PIN_LENGTH) return;
    if (!email.trim()) return; // nothing to submit against yet
    if (attemptedPin.current === pin) return;
    attemptedPin.current = pin;
    void submitSignIn();
  }, [pin, mode, busy, email, submitSignIn]);

  async function submitRegister(e: React.FormEvent) {
    e.preventDefault();
    if (pin !== confirmPin) {
      setError("PINs don't match.");
      return;
    }
    setBusy("register");
    setError(null);
    try {
      const res = await api.auth.register({ name, email, pin, accountType });
      setSignedUp({
        verificationSent: res.verificationSent === true,
        message: res.message,
      });
      setBusy(null);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setPin("");
    setConfirmPin("");
    // Signing up is not the same person coming back, so the remembered address is not
    // a helpful starting point — it is an address that already has an account, and
    // registering with it can only fail.
    if (next === "register") setEmail("");
    else setEmail(lastEmail());
  }

  const passkeysPossible =
    typeof window !== "undefined" && "PublicKeyCredential" in window;

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-4 bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1 pb-6 text-center">
          <CardTitle className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary-soft">
            DueDo
          </CardTitle>
          {/* The tagline sits here and nowhere else inside the app. This is the one
              screen a stranger sees before they know what the thing is; past the lock
              screen it would be decoration on a page they came to do something on. */}
          <p className="text-sm font-medium">Just missed it? Never again.</p>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "…"
              : signedUp
                ? "Almost there"
                : setupNeeded
                  ? "Create the first account"
                  : mode === "register"
                    ? "Create your account"
                    : "Welcome back"}
          </p>
        </CardHeader>

        <CardContent>
          {error && (
            <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {verifyNotice && (
            <div className="mb-4 rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm">
              {verifyNotice}
            </div>
          )}

          {/* Only after a correct PIN was refused for want of a confirmed address, so
              this button appearing tells an onlooker nothing they didn't supply. */}
          {needsVerification && !signedUp && (
            <div className="mb-4 rounded-md border border-border bg-muted/30 px-4 py-3 text-sm">
              <p className="text-xs text-muted-foreground">
                The link is what activates the account. If it never arrived, check
                spam or send another.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-full"
                disabled={resent || !email.trim()}
                onClick={async () => {
                  setResent(true);
                  await api.auth.resendVerification(email.trim()).catch(() => {});
                }}
              >
                {resent ? "Link sent — check your inbox" : "Send the link again"}
              </Button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
            </div>
          ) : signedUp ? (
            <div className="space-y-4 text-center">
              <MailCheck className="mx-auto h-10 w-10 text-primary" />
              <p className="text-sm">{signedUp.message}</p>
              {signedUp.verificationSent && (
                <>
                  <p className="text-xs text-muted-foreground">
                    Nothing to wait for beyond that — the link activates the account
                    and then you sign in with your email and PIN.
                  </p>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={resent}
                    onClick={async () => {
                      setResent(true);
                      await api.auth.resendVerification(email).catch(() => {});
                    }}
                  >
                    {resent ? "Link sent again" : "Didn't arrive? Send it again"}
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setSignedUp(null);
                  setResent(false);
                  switchMode("signin");
                }}
              >
                Back to sign in
              </Button>
            </div>
          ) : mode === "register" ? (
            <div className="space-y-4">
              {setupNeeded && (
                <p className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs">
                  Nobody has an account yet. Confirm your email as usual, then follow
                  the last step in DEPLOY.md to make this account the admin.
                </p>
              )}

              <div>
                <p className="mb-1.5 text-sm font-medium">What is this for?</p>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { id: "solo", label: "Just me", icon: User },
                      { id: "family", label: "My family", icon: Users },
                    ] as const
                  ).map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setAccountType(id)}
                      className={`flex min-h-11 items-center justify-center gap-2 rounded-md border text-sm font-medium transition-colors ${
                        accountType === id
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      <Icon className="h-4 w-4" /> {label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {accountType === "solo"
                    ? "Your reminders, private to you."
                    : "Private reminders plus shared family lists. You can create or join a family once you're in — and switch either way later."}
                </p>
              </div>

              <form onSubmit={submitRegister} className="space-y-4">
                <Field label="Your name">
                  <Input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Alex Sharma"
                  />
                </Field>
                <Field label="Email">
                  <Input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </Field>
                <Field label={`Choose a PIN (${PIN_LENGTH} digits)`}>
                  <Input
                    inputMode="numeric"
                    autoComplete="new-password"
                    maxLength={PIN_LENGTH}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                    placeholder="••••"
                    className="text-center tracking-[0.5em]"
                  />
                </Field>
                <Field label="Confirm PIN">
                  <Input
                    inputMode="numeric"
                    autoComplete="new-password"
                    maxLength={PIN_LENGTH}
                    value={confirmPin}
                    onChange={(e) =>
                      setConfirmPin(e.target.value.replace(/\D/g, ""))
                    }
                    className="text-center tracking-[0.5em]"
                  />
                </Field>
                <Button
                  className="w-full"
                  type="submit"
                  disabled={
                    busy !== null || pin.length !== PIN_LENGTH || !email || !name
                  }
                >
                  {busy === "register" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="mr-2 h-4 w-4" />
                  )}
                  Create account
                </Button>
              </form>

              {!setupNeeded && (
                <button
                  type="button"
                  onClick={() => switchMode("signin")}
                  className="w-full text-center text-xs text-muted-foreground underline"
                >
                  I already have an account
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {passkeysPossible && (
                <>
                  <Button
                    className="w-full"
                    onClick={signInWithPasskey}
                    disabled={busy !== null}
                  >
                    {busy === "passkey" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ScanFace className="mr-2 h-4 w-4" />
                    )}
                    Unlock with Face ID
                  </Button>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    or use your email and PIN
                    <span className="h-px flex-1 bg-border" />
                  </div>
                </>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitSignIn();
                }}
                className="space-y-4"
              >
                <Field label="Email">
                  {/* `username`, not `email`: paired with the PIN field's
                      `current-password` below, it is what lets a password manager
                      recognise this as one login and offer to fill both. */}
                  <Input
                    type="email"
                    autoComplete="username"
                    autoFocus={!passkeysPossible}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </Field>
                <Field label={`PIN (${PIN_LENGTH} digits)`}>
                  <Input
                    inputMode="numeric"
                    autoComplete="current-password"
                    maxLength={PIN_LENGTH}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                    placeholder="••••"
                    className="text-center tracking-[0.5em]"
                    disabled={busy === "pin"}
                  />
                </Field>
                {/* Kept as a fallback: the PIN submits itself once the last digit
                    lands, but a paste, a password manager or a keyboard user
                    tabbing through still needs something to press. */}
                <Button
                  className="w-full"
                  type="submit"
                  variant={passkeysPossible ? "outline" : "default"}
                  disabled={busy !== null || pin.length !== PIN_LENGTH || !email}
                >
                  {busy === "pin" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <KeyRound className="mr-2 h-4 w-4" />
                  )}
                  {busy === "pin" ? "Unlocking…" : "Unlock"}
                </Button>
              </form>

              <button
                type="button"
                onClick={() => switchMode("register")}
                className="w-full text-center text-xs text-muted-foreground underline"
              >
                Create an account
              </button>
              <p className="text-center text-xs text-muted-foreground">
                You&apos;ll get an email to confirm your address — clicking the link
                is what activates the account.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      <Credit />
    </div>
  );
}
