#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const envPath = process.argv[2] ?? ".env";
const keyName = "MO_DEVFLOW_GITHUB_WEBHOOK_SECRET";
const minimumSecretLength = 20;

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
  if (activeValue.length < minimumSecretLength) {
    console.error(`${keyName} is set in ${envPath}, but it is too short for a GitHub webhook secret.`);
    console.error("Use at least 20 random characters; local setup can regenerate it after you clear the value.");
    process.exit(1);
  }
  console.log(`${keyName} already configured in ${envPath}.`);
  process.exit(0);
}

const generatedLine = `${keyName}=${randomBytes(32).toString("hex")}`;
if (activeIndex >= 0) {
  lines[activeIndex] = generatedLine;
} else if (commentedIndex >= 0) {
  lines[commentedIndex] = generatedLine;
} else {
  if (lines.length > 0 && lines[lines.length - 1] !== "") {
    lines.push("");
  }
  lines.push("# Local-only secret for signed GitHub webhook deliveries.");
  lines.push(generatedLine);
}

writeFileSync(envPath, lines.join("\n"), "utf8");
console.log(`Generated ${keyName} in ${envPath}. Keep this file out of git.`);
