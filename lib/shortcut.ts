// The Apple Shortcuts file, as bytes.
//
// No imports and no globals — `uuid` is passed in rather than read from crypto — so the
// same function builds the file in the browser (the Add shortcut button in Settings)
// and under Node (scripts/make-shortcut.mjs). Two implementations of this is how one of
// them ends up a version behind the endpoint it posts to, which is the same reason
// lib/csv.ts and lib/html.ts exist.
//
// **Binary, not XML.** The first version emitted an XML property list. It parsed
// perfectly — Python's plistlib read it and found every action — and Shortcuts opened
// on the file and did nothing at all: no preview, no Add button, no error. Apple's own
// tooling writes binary plists, so that is what this writes now. There is no way to
// verify the app's acceptance from here, but "valid XML plist" was already proved not
// to be sufficient, which leaves the encoding as the thing to change.
//
// *Signing* is a separate matter and cannot be done at all: Apple issues the signature
// against an Apple ID, so there is no keypair to hold the way there is for an app or an
// installer. An unsigned file still imports — iOS 17 replaced the old global "Allow
// Untrusted Shortcuts" switch with a per-import prompt that lists every action and puts
// the Add button below them.

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

// ───────────────────────────────────────────────────────────── binary plist

/** What a plist can hold, narrowed to what this file needs. */
type PlistValue =
  | string
  | number
  | boolean
  | PlistValue[]
  | { [key: string]: PlistValue };

/**
 * Encodes a `bplist00` document.
 *
 * The format is an object table, then a table of offsets into it, then a 32-byte
 * trailer saying how wide those numbers are and where everything starts. Written by
 * hand because the alternative is a runtime dependency for one file, and this subset —
 * dictionaries, arrays, strings, integers, booleans — is the whole of what a shortcut
 * needs.
 *
 * Objects are de-duplicated by value. Keys like `WFWorkflowActionIdentifier` repeat in
 * every action, and a plist stores each distinct object once with the table referring
 * to it, so skipping that would be writing a deliberately wrong-looking file.
 */
function encodeBplist(root: PlistValue): Uint8Array {
  /** Each entry is one object's encoded bytes; its index is its reference number. */
  const objects: number[][] = [];
  /** value-key → reference, so an identical string is stored once. */
  const seen = new Map<string, number>();

  const bytes = (...values: number[]) => values;

  /** Big-endian integer in `size` bytes. */
  const be = (value: number, size: number): number[] => {
    const out: number[] = [];
    for (let i = size - 1; i >= 0; i--) out.push(Math.floor(value / 2 ** (8 * i)) & 0xff);
    return out;
  };

  /**
   * A marker byte whose low nibble is a length, with lengths of 15 or more spilling
   * into an integer object that follows it.
   */
  const marker = (type: number, count: number): number[] => {
    if (count < 15) return bytes((type << 4) | count);
    return [(type << 4) | 0x0f, ...intBody(count)];
  };

  /** An integer *inline*, as the length-overflow form needs it. */
  const intBody = (n: number): number[] => {
    if (n < 0x100) return [0x10, ...be(n, 1)];
    if (n < 0x10000) return [0x11, ...be(n, 2)];
    if (n < 0x100000000) return [0x12, ...be(n, 4)];
    return [0x13, ...be(n, 8)];
  };

  const push = (encoded: number[], key?: string): number => {
    if (key !== undefined) {
      const hit = seen.get(key);
      if (hit !== undefined) return hit;
    }
    const ref = objects.length;
    objects.push(encoded);
    if (key !== undefined) seen.set(key, ref);
    return ref;
  };

  const encodeString = (value: string): number => {
    // ASCII gets the compact form; anything else has to go UTF-16 big-endian. The
    // object-replacement character U+FFFC that marks a variable is exactly the case
    // that makes this matter.
    let ascii = true;
    for (let i = 0; i < value.length; i++) {
      if (value.charCodeAt(i) > 0x7f) {
        ascii = false;
        break;
      }
    }
    if (ascii) {
      const body: number[] = [];
      for (let i = 0; i < value.length; i++) body.push(value.charCodeAt(i));
      return push([...marker(0x5, value.length), ...body], `s:${value}`);
    }
    // Length is in UTF-16 code units, which is what `value.length` already is.
    const body: number[] = [];
    for (let i = 0; i < value.length; i++) body.push(...be(value.charCodeAt(i), 2));
    return push([...marker(0x6, value.length), ...body], `u:${value}`);
  };

  const encode = (value: PlistValue): number => {
    if (typeof value === "boolean") return push([value ? 0x09 : 0x08], `b:${value}`);
    if (typeof value === "number") return push(intBody(value), `i:${value}`);
    if (typeof value === "string") return encodeString(value);

    if (Array.isArray(value)) {
      // Children first: an object may only refer to one already in the table.
      const refs = value.map(encode);
      return push([...marker(0xa, refs.length), ...refs.map((r) => refSized(r))].flat());
    }

    const keys = Object.keys(value);
    const keyRefs = keys.map(encodeString);
    const valueRefs = keys.map((k) => encode(value[k]));
    return push(
      [
        ...marker(0xd, keys.length),
        ...keyRefs.map((r) => refSized(r)),
        ...valueRefs.map((r) => refSized(r)),
      ].flat(),
    );
  };

  /**
   * References are written at a fixed width decided by the total object count, which
   * is not known until every object exists. Every file this builds is far under 256
   * objects, so one byte is provably enough — and the assertion below is what keeps
   * that a fact rather than an assumption.
   */
  const refSized = (ref: number): number[] => [ref & 0xff];

  const rootRef = encode(root);

  if (objects.length > 0xff) {
    throw new Error(
      `bplist: ${objects.length} objects needs wider references than this encoder writes`,
    );
  }

  // Header, then every object in table order, recording where each began.
  const out: number[] = [];
  for (const c of "bplist00") out.push(c.charCodeAt(0));
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(out.length);
    out.push(...obj);
  }

  const offsetTableStart = out.length;
  const offsetSize = offsetTableStart < 0x100 ? 1 : offsetTableStart < 0x10000 ? 2 : 4;
  for (const off of offsets) out.push(...be(off, offsetSize));

  // Trailer: six unused bytes, the two widths, then three 8-byte numbers.
  out.push(0, 0, 0, 0, 0, 0);
  out.push(offsetSize);
  out.push(1); // reference width, matching refSized above
  out.push(...be(objects.length, 8));
  out.push(...be(rootRef, 8));
  out.push(...be(offsetTableStart, 8));

  return Uint8Array.from(out);
}

// ─────────────────────────────────────────────────────────────── the shortcut

/** A dictionary field entry — headers and JSON bodies share this shape. */
function dictItem(key: string, value: PlistValue): PlistValue {
  return {
    WFItemType: 0,
    WFKey: {
      Value: { string: key },
      WFSerializationType: "WFTextTokenString",
    },
    WFValue: value,
  };
}

function plainValue(text: string): PlistValue {
  return {
    Value: { string: text },
    WFSerializationType: "WFTextTokenString",
  };
}

/**
 * A field whose whole content is an earlier action's output.
 *
 * U+FFFC (object replacement character) stands in for the variable inside the string
 * and `attachmentsByRange` says which range it occupies. That pair is how Shortcuts
 * stores a variable dropped into a text field, and the UUID here has to be the one on
 * the Dictate action or the body posts empty.
 */
function variableValue(outputName: string, uuid: string): PlistValue {
  return {
    Value: {
      string: "￼",
      attachmentsByRange: {
        "{0, 1}": {
          OutputName: outputName,
          OutputUUID: uuid,
          Type: "ActionOutput",
        },
      },
    },
    WFSerializationType: "WFTextTokenString",
  };
}

const fieldValue = (items: PlistValue[]): PlistValue => ({
  Value: { WFDictionaryFieldValueItems: items },
  WFSerializationType: "WFDictionaryFieldValue",
});

/**
 * Three actions: dictate, post, speak the reply.
 *
 * There was a fourth — Get Dictionary Value, to pull `spoken` out of the JSON. It is
 * gone because the endpoint now answers plain text to `Accept: text/plain`, so Speak
 * Text can take the response directly. That action was the one step people wired to
 * the wrong input, and wrong there means silence with the screen off.
 *
 * Actions 2 and 3 set no input. Shortcuts feeds each action the previous result when
 * none is given, which is what the app itself produces when you chain them by hand.
 */
export function buildShortcut(options: ShortcutOptions): Uint8Array {
  const { key, uuid } = options;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const name = options.name ?? "Add reminder";
  const language = options.language ?? "en-IN";

  return encodeBplist({
    WFWorkflowClientVersion: "2605.0.5",
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowMinimumClientVersionString: "900",
    WFWorkflowHasOutputFallback: false,
    WFWorkflowHasShortcutInputVariables: false,
    WFWorkflowIcon: {
      WFWorkflowIconGlyphNumber: 59511,
      WFWorkflowIconStartColor: 2071128575,
    },
    WFWorkflowImportQuestions: [],
    WFWorkflowTypes: ["NCWidget", "WatchKit"],
    WFWorkflowInputContentItemClasses: ["WFStringContentItem"],
    WFWorkflowName: name,
    WFWorkflowActions: [
      {
        WFWorkflowActionIdentifier: "is.workflow.actions.dictatetext",
        WFWorkflowActionParameters: {
          UUID: uuid,
          WFSpeechLanguage: language,
          WFDictateTextStopListening: "After Pause",
        },
      },
      {
        WFWorkflowActionIdentifier: "is.workflow.actions.downloadurl",
        WFWorkflowActionParameters: {
          WFURL: `${baseUrl}/api/ingest/reminder`,
          WFHTTPMethod: "POST",
          WFHTTPBodyType: "JSON",
          ShowHeaders: true,
          WFHTTPHeaders: fieldValue([
            dictItem("Authorization", plainValue(`Bearer ${key}`)),
            // Asks for the sentence rather than the JSON, which is what lets Speak
            // Text take this action's output with nothing in between.
            dictItem("Accept", plainValue("text/plain")),
          ]),
          WFJSONValues: fieldValue([
            dictItem("text", variableValue("Dictated Text", uuid)),
          ]),
        },
      },
      {
        WFWorkflowActionIdentifier: "is.workflow.actions.speaktext",
        WFWorkflowActionParameters: { WFSpeakTextWait: true },
      },
    ],
  });
}
