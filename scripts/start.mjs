import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
if (!existsSync(path.join(standalone, "server.js"))) {
  console.error("Standalone build is missing. Run `npm run build` first.");
  process.exit(1);
}

await rm(path.join(standalone, "public"), { recursive: true, force: true });
await rm(path.join(standalone, ".next", "static"), { recursive: true, force: true });
await mkdir(path.join(standalone, ".next"), { recursive: true });
await cp(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
await cp(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });

const child = spawn(process.execPath, [path.join(standalone, "server.js")], {
  cwd: standalone,
  stdio: "inherit",
  env: {
    ...process.env,
    HOSTNAME: process.env.HOSTNAME || "0.0.0.0",
    PORT: process.env.PORT || "3000"
  }
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  process.exitCode = signal ? 0 : (code ?? 1);
});
