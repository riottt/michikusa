import { readFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import { HarnessError } from "./contracts.mjs";

const schemaNames = ["plan", "implementation", "review", "state"];

async function parseJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new HarnessError(`${label} is missing or invalid JSON: ${filePath}`, {
      nextActions: [`Restore ${label.toLowerCase()} before retrying.`],
      artifacts: [filePath],
    });
  }
}

export async function loadHarnessConfig(repoRoot) {
  const filePath = path.join(repoRoot, ".codex", "harness", "config.json");
  const config = await parseJson(filePath, "Harness config");
  const validCommands = config.verification_commands
    && typeof config.verification_commands === "object"
    && Object.values(config.verification_commands).every((command) => command
      && typeof command.executable === "string"
      && command.executable.length > 0
      && Array.isArray(command.args)
      && command.args.every((argument) => typeof argument === "string"));
  const valid = config.version === 1
    && config.runtime_directory === ".codex/harness/runtime"
    && config.logs_directory === ".codex/harness/logs"
    && config.automatic_agent_execution === false
    && JSON.stringify(config.roles) === JSON.stringify({ plan: "planner", implementation: "implementer", review: "reviewer" })
    && JSON.stringify(config.schemas) === JSON.stringify({
      plan: ".codex/harness/schemas/plan.schema.json",
      implementation: ".codex/harness/schemas/implementation.schema.json",
      review: ".codex/harness/schemas/review.schema.json",
      state: ".codex/harness/schemas/state.schema.json",
    })
    && validCommands
    && JSON.stringify(config.output_contract) === JSON.stringify(["status", "summary", "next_actions", "artifacts"]);
  if (!valid) {
    throw new HarnessError("Harness config has drifted from the supported contract.", {
      nextActions: ["Restore .codex/harness/config.json and its planner/implementer/reviewer role mapping."],
      artifacts: [path.relative(repoRoot, filePath)],
    });
  }
  return config;
}

export async function compileSchemas(repoRoot, config = undefined) {
  const resolvedConfig = config ?? await loadHarnessConfig(repoRoot);
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  const validators = {};
  for (const name of schemaNames) {
    const schemaPath = path.join(repoRoot, resolvedConfig.schemas[name]);
    const schema = await parseJson(schemaPath, `${name} schema`);
    try {
      validators[name] = ajv.compile(schema);
    } catch (error) {
      throw new HarnessError(`${name} schema could not be compiled: ${error.message}`, {
        nextActions: [`Repair ${resolvedConfig.schemas[name]}.`],
        artifacts: [resolvedConfig.schemas[name]],
      });
    }
  }
  return validators;
}

export async function validateAgainstSchema(repoRoot, name, document) {
  const validators = await compileSchemas(repoRoot);
  const validate = validators[name];
  if (!validate(document)) {
    const details = validate.errors?.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
    throw new HarnessError(`${name} artifact failed schema validation: ${details}`, {
      nextActions: [`Update the artifact to match .codex/harness/schemas/${name}.schema.json.`],
    });
  }
  return document;
}
