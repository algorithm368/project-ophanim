/**
 * A small dictionary of common Windows DLLs -> what they are for, so a file's
 * imported libraries read as capabilities ("ws2_32 = networking") instead of
 * opaque names. Keyed by lowercased base name without the `.dll` suffix.
 *
 * `common` flags the ubiquitous boilerplate DLLs (CRT, UI, COM base) that almost
 * every program loads: they still get a definition, but rank below the
 * capability-revealing libraries so the interesting ones surface first.
 */
interface DllEntry {
  note: string;
  common?: boolean;
}

const DLL_DICTIONARY: Record<string, DllEntry> = {
  // Networking / communication
  ws2_32: { note: "Winsock, network sockets" },
  wsock32: { note: "Winsock (legacy), network sockets" },
  mswsock: { note: "Winsock service provider" },
  wininet: { note: "HTTP/FTP client (WinINet)" },
  winhttp: { note: "HTTP client (WinHTTP)" },
  urlmon: { note: "URL downloads (URLMon)" },
  dnsapi: { note: "DNS resolution" },
  iphlpapi: { note: "IP helper, network configuration" },
  netapi32: { note: "network / SMB shares & sessions" },
  ws2help: { note: "Winsock helper" },
  wsdapi: { note: "web services / discovery" },

  // Cryptography / security
  crypt32: { note: "certificates, X.509, CryptoAPI" },
  bcrypt: { note: "CNG cryptography" },
  bcryptprimitives: { note: "crypto primitives" },
  ncrypt: { note: "CNG key storage / DPAPI-NG" },
  cryptsp: { note: "crypto service provider" },
  rsaenh: { note: "RSA/AES crypto provider" },
  secur32: { note: "SSPI authentication (NTLM/Kerberos)" },
  sspicli: { note: "SSPI client" },
  schannel: { note: "TLS/SSL (Schannel)" },
  wintrust: { note: "code-signing / trust verification" },
  wldap32: { note: "LDAP / Active Directory" },
  samlib: { note: "SAM account database" },
  vaultcli: { note: "Windows Credential Vault" },
  credui: { note: "credential prompt UI" },
  feclient: { note: "Encrypting File System (EFS) client" },

  // Native / process / memory
  ntdll: { note: "native API / syscall layer" },
  kernel32: { note: "core Win32: process, memory, files", common: true },
  kernelbase: { note: "core Win32 base", common: true },
  psapi: { note: "process / memory enumeration" },
  dbghelp: { note: "debugging, symbols, memory dumps" },
  userenv: { note: "user profile / environment" },
  wtsapi32: { note: "terminal-services sessions" },
  advapi32: { note: "registry, services, tokens, CryptoAPI" },

  // Shell / COM / automation
  shell32: { note: "shell ops, ShellExecute, file ops" },
  shlwapi: { note: "shell path utilities" },
  ole32: { note: "COM / OLE" },
  oleaut32: { note: "OLE automation (BSTR/variant), COM" },
  combase: { note: "COM base", common: true },
  propsys: { note: "property system" },
  activeds: { note: "Active Directory scripting" },

  // Scripting
  vbscript: { note: "VBScript engine" },
  jscript: { note: "JScript engine" },
  scrrun: { note: "Script Runtime (FileSystemObject)" },
  wshom: { note: "Windows Script Host objects" },

  // Data / stealer-relevant
  sqlite3: { note: "SQLite (browser databases)" },
  winsqlite3: { note: "SQLite (Windows)" },
  nss3: { note: "Mozilla NSS (Firefox secrets)" },
  mozglue: { note: "Firefox runtime" },

  // Anti-analysis
  sbiedll: { note: "Sandboxie (probed for evasion)" },

  // UI / runtime boilerplate (common)
  user32: { note: "windows, input, messages", common: true },
  gdi32: { note: "graphics (GDI)", common: true },
  gdiplus: { note: "graphics (GDI+)", common: true },
  comctl32: { note: "common controls (UI)", common: true },
  comdlg32: { note: "common dialogs", common: true },
  uxtheme: { note: "visual themes", common: true },
  imm32: { note: "input method (IME)", common: true },
  msctf: { note: "text services", common: true },
  winmm: { note: "multimedia (timers, audio)", common: true },
  version: { note: "file version info", common: true },
  msvcrt: { note: "C runtime", common: true },
  ucrtbase: { note: "Universal C runtime", common: true },
  vcruntime140: { note: "MSVC runtime", common: true },
  rpcrt4: { note: "RPC runtime", common: true },
  sechost: { note: "service host base", common: true },
  clbcatq: { note: "COM+ catalog", common: true },
  apphelp: { note: "app-compat shim", common: true },
  profapi: { note: "user profile API", common: true },
};

/** Normalize a DLL reference (path, casing, `.dll`) to a dictionary key. */
export function dllKey(name: string): string {
  return name
    .replace(/^.*[\\/]/, "")
    .replace(/\.dll$/i, "")
    .trim()
    .toLowerCase();
}

/** Plain-language description of a DLL, or undefined if it is not in the dictionary. */
export function describeDll(name: string): string | undefined {
  return DLL_DICTIONARY[dllKey(name)]?.note;
}

/**
 * Display rank: capability-revealing known DLLs (0) before ubiquitous boilerplate
 * (1) before unknown libraries (2). Lets the imports readout lead with signal.
 */
export function dllRank(name: string): 0 | 1 | 2 {
  const entry = DLL_DICTIONARY[dllKey(name)];
  if (!entry) return 2;
  return entry.common ? 1 : 0;
}
