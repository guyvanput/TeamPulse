import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { rootCertificates } from "node:tls";

if (process.platform !== "win32") throw new Error("This operator backup uses Windows DPAPI CurrentUser protection.");
const value = process.env.DATABASE_URL_UNPOOLED;
if (!value) throw new Error("DATABASE_URL_UNPOOLED is required; no pooled or local fallback is used.");
const url = new URL(value);
if (url.protocol !== "postgresql:" || !url.hostname.endsWith(".neon.tech") ||
  url.pathname !== "/teampulse" || url.hostname.includes("-pooler.")) {
  throw new Error("Expected the pilot's direct Neon teampulse connection.");
}
const host = process.env.PILOT_BACKUP_HOST;
if (!host || url.hostname !== host) throw new Error("Set PILOT_BACKUP_HOST to the explicitly approved direct Neon hostname.");
const directory = resolve(".local", "backups");
await mkdir(directory, { recursive: true, mode: 0o700 });
function run(file: string, args: string[], input?: Buffer | string, env = process.env) {
  const result = spawnSync(file, args, { input, env, maxBuffer: 128 * 1024 * 1024, stdio: "pipe" });
  if (result.error) throw new Error(`${file} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${file} failed (exit ${result.status}). Output withheld to protect backup contents and credentials.`);
  return result.stdout;
}
function powershell(script: string, input?: Buffer | string) {
  return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop'; ${script}`], input);
}
const sid = powershell("[Security.Principal.WindowsIdentity]::GetCurrent().User.Value").toString().trim();
if (!/^S-\d(-\d+)+$/.test(sid)) throw new Error("Cannot determine the current Windows identity.");
run("icacls.exe", [directory, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`]);
const certificates = join(directory, "trusted-roots.pem");
await writeFile(certificates, rootCertificates.join("\n"), { mode: 0o600 });
const binary = (name: string) => join(process.env.PG_BIN ?? resolve(".tools", "pgsql", "bin"), `${name}.exe`);
const env = {
  ...process.env, PGHOST: url.hostname, PGPORT: url.port || "5432",
  PGDATABASE: "teampulse", PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: "verify-full",
  PGSSLROOTCERT: certificates, PGCONNECT_TIMEOUT: "30"
};
const raw = run(binary("pg_dump"), ["--format=custom", "--no-owner", "--no-acl"], undefined, env);
run(binary("pg_restore"), ["--list"], raw);
const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const encrypted = Buffer.from(powershell(
  "Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); " +
  "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))",
  raw.toString("base64")
).toString().trim(), "base64");
const name = `teampulse-${Date.now()}-${randomUUID()}`;
const archive = join(directory, `${name}.dpapi`);
await writeFile(archive, encrypted, { mode: 0o600, flag: "wx" });
const decrypted = Buffer.from(powershell(
  "Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); " +
  "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))",
  (await readFile(archive)).toString("base64")
).toString().trim(), "base64");
assert.equal(digest(decrypted), digest(raw), "Encrypted backup round-trip mismatch.");
run(binary("pg_restore"), ["--list"], decrypted);
const metadata = {
  createdAt: new Date().toISOString(), archiveSha256: digest(encrypted),
  contentSha256: digest(raw), encryptedBytes: encrypted.length,
  protection: "Windows DPAPI CurrentUser plus current-user-only directory ACL",
  retentionDays: 7, verified: "Decrypted round-trip checksum and pg_restore archive listing; no production restore."
};
await writeFile(join(directory, `${name}.json`), JSON.stringify(metadata, null, 2), { mode: 0o600, flag: "wx" });
const cutoff = Date.now() - 7 * 86_400_000;
let removed = 0;
for (const file of await readdir(directory)) {
  const match = /^(teampulse-(\d+)-[a-f0-9-]{36})\.json$/.exec(file);
  if (!match || Number(match[2]) >= cutoff) continue;
  const previous = JSON.parse(await readFile(join(directory, file), "utf8"));
  const createdAt = Date.parse(previous.createdAt);
  if (!Number.isFinite(createdAt)) throw new Error("An existing backup has invalid retention metadata; no further archives were removed.");
  if (previous.retentionDays !== 7 || createdAt >= cutoff) continue;
  const previousArchive = join(directory, `${match[1]}.dpapi`);
  assert.equal(digest(await readFile(previousArchive)), previous.archiveSha256,
    "An expired backup was modified; refusing to remove it.");
  await unlink(previousArchive);
  await unlink(join(directory, file));
  removed++;
}
console.info(JSON.stringify({ result: "passed", ...metadata, expiredArchivesRemoved: removed }, null, 2));
console.info(`Encrypted pilot backup: ${archive}`);
console.info("Operator-run policy: run on each day of pilot use and before releases. Keep Windows profile recovery available; this archive cannot be decrypted by another account or machine.");
