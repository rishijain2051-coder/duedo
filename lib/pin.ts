import bcrypt from "bcryptjs";
import { PIN_LENGTH } from "@/types";

// Node-only (bcrypt). Only import from route handlers, never from middleware.

export { PIN_LENGTH };

export function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

export function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

/** Built from PIN_LENGTH so the rule lives in exactly one place. */
const PIN_PATTERN = new RegExp(`^\\d{${PIN_LENGTH}}$`);

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === "string" && PIN_PATTERN.test(pin);
}
