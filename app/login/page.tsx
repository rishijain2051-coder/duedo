"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ScanFace, KeyRound, UserPlus, MailCheck } from "lucide-react";
import { startAuthentication } from "@simplewebauthn/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { setCacheOwner } from "@/lib/cache";
import { api } from "@/services/api";

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

  const [busy, setBusy] = useState<"pin" | "passkey" | "register" | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set once a signup lands in the approval queue — there's nothing else to do. */
  const [awaitingApproval, setAwaitingApproval] = useState(false);

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

  async function submitSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy("pin");
    setError(null);
    try {
      const me = await api.auth.login(email, pin);
      setCacheOwner(me.id);
      goToApp();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  async function submitRegister(e: React.FormEvent) {
    e.preventDefault();
    if (pin !== confirmPin) {
      setError("PINs don't match.");
      return;
    }
    setBusy("register");
    setError(null);
    try {
      const res = await api.auth.register({ name, email, pin });
      if (res.status === "active") {
        goToApp();
        return;
      }
      setAwaitingApproval(true);
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
  }

  const passkeysPossible =
    typeof window !== "undefined" && "PublicKeyCredential" in window;

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1 pb-6 text-center">
          <CardTitle className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary-soft">
            PRO-SYS
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "…"
              : awaitingApproval
                ? "Almost there"
                : setupNeeded
                  ? "Set up the first account"
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

          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
            </div>
          ) : awaitingApproval ? (
            <div className="space-y-4 text-center">
              <MailCheck className="mx-auto h-10 w-10 text-primary" />
              <p className="text-sm">
                Your account has been created and is waiting for an admin to
                approve it.
              </p>
              <p className="text-xs text-muted-foreground">
                Once it&apos;s approved, sign in with your email and PIN.
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setAwaitingApproval(false);
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
                  Nobody has an account yet, so this first one becomes the{" "}
                  <strong>admin</strong> — you&apos;ll approve everyone who signs
                  up after you.
                </p>
              )}

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
                <Field label="Choose a PIN (4–6 digits)">
                  <Input
                    inputMode="numeric"
                    autoComplete="new-password"
                    maxLength={6}
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
                    maxLength={6}
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
                  disabled={busy !== null || pin.length < 4 || !email || !name}
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

              <form onSubmit={submitSignIn} className="space-y-4">
                <Field label="Email">
                  <Input
                    type="email"
                    autoComplete="email"
                    autoFocus={!passkeysPossible}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </Field>
                <Field label="PIN">
                  <Input
                    inputMode="numeric"
                    autoComplete="current-password"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                    placeholder="••••"
                    className="text-center tracking-[0.5em]"
                  />
                </Field>
                <Button
                  className="w-full"
                  type="submit"
                  variant={passkeysPossible ? "outline" : "default"}
                  disabled={busy !== null || pin.length < 4 || !email}
                >
                  {busy === "pin" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <KeyRound className="mr-2 h-4 w-4" />
                  )}
                  Unlock
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
                New accounts need an admin&apos;s approval before they can sign in.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
