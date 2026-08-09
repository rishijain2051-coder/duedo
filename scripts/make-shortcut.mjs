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
  1. AirDrop ${out} to the phone, or email it to yourself and open the attachment.
  2. Shortcuts shows every action in it, then a red "Add Untrusted Shortcut" button
     at the very bottom — below the whole list, which is why it gets missed. Apple
     has not signed this file and cannot be made to from here.
     On iOS 16 and earlier, turn on Settings > Shortcuts > Allow Untrusted Shortcuts
     first; iOS 17 replaced that switch with the per-import prompt.
  3. Say "Hey Siri, ${name}".

If the import is refused outright, build it by hand instead — four actions, listed in
the README under "Add by voice". That path does not depend on this file.`);
