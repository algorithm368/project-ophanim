import { describe, expect, it } from "vitest";
import { fileFormatOf } from "@/lib/ti/file-format";

const described = (...descriptions: string[]) => fileFormatOf({ descriptions, names: [] });
const named = (...names: string[]) => fileFormatOf({ descriptions: [], names });

describe("fileFormatOf, from a description", () => {
  it.each([
    ["PE32 executable (GUI) Intel 80386, for MS Windows", "exe"],
    ["PE32+ executable (DLL) (console) x86-64", "exe"],
    ["Win32 EXE", "exe"],
    ["Win64 DLL", "exe"],
    ["application/x-dosexec", "exe"],
    ["MS-DOS executable", "exe"],
    ["exe", "exe"],
    ["ELF 64-bit LSB executable, x86-64, dynamically linked", "elf"],
    ["application/x-sharedlib", "elf"],
    ["Android package (APK)", "apk"],
    ["application/vnd.android.package-archive", "apk"],
    ["PDF document, version 1.4", "doc"],
    ["Composite Document File V2 Document, Little Endian", "doc"],
    ["Microsoft Word 2007+", "doc"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "doc"],
    ["Rich Text Format data", "doc"],
    ["PostScript document text", "doc"],
    ["Bourne-Again shell script, ASCII text executable", "script"],
    ["text/x-shellscript", "script"],
    ["JavaScript source", "script"],
    ["PowerShell", "script"],
    ["VBS", "script"],
    ["Python script, ASCII text", "script"],
    ["Zip archive data, at least v2.0 to extract", "archive"],
    ["RAR archive data, v5", "archive"],
    ["7-zip archive data, version 0.4", "archive"],
    ["gzip compressed data", "archive"],
    ["ISO 9660 CD-ROM filesystem data", "archive"],
  ])("reads %j as %s", (text, expected) => {
    expect(described(text)).toBe(expected);
  });

  it("is undefined for a description it cannot place", () => {
    expect(described("data")).toBeUndefined();
    expect(described("ASCII text")).toBeUndefined();
    // "self" contains "elf" but is not a word boundary away from it.
    expect(described("self-describing blob")).toBeUndefined();
  });

  it("takes the first description that places it", () => {
    expect(described("data", "PE32 executable", "PDF document")).toBe("exe");
  });
});

describe("fileFormatOf, from a file name", () => {
  it.each([
    ["setup.EXE", "exe"],
    ["kernel32.dll", "exe"],
    ["installer.msi", "exe"],
    ["libc.so", "elf"],
    ["bot.elf", "elf"],
    ["banking.apk", "apk"],
    ["invoice.pdf", "doc"],
    ["report.docm", "doc"],
    ["sheet.xlsx", "doc"],
    ["run.ps1", "script"],
    ["dropper.js", "script"],
    ["start.bat", "script"],
    ["install.sh", "script"],
    ["payload.zip", "archive"],
    ["payload.7z", "archive"],
    ["lib.jar", "archive"],
  ])("reads %j as %s", (name, expected) => {
    expect(named(name)).toBe(expected);
  });

  it("is undefined without a recognisable extension", () => {
    expect(named("README")).toBeUndefined();
    expect(named("notes.txt")).toBeUndefined();
    expect(named("")).toBeUndefined();
  });

  it("takes the first name that places it", () => {
    expect(named("sample", "notes.txt", "x.vbs", "y.exe")).toBe("script");
  });
});

describe("fileFormatOf, both kinds of evidence", () => {
  it("prefers the description over the name", () => {
    expect(fileFormatOf({ descriptions: ["PE32 executable"], names: ["invoice.pdf"] })).toBe("exe");
  });

  it("lets a name say what is inside an archive", () => {
    expect(fileFormatOf({ descriptions: ["Zip archive data"], names: ["report.docx"] })).toBe("doc");
    expect(fileFormatOf({ descriptions: ["Zip archive data"], names: ["app.apk"] })).toBe("apk");
  });

  it("keeps the archive when the name adds nothing", () => {
    expect(fileFormatOf({ descriptions: ["Zip archive data"], names: ["blob"] })).toBe("archive");
  });

  it("falls back to the name when the description places nothing", () => {
    expect(fileFormatOf({ descriptions: ["data"], names: ["a.rar"] })).toBe("archive");
  });

  it("is undefined with no evidence", () => {
    expect(fileFormatOf({ descriptions: [], names: [] })).toBeUndefined();
  });
});
