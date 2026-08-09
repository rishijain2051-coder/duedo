// Writes the Apple Shortcuts file from the command line.
//
//   node scripts/make-shortcut.mjs --key prosys_xxx --url https://your-app.vercel.app
//
// The same thing the Add shortcut button in Settings does, for when a file is wanted
// without opening the app. Both call buildShortcut in lib/shortcut.ts — that file has
// no imports and no globals precisely so this script and the browser can share it.

import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { buildShortcut, KEY_PLACEHOLDER, SHORTCUT_FILENAME } from "../lib/shortcut.ts";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const key = flag("key", KEY_PLACEHOLDER);
const baseUrl = flag("url", "https://pro-sys-by-rishi.vercel.app");
const out = flag("out", SHORTCUT_FILENAME);
const name = flag("name", "Add reminder");

writeFileSync(out, buildShortcut({ key, baseUrl, name, uuid: randomUUID().toUpperCase() }), "utf8");

console.log(`Wrote ${out}`);
console.log(`  name : ${name}`);
console.log(`  posts: ${baseUrl.replace(/\/+$/, "")}/api/ingest/reminder`);
console.log(
  key === KEY_PLACEHOLDER
    ? "  key  : placeholder — open the Get Contents of URL action and replace it"
    : "  key  : embedded, nothing left to edit",
);
console.log(`
Getting it onto the phone:
  1. On the iPhone, run any shortcut once, then turn on
     Settings > Shortcuts > Allow Untrusted Shortcuts. Apple refuses unsigned
     shortcut files until that is on, and this file cannot be signed from here.
  2. AirDrop ${out} to the phone, or email it to yourself and open the attachment.
  3. Shortcuts opens it. Add it, then say "Hey Siri, ${name}".

If the import is refused, build it by hand instead — four actions, listed in the
README under "Add by voice". That path does not depend on this file.`);
