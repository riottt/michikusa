import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
}).split("\n").filter(Boolean).filter((file) =>
  !file.startsWith("public/presentation/")
  && !file.startsWith(".codex/harness/runtime/")
  && file !== ".env.local"
);

const patterns = [
  /AIza[0-9A-Za-z_-]{35}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /^(?:TURSO_AUTH_TOKEN|GOOGLE_OAUTH_CLIENT_SECRET)[ \t]*=[ \t]*[A-Za-z0-9_-]{32,}[ \t]*$/m,
];

const findings = [];
for (const file of files) {
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (source.includes("\0")) continue;
  if (patterns.some((pattern) => pattern.test(source))) findings.push(file);
}

if (findings.length > 0) {
  process.stderr.write(`Potential secret material found in: ${findings.join(", ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Secret scan passed.\n");
}
