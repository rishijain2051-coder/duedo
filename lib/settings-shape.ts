import type { Settings } from "@/types";
import { effectivePlan } from "./plan";

/**
 * The one definition of what a Settings payload is, and how a User row becomes one.
 *
 * Two routes serve it: /api/settings, which the Settings page reads, and
 * /api/bootstrap, which is what the app shell actually loads on every page. They used
 * to build the object independently, and the cost of that showed up as a paywall
 * nobody could get out of — `plan` and `premiumUntil` were added to the settings route
 * and not to bootstrap, so the shell saw `plan: undefined`, read it as Free, and a
 * year of granted access was invisible to the account that had been given it. The
 * admin page showed the grant correctly the whole time, because it reads a third
 * route.
 *
 * Nothing here is clever. It exists so the two cannot disagree again.
 */
export const SETTINGS_SELECT = {
  name: true,
  email: true,
  role: true,
  isRootAdmin: true,
  accountType: true,
  plan: true,
  premiumUntil: true,
  timezone: true,
  defaultTime: true,
  overdueRepeatMins: true,
  idleTimeoutMins: true,
  emailOptIn: true,
  pushOptIn: true,
  password_hash: true,
} as const;

/** Exactly the columns SETTINGS_SELECT asks for. */
export type SettingsRow = {
  name: string;
  email: string;
  role: string;
  isRootAdmin: boolean;
  accountType: string;
  plan: string;
  premiumUntil: Date | null;
  timezone: string;
  defaultTime: string;
  overdueRepeatMins: number;
  idleTimeoutMins: number;
  emailOptIn: boolean;
  pushOptIn: boolean;
  password_hash: string | null;
};

/** The counts and server facts neither route can read off the User row. */
export interface SettingsExtras {
  passkeyCount: number;
  pushSubscriptions: number;
  pushConfigured: boolean;
  mailConfigured: boolean;
}

export function shapeSettings(u: SettingsRow, extras: SettingsExtras): Settings {
  return {
    name: u.name,
    email: u.email,
    role: u.role === "admin" ? "admin" : "member",
    // Whether this is the install's owner. The UI says "Owner" rather than naming a
    // plan for that row, because the owner isn't a customer of their own install.
    isRootAdmin: u.isRootAdmin,
    accountType: u.accountType === "family" ? "family" : "solo",
    // Resolved server-side. The rule for reading `plan` against `premiumUntil` — and
    // for an admin outranking both — lives in lib/plan.ts and gets to stay there, so
    // the UI can never show a paid surface from a copy of the rule that drifted.
    // `premiumUntil` travels too, because "until 12 March" is the useful thing to say.
    plan: effectivePlan(u),
    premiumUntil: u.premiumUntil?.toISOString() ?? null,
    timezone: u.timezone,
    defaultTime: u.defaultTime,
    overdueRepeatMins: u.overdueRepeatMins,
    idleTimeoutMins: u.idleTimeoutMins,
    emailOptIn: u.emailOptIn,
    pushOptIn: u.pushOptIn,
    pinSet: Boolean(u.password_hash),
    ...extras,
  };
}
