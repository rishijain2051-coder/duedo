"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { api, type LoginMember } from "@/services/api";

export default function LoginPage() {
  const router = useRouter();
  const [members, setMembers] = useState<LoginMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<LoginMember | null>(null);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bootstrap (no members yet)
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    api.auth
      .members()
      .then(setMembers)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  function goToApp() {
    router.replace("/");
    router.refresh();
  }

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    if (!selected.hasPin && pin !== confirmPin) {
      setError("PINs don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.auth.login(selected.id, pin);
      goToApp();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function submitBootstrap(e: React.FormEvent) {
    e.preventDefault();
    if (pin !== confirmPin) {
      setError("PINs don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, pin }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Setup failed");
      goToApp();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const isBootstrap = !loading && members.length === 0;

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 pb-6 text-center">
          <CardTitle className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-400">
            PRO-SYS
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {isBootstrap
              ? "Set up your family to get started"
              : selected
                ? selected.hasPin
                  ? `Enter ${selected.name}'s PIN`
                  : `Create a PIN for ${selected.name}`
                : "Who's using PRO-SYS?"}
          </p>
        </CardHeader>

        <CardContent>
          {error && (
            <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
            </div>
          ) : isBootstrap ? (
            <form onSubmit={submitBootstrap} className="space-y-4">
              <Field label="Your name">
                <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </Field>
              <Field label="Email (for reminders)">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Create a PIN (4–6 digits)">
                  <Input
                    inputMode="numeric"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  />
                </Field>
                <Field label="Confirm PIN">
                  <Input
                    inputMode="numeric"
                    maxLength={6}
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                  />
                </Field>
              </div>
              <Button className="w-full" type="submit" disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create & enter
              </Button>
            </form>
          ) : !selected ? (
            <div className="grid grid-cols-2 gap-3">
              {members.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setSelected(m);
                    setPin("");
                    setConfirmPin("");
                    setError(null);
                  }}
                  className="flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors hover:bg-accent"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/20 text-lg font-bold text-primary">
                    {m.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm font-medium">{m.name}</span>
                  {!m.hasPin && (
                    <span className="text-[10px] text-muted-foreground">Set PIN</span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <form onSubmit={submitLogin} className="space-y-4">
              <div className="flex flex-col items-center gap-2 pb-2">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/20 text-xl font-bold text-primary">
                  {selected.name.charAt(0).toUpperCase()}
                </div>
              </div>
              <Field label={selected.hasPin ? "PIN" : "Choose a PIN (4–6 digits)"}>
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••"
                />
              </Field>
              {!selected.hasPin && (
                <Field label="Confirm PIN">
                  <Input
                    inputMode="numeric"
                    maxLength={6}
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                  />
                </Field>
              )}
              <Button className="w-full" type="submit" disabled={busy || pin.length < 4}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {selected.hasPin ? "Enter" : "Set PIN & enter"}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setError(null);
                }}
                className="flex w-full items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
