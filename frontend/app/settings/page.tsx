"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Mail, Send, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { api } from "@/services/api";

export default function SettingsPage() {
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function sendTest() {
    setSending(true);
    setResult(null);
    try {
      const res = await api.notifications.testEmail(to || undefined);
      setOk(res.sent);
      setResult(res.message + (res.to ? ` (to ${res.to})` : ""));
    } catch (e) {
      setOk(false);
      setResult((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex-1 space-y-4 p-6 md:p-8">
      <h2 className="text-3xl font-bold tracking-tight">Settings</h2>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" /> Email delivery
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Reminders are sent by email from the account configured on the server
            (SMTP). Send a test to confirm it is working.
          </p>
          <Field label="Send test to (leave blank to use the server address)">
            <Input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="you@example.com"
            />
          </Field>
          <Button onClick={sendTest} disabled={sending}>
            {sending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Send test email
          </Button>
          {result && (
            <p
              className={`text-sm ${ok ? "text-green-500" : "text-red-400"}`}
            >
              {result}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" /> Family & delivery preferences
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Manage who is in the family, their email addresses, and how many days
            before a due date they get reminded on the{" "}
            <Link href="/family" className="text-primary underline">
              Family
            </Link>{" "}
            page.
          </p>
          <p>
            The daily reminder job runs on the server (Vercel Cron) — no need to
            keep this app open.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>PRO-SYS — Life Reminder Management System.</p>
          <p className="mt-1">
            No login: anyone with this link can view and manage the family
            reminders. Keep the URL private.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
