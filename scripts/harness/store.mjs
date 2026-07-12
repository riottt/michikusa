import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";

import { HarnessError, validateState } from "./contracts.mjs";
import { validateAgainstSchema } from "./schema.mjs";

export const runtimeDirectory = (repoRoot) => path.join(repoRoot, ".codex", "harness", "runtime");
export const taskDirectory = (repoRoot, slug) => path.join(runtimeDirectory(repoRoot), slug);
export const stateFile = (repoRoot, slug) => path.join(taskDirectory(repoRoot, slug), "state.json");

function assertLexicallyInside(repoRoot, targetPath) {
  const relative = path.relative(path.resolve(repoRoot), path.resolve(targetPath));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new HarnessError(`Harness write path is outside the repository: ${targetPath}`);
  }
  return relative;
}

async function ensureSafeDirectory(repoRoot, directoryPath) {
  const relative = assertLexicallyInside(repoRoot, directoryPath);
  const repositoryRealPath = await realpath(repoRoot);
  let current = repositoryRealPath;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new HarnessError(`Harness runtime directory is a symlink or not a directory: ${current}`, {
          nextActions: ["Remove the unsafe runtime path and recreate it as a normal directory."],
        });
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      try {
        await mkdir(current);
      } catch (mkdirError) {
        if (mkdirError.code !== "EEXIST") throw mkdirError;
      }
      const created = await lstat(current);
      if (created.isSymbolicLink() || !created.isDirectory()) {
        throw new HarnessError(`Harness directory creation raced with an unsafe path: ${current}`);
      }
    }
  }
  const finalRealPath = await realpath(current);
  const boundary = path.relative(repositoryRealPath, finalRealPath);
  if (boundary.startsWith("..") || path.isAbsolute(boundary)) {
    throw new HarnessError(`Harness runtime real path escaped the repository: ${directoryPath}`);
  }
  return finalRealPath;
}

async function rejectUnsafeExistingFile(filePath) {
  try {
    const stat = await lstat(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new HarnessError(`Harness target is not a regular file: ${filePath}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export async function readJson(filePath, label = "JSON") {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new HarnessError(`${label} could not be read as valid JSON: ${filePath}`, {
      nextActions: ["Fix the JSON syntax or provide the correct file path."],
      artifacts: [filePath],
    });
  }
}

export async function readState(repoRoot, slug) {
  const state = await readJson(stateFile(repoRoot, slug), "State");
  await validateAgainstSchema(repoRoot, "state", state);
  return validateState(state);
}

export async function readRepositoryArtifact(repoRoot, artifactPath, label) {
  let repositoryRealPath;
  let artifactRealPath;
  try {
    repositoryRealPath = await realpath(repoRoot);
    artifactRealPath = await realpath(path.resolve(repoRoot, artifactPath));
  } catch {
    throw new HarnessError(`${label} path does not exist or cannot be resolved.`, {
      nextActions: ["Place the JSON file in .codex/harness/inbox and retry with its repository-relative path."],
    });
  }
  const relative = path.relative(repositoryRealPath, artifactRealPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new HarnessError(`${label} real path is outside the repository.`, {
      nextActions: ["Copy the artifact into .codex/harness/inbox before accepting it."],
      artifacts: [artifactPath],
    });
  }
  return { document: await readJson(artifactRealPath, label), path: artifactRealPath };
}

export async function writeJsonAtomic(repoRoot, filePath, value) {
  const safeParent = await ensureSafeDirectory(repoRoot, path.dirname(filePath));
  const safeFilePath = path.join(safeParent, path.basename(filePath));
  await rejectUnsafeExistingFile(safeFilePath);
  const temporaryPath = `${safeFilePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx");
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    const verifiedParent = await ensureSafeDirectory(repoRoot, path.dirname(filePath));
    if (verifiedParent !== safeParent) throw new HarnessError("Harness directory changed during atomic write.");
    await rejectUnsafeExistingFile(safeFilePath);
    await rename(temporaryPath, safeFilePath);
  } finally {
    await handle?.close();
    await rm(temporaryPath, { force: true });
  }
}

export async function withTaskLock(repoRoot, slug, operation) {
  const directory = taskDirectory(repoRoot, slug);
  const safeDirectory = await ensureSafeDirectory(repoRoot, directory);
  const lockPath = path.join(safeDirectory, ".lock");
  let handle;
  try {
    handle = await open(lockPath, "wx");
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new HarnessError(`Task ${slug} is locked by another running harness command.`, {
        nextActions: ["Wait for the other command to finish; remove the lock only after confirming no process is active."],
        artifacts: [lockPath],
      });
    }
    throw error;
  }
  try {
    return await operation();
  } finally {
    await handle?.close();
    await rm(lockPath, { force: true });
  }
}

export async function persistArtifact(repoRoot, slug, phase, document) {
  const filePath = path.join(taskDirectory(repoRoot, slug), "artifacts", `${phase}.json`);
  await writeJsonAtomic(repoRoot, filePath, document);
  return path.relative(repoRoot, filePath);
}

export async function persistReceipt(repoRoot, slug, iteration, stage, receipt) {
  const filePath = path.join(taskDirectory(repoRoot, slug), "receipts", String(iteration), `${stage}.json`);
  await writeJsonAtomic(repoRoot, filePath, receipt);
  return path.relative(repoRoot, filePath);
}
