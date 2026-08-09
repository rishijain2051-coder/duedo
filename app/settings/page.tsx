"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Bell,
  BellRing,
  Clock,
  Download,
  Loader2,
  Mail,
  Mic,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  ScanFace,
  Share,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
  UserCog,
  Users,
} from "lucide-react";
import { startRegistration } from "@simplewebauthn/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { useApp } from "@/components/app-context";
import { Credit } from "@/components/credit";
import { FamilySettings } from "@/components/family-settings";
import { ExternalContactsCard } from "@/components/external-contacts";
import {
  api,
  type ActiveLogin,
  type PasskeySummary,
  type PushDevice,
} from "@/services/api";
import {
  disablePush,
  enablePush,
  hasLocalSubscription,
  isPushSupported,
  needsInstallFirst,
  permission,
} from "@/lib/push-client";
import { checkForUpdate, applyUpdate, RUNNING_BUILD_ID } from "@/lib/update";
import { formatDateTime } from "@/lib/format";
import {
  ACCENTS,
  IDLE_TIMEOUT_OPTIONS,
  PIN_LENGTH,
  type AccentId,
  type ThemeMode,
} from "@/types";

/**
 * The shortcut, shared through iCloud so that Apple signs it.
 *
 * This replaced a generator that wrote the .shortcut file itself. That file was a
 * correct property list — XML first, then binary, both verified against a real plist
 * reader — and Shortcuts on iOS 26 opened it and did nothing at all: no preview, no
 * button, no error. Apple issues shortcut signatures against an Apple ID, so there is
 * no keypair to hold and nothing a locally written file can be given to make it
 * acceptable. An iCloud share link is Apple doing the signing, which is the only
 * version of this that works.
 *
 * It carries a placeholder rather than a key, which is what makes one link safe for
 * everyone: a shortcut holding one person's key would file everybody's reminders into
 * that one account.
 */
const SHORTCUT_LINK =
  "https://www.icloud.com/shortcuts/ede3aa13f3ab4d25a7d4c12b3dd757fc";

const OVERDUE_CHOICES = [
  { minutes: 15, label: "Every 15 minutes" },
  { minutes: 30, label: "Every 30 minutes" },
  { minutes: 60, label: "Every hour" },
  { minutes: 180, label: "Every 3 hours" },
  { minutes: 360, label: "Every 6 hours" },
  { minutes: 1440, label: "Once a day" },
];

const MODES: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];

/** A short fallback for browsers without Intl.supportedValuesOf. */
const FALLBACK_ZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

function timeZones(current: string): string[] {
  let list: string[] = [];
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf;
    if (supported) list = supported("timeZone");
  } catch {
    /* fall through */
  }
  if (list.length === 0) list = FALLBACK_ZONES;
  // Keep whatever is stored selectable even if this browser doesn't list it.
  return list.includes(current) ? list : [current, ...list];
}

/** Small labelled switch — the shared form kit has inputs but no toggle. */
function Toggle({
  checked,
  onChange,
  disabled,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && (
          <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
        )}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          aria-hidden
          className="h-6 w-11 rounded-full bg-muted transition-colors peer-checked:bg-primary peer-disabled:opacity-50"
        />
        <span
          aria-hidden
          className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5"
        />
      </span>
    </label>
  );
}

export default function SettingsPage() {
  const {
    settings,
    refreshSettings,
    timeZone,
    isAdmin,
    themeMode,
    accent,
    setThemeMode,
    setAccent,
  } = useApp();

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [subscribedHere, setSubscribedHere] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [devices, setDevices] = useState<PushDevice[]>([]);
  const [logins, setLogins] = useState<ActiveLogin[]>([]);

  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [defaultTime, setDefaultTime] = useState("05:30");
  const [overdueRepeatMins, setOverdueRepeatMins] = useState(60);
  const [idleTimeoutMins, setIdleTimeoutMins] = useState(0);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");

  /** Whether a Shortcuts key exists, and when it last spoke to us. Never the key. */
  const [tokenStatus, setTokenStatus] = useState<{
    exists: boolean;
    createdAt: string | null;
    lastUsedAt: string | null;
  } | null>(null);
  /** Held only until the page is left: the server cannot show it a second time. */
  const [newToken, setNewToken] = useState<string | null>(null);

  const [deployedBuild, setDeployedBuild] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  function flash(message: string) {
    setNotice(message);
    setError(null);
  }

  const refreshLists = useCallback(async () => {
    const [pk, dev, ses, tok] = await Promise.all([
      api.passkeys.list().catch(() => [] as PasskeySummary[]),
      api.push.devices().catch(() => [] as PushDevice[]),
      api.sessions.list().catch(() => [] as ActiveLogin[]),
      api.settings.apiToken
        .status()
        .catch(() => ({ exists: false, createdAt: null, lastUsedAt: null })),
    ]);
    setPasskeys(pk);
    setDevices(dev);
    setLogins(ses);
    setTokenStatus(tok);
  }, []);

  useEffect(() => {
    if (settings) {
      setName(settings.name);
      setTimezone(settings.timezone);
      setDefaultTime(settings.defaultTime);
      setOverdueRepeatMins(settings.overdueRepeatMins);
      setIdleTimeoutMins(settings.idleTimeoutMins);
    }
  }, [settings]);

  useEffect(() => {
    void refreshLists();
    void hasLocalSubscription().then(setSubscribedHere);
  }, [refreshLists]);


  async function save(
    key: string,
    data: Parameters<typeof api.settings.update>[0],
    message: string,
  ) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await api.settings.update(data);
      await refreshSettings();
      flash(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function togglePush() {
    setBusy("push");
    setError(null);
    setNotice(null);
    try {
      if (subscribedHere) {
        const res = await disablePush();
        if (!res.ok) throw new Error(res.reason);
        setSubscribedHere(false);
        flash("Notifications turned off on this device.");
      } else {
        const res = await enablePush();
        if (!res.ok) throw new Error(res.reason);
        setSubscribedHere(true);
        flash("Notifications enabled on this device.");
      }
      await refreshSettings();
      await refreshLists();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function testPush() {
    setBusy("test");
    setError(null);
    setNotice(null);
    try {
      const res = await api.push.test();
      flash(
        `Test sent to ${res.sent} of ${res.subscriptions} device${res.subscriptions === 1 ? "" : "s"}.` +
          (res.failed > 0 ? ` ${res.failed} failed.` : ""),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function testEmail() {
    setBusy("testEmail");
    setError(null);
    setNotice(null);
    try {
      const res = await api.settings.testEmail();
      flash(res.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function createToken() {
    setBusy("token");
    setError(null);
    setNotice(null);
    try {
      const { token } = await api.settings.apiToken.create();
      setNewToken(token);
      setTokenStatus(await api.settings.apiToken.status());
      flash("Key created. Copy it now — it is not shown again.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function revokeToken() {
    if (!confirm("Revoke the voice key? Any shortcut using it stops working.")) return;
    setBusy("token");
    setError(null);
    try {
      await api.settings.apiToken.revoke();
      setNewToken(null);
      setTokenStatus(await api.settings.apiToken.status());
      flash("Key revoked.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function revokeDevice(d: PushDevice) {
    if (
      !confirm(
        `Stop sending notifications to "${d.label ?? d.service}"?\n\n` +
          `It stays blocked even when that device reopens the app. To undo it, ` +
          `turn notifications on from that device.`,
      )
    )
      return;
    try {
      await api.push.revokeDevice(d.id);
      await refreshLists();
      await refreshSettings();
      await hasLocalSubscription().then(setSubscribedHere);
      flash("Device revoked.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function forgetDevice(d: PushDevice) {
    if (!confirm(`Forget "${d.label ?? d.service}" entirely?`)) return;
    try {
      await api.push.forgetDevice(d.id);
      await refreshLists();
      await refreshSettings();
      flash("Device forgotten.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function revokeLogin(s: ActiveLogin) {
    const self = s.current;
    if (
      !confirm(
        self
          ? "Sign out this device?"
          : `Sign out "${s.label ?? "that device"}"? It will need your PIN or Face ID again.`,
      )
    )
      return;
    try {
      const res = await api.sessions.revoke(s.id);
      if (res.selfRevoked) {
        window.location.replace("/login");
        return;
      }
      await refreshLists();
      flash("Login signed out.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function revokeOtherLogins() {
    if (!confirm("Sign out every other device?")) return;
    setBusy("others");
    try {
      const res = await api.sessions.revokeOthers();
      await refreshLists();
      flash(`Signed out ${res.revoked} other login${res.revoked === 1 ? "" : "s"}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function addPasskey() {
    setBusy("passkey");
    setError(null);
    setNotice(null);
    try {
      const options = await api.passkeys.registerOptions();
      const attestation = await startRegistration({ optionsJSON: options as never });
      await api.passkeys.registerVerify(
        attestation as unknown as Record<string, unknown>,
      );
      await refreshLists();
      await refreshSettings();
      flash("Face ID is set up. You can use it on the lock screen next time.");
    } catch (e) {
      const message = (e as Error).message || "Could not add Face ID.";
      setError(/abort|not allowed|cancel/i.test(message) ? "Cancelled." : message);
    } finally {
      setBusy(null);
    }
  }

  async function removePasskey(id: string) {
    if (!confirm("Remove this passkey? You'll sign in with your PIN instead.")) return;
    try {
      await api.passkeys.remove(id);
      await refreshLists();
      await refreshSettings();
      flash("Passkey removed.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function changePin(e: React.FormEvent) {
    e.preventDefault();
    setBusy("pin");
    setError(null);
    setNotice(null);
    try {
      await api.settings.update({ currentPin, newPin });
      setCurrentPin("");
      setNewPin("");
      flash("PIN updated.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function doCheckUpdate() {
    setBusy("update");
    setError(null);
    setNotice(null);
    const res = await checkForUpdate();
    setDeployedBuild(res.deployed);
    setUpdateAvailable(res.updateAvailable);
    if (res.error) setError(`Could not check: ${res.error}`);
    else flash(res.updateAvailable ? "A new version is available." : "You're up to date.");
    setBusy(null);
  }

  const pushSupported = isPushSupported();
  const mustInstall = needsInstallFirst();
  const perm = permission();

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8">
      <h2 className="text-xl md:text-3xl font-bold tracking-tight">Settings</h2>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-green-500/40 bg-green-500/10 px-4 py-2 text-sm text-green-700 dark:text-green-400">
          {notice}
        </div>
      )}

      {/* ---------------- Your account ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5" /> Your account
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Email (used for reminder emails)">
              <Input value={settings?.email ?? ""} readOnly disabled />
            </Field>
          </div>
          {/* Kept, shortened. Other *users* can't see your personal reminders, but an
              admin of this install can — dropping this to tidy the page would turn an
              honest disclosure into a privacy promise the app doesn't keep. */}
          <p className="text-xs text-muted-foreground">
            Private to you, except an admin of this install, who can view them for
            support — logged every time.
            {settings?.accountType === "family" &&
              " Anything on a family list is visible to that family."}
          </p>
          <Button
            onClick={() => save("name", { name }, "Name updated.")}
            disabled={busy !== null || name === settings?.name || name.trim().length < 2}
          >
            {busy === "name" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save name
          </Button>
        </CardContent>
      </Card>

      {/* ---------------- Families ---------------- */}
      {settings?.accountType === "family" ? (
        <FamilySettings onNotice={flash} onError={setError} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" /> Family sharing
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Create or join a household with a shared list. Your existing reminders
              stay personal either way.
            </p>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                save(
                  "accountType",
                  { accountType: "family" },
                  "Family sharing is on. Create or join a family below.",
                )
              }
            >
              {busy === "accountType" && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Turn on family sharing
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ---------------- Appearance ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" /> Appearance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-1.5 text-sm font-medium">Mode</p>
            <div className="grid grid-cols-3 gap-2">
              {MODES.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setThemeMode(id)}
                  className={`flex min-h-11 items-center justify-center gap-2 rounded-md border text-sm font-medium transition-colors ${
                    themeMode === id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium">Accent colour</p>
            <div className="flex flex-wrap gap-2">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setAccent(a.id as AccentId)}
                  aria-label={a.label}
                  title={a.label}
                  className={`flex h-11 w-11 items-center justify-center rounded-full border-2 transition-transform hover:scale-105 ${
                    accent === a.id ? "border-foreground" : "border-transparent"
                  }`}
                >
                  <span
                    className="h-7 w-7 rounded-full"
                    style={{
                      background: `linear-gradient(135deg, ${a.primary}, ${a.soft})`,
                    }}
                  />
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---------------- How you're reminded ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" /> How you&apos;re reminded
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Toggle
            label="Push notifications"
            hint="Lock-screen alerts with Complete and Snooze buttons."
            checked={settings?.pushOptIn ?? false}
            disabled={busy !== null || !settings}
            onChange={(next) =>
              save(
                "pushOptIn",
                { pushOptIn: next },
                next ? "Push reminders on." : "Push reminders off.",
              )
            }
          />

          <Toggle
            label="Email reminders"
            hint="Sent to the address on your account. Overdue repeats capped at one every 12 hours."
            checked={settings?.emailOptIn ?? false}
            disabled={busy !== null || !settings}
            onChange={(next) =>
              save(
                "emailOptIn",
                { emailOptIn: next },
                next ? "Email reminders on." : "Email reminders off.",
              )
            }
          />

          {settings && !settings.mailConfigured && settings.emailOptIn && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              Email is switched on for your account, but the server has no SMTP
              credentials — set SMTP_HOST, SMTP_USER and SMTP_PASS. Nothing will
              be emailed until then.
            </div>
          )}

          {settings && !settings.pushConfigured && settings.pushOptIn && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              Push is switched on for your account, but the server push keys are
              missing — set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.
            </div>
          )}

          <div className="border-t border-border pt-4">
            {mustInstall && (
              <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p className="font-medium text-amber-700 dark:text-amber-400">
                  Add PRO-SYS to your Home Screen first
                </p>
                <p className="mt-1 text-muted-foreground">
                  iPhone only delivers notifications to an installed app, never to
                  a Safari tab. Tap{" "}
                  <Share className="inline h-3.5 w-3.5 align-text-bottom" /> Share →{" "}
                  <strong>Add to Home Screen</strong>, then open PRO-SYS from your
                  Home Screen and come back here.
                </p>
              </div>
            )}

            {!pushSupported && !mustInstall && (
              <p className="mb-3 text-sm text-muted-foreground">
                This browser doesn&apos;t support push notifications — email still
                works.
              </p>
            )}

            {/* One line rather than three definition pairs. "Permission" only earns
                its place when the browser has blocked us — that is the state that
                explains why the button below does nothing. */}
            <p className="text-sm">
              This device:{" "}
              <span className="font-medium">
                {subscribedHere ? "subscribed" : "not subscribed"}
              </span>
              {perm === "denied" && (
                <span className="text-amber-700 dark:text-amber-400">
                  {" "}
                  · blocked in this browser
                </span>
              )}
              <span className="text-muted-foreground">
                {" · "}
                {settings?.pushSubscriptions ?? 0} of your devices receiving
              </span>
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                onClick={togglePush}
                disabled={busy !== null || !pushSupported || mustInstall}
                variant={subscribedHere ? "outline" : "default"}
              >
                {busy === "push" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <BellRing className="mr-2 h-4 w-4" />
                )}
                {subscribedHere ? "Turn off on this device" : "Enable on this device"}
              </Button>
              <Button
                variant="outline"
                onClick={testPush}
                disabled={busy !== null || !settings?.pushSubscriptions}
              >
                {busy === "test" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send test push
              </Button>
              <Button
                variant="outline"
                onClick={testEmail}
                disabled={busy !== null || !settings?.mailConfigured}
              >
                {busy === "testEmail" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="mr-2 h-4 w-4" />
                )}
                Send test email
              </Button>
            </div>

          </div>
        </CardContent>
      </Card>

      {/* ---------------- Devices ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" /> Your devices
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No devices enrolled yet.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border">
              {devices.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {d.label ?? d.service}
                      {d.blocked && (
                        <span className="ml-2 text-xs font-normal text-amber-700 dark:text-amber-400">
                          revoked
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {d.lastOkAt
                        ? `Last delivered ${formatDateTime(d.lastOkAt, true, timeZone)}`
                        : `Added ${formatDateTime(d.createdAt, true, timeZone)}, never delivered`}
                      {d.failures > 0 && ` · ${d.failures} recent failure(s)`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center">
                    {!d.blocked && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Stop sending to this device"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => revokeDevice(d)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                    {d.blocked && (
                      <Button variant="ghost" size="sm" onClick={() => forgetDevice(d)}>
                        Forget
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {/* Kept: this one is not documentation, it is the answer to "why is it still
              in the list, and why can't I delete it from here?" — which the buttons
              alone would leave someone guessing at. */}
          {devices.length > 0 && (
            <p className="text-xs text-muted-foreground">
              A revoked device stays listed. The app re-registers on open, so only
              turning notifications on from that device lifts the block.
            </p>
          )}
          {devices.some((d) => !d.blocked) && (
            <Button
              variant="outline"
              onClick={async () => {
                if (!confirm("Stop sending notifications to every device?")) return;
                await api.push.revokeAllDevices();
                await refreshLists();
                await refreshSettings();
                flash("All devices revoked.");
              }}
            >
              Revoke all devices
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ---------------- Reminder defaults ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" /> Reminder defaults
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your timezone">
              <Select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                {timeZones(timezone).map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Default time (when you don't pick one)">
              <Input
                type="time"
                value={defaultTime}
                onChange={(e) => setDefaultTime(e.target.value)}
              />
            </Field>
            <Field label="While overdue, remind me (push only)">
              <Select
                value={String(overdueRepeatMins)}
                onChange={(e) => setOverdueRepeatMins(Number(e.target.value))}
              >
                {OVERDUE_CHOICES.map((o) => (
                  <option key={o.minutes} value={o.minutes}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button
            onClick={() =>
              save(
                "defaults",
                { timezone, defaultTime, overdueRepeatMins },
                "Reminder defaults saved.",
              )
            }
            disabled={busy !== null}
          >
            {busy === "defaults" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save defaults
          </Button>
        </CardContent>
      </Card>

      {/* ---------------- Outside contacts ---------------- */}
      <ExternalContactsCard onNotice={flash} onError={setError} />

      {/* ---------------- Security ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Security
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <Field label="Sign out when inactive">
            <Select
              value={String(idleTimeoutMins)}
              onChange={(e) => {
                const minutes = Number(e.target.value);
                setIdleTimeoutMins(minutes);
                void save(
                  "idle",
                  { idleTimeoutMins: minutes },
                  minutes === 0
                    ? "Automatic sign-out turned off."
                    : `You'll be signed out after ${minutes} minutes of inactivity.`,
                );
              }}
              disabled={busy === "idle"}
            >
              {IDLE_TIMEOUT_OPTIONS.map((o) => (
                <option key={o.minutes} value={o.minutes}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Face ID</p>
                <p className="text-xs text-muted-foreground">
                  {passkeys.length === 0
                    ? "Not set up — you sign in with your PIN."
                    : `${passkeys.length} passkey${passkeys.length === 1 ? "" : "s"} registered.`}
                </p>
              </div>
              <Button variant="outline" onClick={addPasskey} disabled={busy !== null}>
                {busy === "passkey" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ScanFace className="mr-2 h-4 w-4" />
                )}
                Add Face ID
              </Button>
            </div>

            {passkeys.length > 0 && (
              <ul className="divide-y divide-border rounded-md border">
                {passkeys.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.label ?? "Passkey"}</p>
                      <p className="text-xs text-muted-foreground">
                        Added {formatDateTime(p.createdAt, true, timeZone)}
                        {p.lastUsedAt
                          ? ` · last used ${formatDateTime(p.lastUsedAt, true, timeZone)}`
                          : " · never used"}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-destructive hover:bg-destructive/10"
                      onClick={() => removePasskey(p.id)}
                      title="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Active logins */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Active logins</p>
                <p className="text-xs text-muted-foreground">
                  {logins.length} signed in
                </p>
              </div>
              {logins.length > 1 && (
                <Button
                  variant="outline"
                  onClick={revokeOtherLogins}
                  disabled={busy !== null}
                >
                  {busy === "others" && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Sign out others
                </Button>
              )}
            </div>

            {logins.length > 0 && (
              <ul className="divide-y divide-border rounded-md border">
                {logins.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {s.label ?? "Unknown device"}
                        {s.current && (
                          <span className="ml-2 text-xs font-normal text-primary">
                            this device
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Signed in {formatDateTime(s.createdAt, true, timeZone)} · last
                        active {formatDateTime(s.lastSeenAt, true, timeZone)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-destructive hover:bg-destructive/10"
                      onClick={() => revokeLogin(s)}
                      title={s.current ? "Sign out" : "Sign out this device"}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form onSubmit={changePin} className="space-y-3">
            <p className="text-sm font-medium">Change PIN</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Current PIN">
                <Input
                  inputMode="numeric"
                  maxLength={PIN_LENGTH}
                  autoComplete="current-password"
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
              <Field label={`New PIN (${PIN_LENGTH} digits)`}>
                <Input
                  inputMode="numeric"
                  maxLength={PIN_LENGTH}
                  autoComplete="new-password"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
            </div>
            <Button
              type="submit"
              variant="outline"
              disabled={busy !== null || newPin.length !== PIN_LENGTH}
            >
              {busy === "pin" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update PIN
            </Button>
            {/* Kept: the reasonable assumption is the opposite, and acting on it
                leaves a device signed in that the person believes they just locked. */}
            <p className="text-xs text-muted-foreground">
              This doesn&apos;t sign out other devices — use{" "}
              <strong>Sign out others</strong> for that.
            </p>
          </form>
        </CardContent>
      </Card>

      {/* Account management lives in the admin panel now, not here — two places
          to approve the same signup is how one of them ends up stale. */}
      {isAdmin && (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 py-4">
            <p className="text-sm font-medium">Accounts, families, health, audit log</p>
            <Link href="/admin" className="shrink-0">
              <Button variant="outline" size="sm">
                Admin panel
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* ---------------- Version ---------------- */}
      {/* Siri capture. Sits above App version because it is something to set up once,
          not something to check. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5" /> Add by voice
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            An Apple Shortcut can dictate a reminder straight into this account — “Hey
            Siri, add reminder”, then say it.
          </p>
          <ol className="ml-4 list-decimal space-y-1 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Create key</span> below, and
              copy it.
            </li>
            <li>
              Open{" "}
              <a
                href={SHORTCUT_LINK}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline"
              >
                the shortcut
              </a>{" "}
              on your iPhone and add it.
            </li>
            <li>
              In its <span className="font-medium">Get Contents of URL</span> action,
              replace the placeholder in the Authorization header with your key.
            </li>
          </ol>

          {tokenStatus?.exists ? (
            <p className="text-sm">
              A key is active
              {tokenStatus.lastUsedAt
                ? ` · last used ${formatDateTime(tokenStatus.lastUsedAt, true, settings?.timezone)}`
                : " · not used yet"}
              .
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No key yet.</p>
          )}

          {newToken && (
            <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
              <p className="text-xs font-medium">
                Copy this into the Shortcut now — it is not shown again.
              </p>
              <p className="break-all font-mono text-xs">{newToken}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(newToken);
                  setNotice("Key copied.");
                }}
              >
                Copy
              </Button>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={createToken} disabled={busy !== null}>
              {busy === "token" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tokenStatus?.exists ? "Replace key" : "Create key"}
            </Button>
            <a href={SHORTCUT_LINK} target="_blank" rel="noreferrer">
              <Button variant="outline">
                <Download className="mr-2 h-4 w-4" /> Get the shortcut
              </Button>
            </a>
            {tokenStatus?.exists && (
              <Button
                variant="outline"
                className="text-destructive"
                onClick={revokeToken}
                disabled={busy !== null}
              >
                Revoke
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            The shortcut is shared through iCloud, so Apple has signed it — it installs
            with no warning, and it carries a placeholder rather than anybody&apos;s key.
            The key is what makes it yours, which is why it is pasted in afterwards
            rather than baked in.
          </p>
          {tokenStatus?.exists && (
            <p className="text-xs text-muted-foreground">
              Replacing stops the old key working. The key can only add reminders — it
              cannot read them, sign in, or reach anything else.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" /> App version
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Running <span className="font-mono text-xs">{RUNNING_BUILD_ID}</span>
            {deployedBuild && (
              <>
                {" · deployed "}
                <span className="font-mono text-xs">{deployedBuild}</span>
              </>
            )}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={doCheckUpdate} disabled={busy !== null}>
              {busy === "update" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Check for updates
            </Button>
            {updateAvailable && (
              <Button onClick={() => applyUpdate()}>Reload to update</Button>
            )}
          </div>

          <Credit />
        </CardContent>
      </Card>
    </div>
  );
}
