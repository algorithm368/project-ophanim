/**
 * What kind of file a hash names, from whatever a source said about its type.
 *
 * Pure on purpose: the caller decides which sources' evidence is admissible
 * (for the sprite, only sources that need no key; see `spriteFor`), and this
 * only answers what that evidence says. Undefined means nothing recognisable,
 * which draws the generic file body rather than a guess.
 */
export type FileFormat = "exe" | "elf" | "apk" | "doc" | "script" | "archive";

export type FileFormatEvidence = {
  /** Free-text type descriptions: a source's fileType, mimeType, libmagic. */
  descriptions: string[];
  /** File names the sample has been seen under, best first. */
  names: string[];
};

/** Ordered, first hit wins. Android first because an APK is a zip and its
 *  description often says so too; the executable formats before the document
 *  and script ones because "PE32 executable" is never anything else. */
const DESCRIPTION_RULES: [RegExp, FileFormat][] = [
  [/android|\bapk\b|vnd\.android/, "apk"],
  [/\bpe32\+?|portable executable|\bms-dos\b|\bmsdos\b|x-dosexec|x-msdownload|\bwin(32|64) (exe|dll)\b|\bexe\b|\bdll\b|\.net assembly/, "exe"],
  [/\belf\b|x-executable|x-sharedlib|x-pie-executable/, "elf"],
  [/\bpdf\b|postscript|microsoft (word|excel|powerpoint|office)|composite document file|opendocument|officedocument|msword|ms-excel|ms-powerpoint|rich text format|\brtf\b/, "doc"],
  [/script|powershell|\bjs\b|\bvbs\b|\bbat\b|batch file|\bhta\b|x-sh\b|python|\bperl\b/, "script"],
  [/archive|\bzip\b|\brar\b|7-zip|\b7z\b|gzip|\btar\b|bzip2|\bxz\b|\bcab\b|iso 9660/, "archive"],
];

const EXTENSION: Record<string, FileFormat> = {
  apk: "apk", xapk: "apk", aab: "apk",
  exe: "exe", dll: "exe", scr: "exe", sys: "exe", msi: "exe", cpl: "exe", ocx: "exe",
  elf: "elf", so: "elf", ko: "elf",
  pdf: "doc", doc: "doc", docx: "doc", docm: "doc", xls: "doc", xlsx: "doc", xlsm: "doc",
  xlsb: "doc", ppt: "doc", pptx: "doc", pptm: "doc", rtf: "doc", odt: "doc", ods: "doc",
  odp: "doc", one: "doc",
  ps1: "script", psm1: "script", js: "script", jse: "script", vbs: "script", vbe: "script",
  wsf: "script", hta: "script", bat: "script", cmd: "script", sh: "script", py: "script",
  pl: "script",
  zip: "archive", rar: "archive", "7z": "archive", gz: "archive", tgz: "archive",
  tar: "archive", bz2: "archive", xz: "archive", cab: "archive", iso: "archive",
  jar: "archive",
};

function fromDescription(text: string): FileFormat | undefined {
  const t = text.toLowerCase();
  return DESCRIPTION_RULES.find(([re]) => re.test(t))?.[1];
}

function fromName(name: string): FileFormat | undefined {
  const ext = /\.([a-z0-9]+)$/.exec(name.trim().toLowerCase())?.[1];
  return ext ? EXTENSION[ext] : undefined;
}

const firstOf = (xs: string[], f: (x: string) => FileFormat | undefined) =>
  xs.reduce<FileFormat | undefined>((hit, x) => hit ?? f(x), undefined);

/**
 * The format, preferring what the bytes were described as over what someone
 * named the file. One exception: "archive" is a container, and a .docx or .apk
 * is a zip whose libmagic line says only "Zip archive data", so there a name
 * that says what is inside the container wins.
 */
export function fileFormatOf(evidence: FileFormatEvidence): FileFormat | undefined {
  const described = firstOf(evidence.descriptions, fromDescription);
  if (described && described !== "archive") return described;
  return firstOf(evidence.names, fromName) ?? described;
}
