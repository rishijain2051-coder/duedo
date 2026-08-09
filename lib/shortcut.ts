// The Apple Shortcuts file, as a string.
//
// No imports and no globals — `uuid` is passed in rather than read from crypto — so the
// same function builds the file in the browser (the Add shortcut button in Settings)
// and under Node (scripts/make-shortcut.mjs). Two implementations of this is how one of
// them ends up a version behind the endpoint it posts to, which is the same reason
// lib/csv.ts and lib/html.ts exist.
//
// A .shortcut is a property list, so writing one is straightforward. *Signing* one is
// not, and cannot be: Apple issues the signature against an Apple ID, so there is no
// keypair to hold the way there is for an app or an installer. An unsigned file still
// imports — iOS 17 replaced the old global "Allow Untrusted Shortcuts" switch with a
// per-import prompt that lists every action and puts the Add button below them.
// Nothing here can change that, so the UI explains where the button is instead.

export const SHORTCUT_FILENAME = "prosys-add-reminder.shortcut";

/** What the file carries when no key was available to embed. */
export const KEY_PLACEHOLDER = "REPLACE_WITH_YOUR_KEY";

export interface ShortcutOptions {
  /** The API key, or KEY_PLACEHOLDER when there is none to embed. */
  key: string;
  /** Origin of this install, no trailing slash. */
  baseUrl: string;
  /** Names the shortcut, and therefore the Siri phrase. */
  name?: string;
  /** Links the Dictate action to the variable the request body reads. */
  uuid: string;
  /** Dictation language. */
  language?: string;
}

/** XML-escapes a value going into a plist <string>. */
function esc(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** One entry of a Shortcuts dictionary field — headers and JSON bodies share it. */
function dictItem(key: string, valueXml: string): string {
  return `
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
}

function plainValue(text: string): string {
  return `          <dict>
            <key>Value</key>
            <dict><key>string</key><string>${esc(text)}</string></dict>
            <key>WFSerializationType</key><string>WFTextTokenString</string>
          </dict>`;
}

/**
 * A field whose whole content is an earlier action's output.
 *
 * U+FFFC (object replacement character) stands in for the variable inside the string
 * and `attachmentsByRange` says which range it occupies. That pair is how Shortcuts
 * stores a variable dropped into a text field, and the UUID here has to be the one on
 * the Dictate action or the body posts empty.
 */
function variableValue(outputName: string, uuid: string): string {
  return `          <dict>
            <key>Value</key>
            <dict>
              <key>string</key><string>￼</string>
              <key>attachmentsByRange</key>
              <dict>
                <key>{0, 1}</key>
                <dict>
                  <key>OutputName</key><string>${esc(outputName)}</string>
                  <key>OutputUUID</key><string>${esc(uuid)}</string>
                  <key>Type</key><string>ActionOutput</string>
                </dict>
              </dict>
            </dict>
            <key>WFSerializationType</key><string>WFTextTokenString</string>
          </dict>`;
}

/**
 * Four actions: dictate, post, read the spoken field, say it.
 *
 * Actions 3 and 4 set no input. Shortcuts feeds each action the previous result when
 * none is given, which is what the app itself produces when you chain them by hand —
 * one less serialised reference to get wrong.
 */
export function buildShortcut(options: ShortcutOptions): string {
  const { key, uuid } = options;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const name = options.name ?? "Add reminder";
  const language = options.language ?? "en-IN";

  return `<?xml version="1.0" encoding="UTF-8"?>
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
        <key>UUID</key><string>${esc(uuid)}</string>
        <key>WFSpeechLanguage</key><string>${esc(language)}</string>
        <key>WFDictateTextStopListening</key><string>After Pause</string>
      </dict>
    </dict>

    <!-- 2. Get Contents of URL -->
    <dict>
      <key>WFWorkflowActionIdentifier</key><string>is.workflow.actions.downloadurl</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>WFURL</key><string>${esc(baseUrl)}/api/ingest/reminder</string>
        <key>WFHTTPMethod</key><string>POST</string>
        <key>WFHTTPBodyType</key><string>JSON</string>
        <key>ShowHeaders</key><true/>
        <key>WFHTTPHeaders</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>WFDictionaryFieldValueItems</key>
            <array>${dictItem("Authorization", plainValue(`Bearer ${key}`))}
            </array>
          </dict>
          <key>WFSerializationType</key><string>WFDictionaryFieldValue</string>
        </dict>
        <key>WFJSONValues</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>WFDictionaryFieldValueItems</key>
            <array>${dictItem("text", variableValue("Dictated Text", uuid))}
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
  <key>WFWorkflowName</key><string>${esc(name)}</string>
</dict>
</plist>
`;
}
