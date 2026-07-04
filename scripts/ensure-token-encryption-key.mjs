#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const envPath = process.argv[2] ?? ".env";
const keyName = "MO_DEVFLOW_TOKEN_ENCRYPTION_KEY";

if (!existsSync(envPath)) {
  console.error(`${envPath} does not exist. Run make setup to create it first.`);
  process.exit(1);
}

const content = readFileSync(envPath, "utf8");
const lines = content.split(/\r?\n/);

let activeIndex = -1;
let activeValue = "";
let commentedIndex = -1;

for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index] ?? "";
  const activeMatch = line.match(new RegExp(`^\\s*${keyName}\\s*=\\s*(.*)$`));
  if (activeMatch) {
    activeIndex = index;
    activeValue = activeMatch[1]?.trim() ?? "";
    break;
  }
  if (commentedIndex === -1 && line.match(new RegExp(`^\\s*#\\s*${keyName}\\s*=`))) {
    commentedIndex = index;
  }
}

if (activeValue) {
  if (!isValidKey(activeValue)) {
    console.error(`${keyName} is set in ${envPath}, but it is not a 32-byte base64 or 64-character hex key.`);
    console.error("Generate a replacement with: openssl rand -base64 32");
    process.exit(1);
  }
  console.log(`${keyName} already configured in ${envPath}.`);
  process.exit(0);
}

const generatedLine = `${keyName}=${randomBytes(32).toString("base64")}`;
if (activeIndex >= 0) {
  lines[activeIndex] = generatedLine;
} else if (commentedIndex >= 0) {
  lines[commentedIndex] = generatedLine;
} else {
  if (lines.length > 0 && lines[lines.length - 1] !== "") {
    lines.push("");
  }
  lines.push("# Local-only key for encrypted personal GitHub tokens.");
  lines.push(generatedLine);
}

writeFileSync(envPath, lines.join("\n"), "utf8");
console.log(`Generated ${keyName} in ${envPath}. Keep this file out of git.`);

function isValidKey(raw) {
  const value = raw.startsWith("base64:") || raw.startsWith("hex:") ? raw.slice(raw.indexOf(":") + 1) : raw;
  const encoding = raw.startsWith("hex:") || /^[a-f0-9]{64}$/i.test(raw) ? "hex" : "base64";
  return Buffer.from(value, encoding).length === 32;
}
