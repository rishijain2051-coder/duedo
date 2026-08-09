// Builds an Apple Shortcuts file that dictates a reminder into this install.
//
//   node scripts/make-shortcut.mjs --key prosys_xxx --url https://your-app.vercel.app
//
// Both flags are optional. With no --key the file carries a placeholder you replace in
// the Shortcuts app; with one, there is nothing left to edit.
//
// A .shortcut file is a property list, so it can be written by hand. What cannot be
// done from here is *signing* it: since iOS 15 an unsigned shortcut only opens on a
// device where Settings → Shortcuts → Allow Untrusted Shortcuts is on, and that switch
// only appears after you have run any shortcut once. Apple's signing is a service call
// with an Apple ID, not a format detail, so there is no offline substitute.
//
// The four actions this writes are the same four the README lists by hand. If the
// import ever refuses, that list is the fallback and it does not depend on this file.

import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const KEY = flag("key", "REPLACE_WITH_YOUR_KEY");
const URL_BASE = flag("url", "https://pro-sys-by-rishi.vercel.app").replace(/\/+$/, "");
const OUT = flag("out", "prosys-add-reminder.shortcut");
const NAME = flag("name", "Add reminder");

/** The Dictate Text action's output is referenced by this id further down. */
const dictateUUID = randomUUID().toUpperCase();

/** XML-escapes a value going into a plist <string>. */
const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * One entry of a Shortcuts dictionary field — the shape both HTTP headers and a JSON
 * body use. `value` is either a plain string or the variable token below.
 */
const dictItem = (key, valueXml) => `
        <dict>
          <key>WFItemType</key><integer>0</integer>
          <key>WFKey</key>
          <dict>
            <key>Value</key>
            <dict><key>string</key><string>${esc(key)}</string></dict>
            <key>WFSerializationType</key><string>WFTextTokenString</string>
          </dict>
          <key>WFValue</key>
${valueXml}
        </dict>`;

const plainValue = (text) => `          <dict>
            <key>Value</key>
            <dict><key>string</key><string>${esc(text)}</string></dict>
            <key>WFSerializationType</key><string>WFTextTokenString</string>
          </dict>`;

/**
 * A field whose whole content is one earlier action's output.
 *
 * U+FFFC (object replacement character) stands in for the variable inside the string,
 * and attachmentsByRange says which range it occupies — that is how Shortcuts stores a
 * variable dropped into a text field.
 */
const variableValue = (outputName, uuid) => `          <dict>
            <key>Value</key>
            <dict>
              <key>string</key><string>￼</string>
              <key>attachmentsByRange</key>
              <dict>
                <key>{0, 1}</key>
                <dict>
                  <key>OutputName</key><string>${esc(outputName)}</string>
                  <key>OutputUUID</key><string>${uuid}</string>
                  <key>Type</key><string>ActionOutput</string>
                </dict>
              </dict>
            </dict>
            <key>WFSerializationType</key><string>WFTextTokenString</string>
          </dict>`;

// Actions 3 and 4 take no explicit input: Shortcuts feeds each action the previous
// result when none is set, which is what the app itself produces when you chain them
// by hand. One less serialised reference is one less thing to get wrong.
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WFWorkflowClientVersion</key><string>2605.0.5</string>
  <key>WFWorkflowMinimumClientVersion</key><integer>900</integer>
  <key>WFWorkflowMinimumClientVersionString</key><string>900</string>
  <key>WFWorkflowHasOutputFallback</key><false/>
  <key>WFWorkflowHasShortcutInputVariables</key><false/>
  <key>WFWorkflowIcon</key>
  <dict>
    <key>WFWorkflowIconGlyphNumber</key><integer>59511</integer>
    <key>WFWorkflowIconStartColor</key><integer>2071128575</integer>
  </dict>
  <key>WFWorkflowImportQuestions</key><array/>
  <key>WFWorkflowTypes</key>
  <array><string>NCWidget</string><string>WatchKit</string></array>
  <key>WFWorkflowInputContentItemClasses</key>
  <array><string>WFStringContentItem</string></array>
  <key>WFWorkflowActions</key>
  <array>

    <!-- 1. Dictate Text -->
    <dict>
      <key>WFWorkflowActionIdentifier</key><string>is.workflow.actions.dictatetext</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key><string>${dictateUUID}</string>
        <key>WFSpeechLanguage</key><string>en-IN</string>
        <key>WFDictateTextStopListening</key><string>After Pause</string>
      </dict>
    </dict>

    <!-- 2. Get Contents of URL -->
    <dict>
      <key>WFWorkflowActionIdentifier</key><string>is.workflow.actions.downloadurl</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>WFURL</key><string>${esc(URL_BASE)}/api/ingest/reminder</string>
        <key>WFHTTPMethod</key><string>POST</string>
        <key>WFHTTPBodyType</key><string>JSON</string>
        <key>ShowHeaders</key><true/>
        <key>WFHTTPHeaders</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>WFDictionaryFieldValueItems</key>
            <array>${dictItem("Authorization", plainValue(`Bearer ${KEY}`))}
            </array>
          </dict>
          <key>WFSerializationType</key><string>WFDictionaryFieldValue</string>
        </dict>
        <key>WFJSONValues</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>WFDictionaryFieldValueItems</key>
            <array>${dictItem("text", variableValue("Dictated Text", dictateUUID))}
            </array>
          </dict>
          <key>WFSerializationType</key><string>WFDictionaryFieldValue</string>
        </dict>
      </dict>
    </dict>

    <!-- 3. Get Dictionary Value: spoken -->
    <dict>
      <key>WFWorkflowActionIdentifier</key><string>is.workflow.actions.getvalueforkey</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>WFDictionaryKey</key><string>spoken</string>
      </dict>
    </dict>

    <!-- 4. Speak Text -->
    <dict>
      <key>WFWorkflowActionIdentifier</key><string>is.workflow.actions.speaktext</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>WFSpeakTextWait</key><true/>
      </dict>
    </dict>

  </array>
  <key>WFWorkflowName</key><string>${esc(NAME)}</string>
</dict>
</plist>
`;

writeFileSync(OUT, plist, "utf8");

console.log(`Wrote ${OUT}`);
console.log(`  name : ${NAME}`);
console.log(`  posts: ${URL_BASE}/api/ingest/reminder`);
console.log(
  KEY === "REPLACE_WITH_YOUR_KEY"
    ? "  key  : placeholder — open the Get Contents of URL action and replace it"
    : "  key  : embedded, nothing left to edit",
);
console.log(`
Getting it onto the phone:
  1. On the iPhone, run any shortcut once, then turn on
     Settings > Shortcuts > Allow Untrusted Shortcuts. Apple refuses unsigned
     shortcut files until that is on, and this file cannot be signed from here.
  2. AirDrop ${OUT} to the phone, or email it to yourself and open the attachment.
  3. Shortcuts opens it. Add it, then say "Hey Siri, ${NAME}".

If the import is refused, build it by hand instead — four actions, listed in the
README under "Add by voice". That path does not depend on this file.`);
