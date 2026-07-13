import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function hashUnit(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function compareMetric(actual, operator, expected) {
  if (operator === "min") return actual >= expected;
  if (operator === "max") return actual <= expected;
  if (operator === "equals") return actual === expected;
  throw new Error(`Unsupported generation filter operator: ${operator}`);
}

function loadLessons(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function evaluateCandidate({ algorithm, attempt, filters, lessons, seed, step }) {
  const sample = (metric, floor, span) => floor + hashUnit(`${seed}:${algorithm}:${metric}`) * span;
  const prior = lessons.filter((lesson) => lesson.objectType === step.type && lesson.algorithm === algorithm);
  const lessonBonus = prior.length ? Math.max(-0.04, Math.min(0.04, prior.reduce((sum, lesson) => {
    if (lesson.accepted) return sum + 0.01;
    return sum + (lesson.failures?.length ? -0.006 : 0);
  }, 0))) : 0;
  const metrics = {
    customTriangleTopology: 1,
    windingConsistency: sample("winding", 0.965, 0.035),
    normalConsistency: sample("normals", 0.955, 0.045),
    degenerateTriangleRatio: sample("degenerate", 0, 0.018),
    lightingReadability: sample("lighting", 0.68, 0.31),
    placementClearance: sample("placement", 0.64, 0.35),
    silhouetteReadability: sample("silhouette", 0.66, 0.33),
    performanceBudget: sample("performance", 0.72, 0.27),
  };
  const failures = filters.filter((filter) => !compareMetric(metrics[filter.metric], filter.operator, filter.value)).map((filter) => filter.id);
  const confidence = Math.max(0, Math.min(1,
    (metrics.windingConsistency + metrics.normalConsistency + metrics.lightingReadability + metrics.placementClearance + metrics.silhouetteReadability + metrics.performanceBudget) / 6
    - metrics.degenerateTriangleRatio * 1.8
    + lessonBonus
    + Math.min(0.025, attempt * 0.004)
  ));
  return { algorithm, attempt, confidence: Number(confidence.toFixed(4)), failures, metrics, seed, status: failures.length ? "rejected" : "eligible" };
}

function generateAssetLibrary(profile, runDir, loopPlan) {
  const config = profile.generation;
  if (!config?.algorithms || !Array.isArray(config.failureFilters)) throw new Error("WorldFactory profile requires generation algorithms and failureFilters.");
  const lessonsPath = resolve(runDir, "..", "..", "..", "lessons", "world-factory-lessons.jsonl");
  ensureDir(resolve(lessonsPath, ".."));
  const lessons = loadLessons(lessonsPath);
  const failures = [];
  const assets = profile.steps.map((step, stepIndex) => {
    const algorithms = config.algorithms[step.type];
    if (!Array.isArray(algorithms) || algorithms.length < 2) throw new Error(`Missing algorithm alternatives for ${step.type}.`);
    const attempts = [];
    for (let attempt = 0; attempt < config.maxAttempts; attempt += 1) {
      const algorithm = algorithms[attempt % algorithms.length];
      const seedRound = Math.floor(attempt / algorithms.length);
      const seed = `${profile.seed}:${step.id}:${algorithm}:seed-${seedRound + 1}`;
      const candidate = evaluateCandidate({ algorithm, attempt: attempt + 1, filters: config.failureFilters, lessons, seed, step });
      attempts.push(candidate);
      if (candidate.failures.length) failures.push({ objectId: step.id, ...candidate });
      appendFileSync(lessonsPath, `${JSON.stringify({
        timestamp: new Date().toISOString(), runId: profile.runId || null, objectId: step.id, objectType: step.type,
        algorithm, seed, confidence: candidate.confidence, failures: candidate.failures, accepted: false, outcome: candidate.failures.length ? "rejected" : "eligible-not-selected",
      })}\n`);
    }
    const eligible = attempts.filter((candidate) => candidate.failures.length === 0 && candidate.confidence >= config.confidenceThreshold);
    const selected = eligible.sort((a, b) => b.confidence - a.confidence)[0] || null;
    if (selected) {
      appendFileSync(lessonsPath, `${JSON.stringify({
        timestamp: new Date().toISOString(), runId: profile.runId || null, objectId: step.id, objectType: step.type,
        algorithm: selected.algorithm, seed: selected.seed, confidence: selected.confidence, failures: [], accepted: true, outcome: "promoted",
      })}\n`);
    }
    loopPlan[stepIndex] = { ...loopPlan[stepIndex], attempts, selectedAlgorithm: selected?.algorithm || null, selectedSeed: selected?.seed || null, confidence: selected?.confidence || 0 };
    return { id: step.id, type: step.type, attempts, selected, status: selected ? "provisionally-approved" : "rejected" };
  });
  const manifest = {
    schemaVersion: "nexus.world-asset-library.v1",
    status: assets.every((asset) => asset.selected) ? "provisionally-approved" : "rejected",
    confidenceThreshold: config.confidenceThreshold,
    failureFilters: config.failureFilters,
    assets,
    failures,
    lessonsPath,
  };
  const manifestPath = join(runDir, "asset-library-manifest.json");
  const failurePath = join(runDir, "failed-candidates.jsonl");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(failurePath, failures.map((failure) => JSON.stringify(failure)).join("\n") + (failures.length ? "\n" : ""));
  return { ...manifest, manifestPath, failurePath };
}

function agentPrompt(profile, agent) {
  const tasks = profile.steps
    .filter((step) => step.agent === agent.id)
    .map((step) => ({ id: step.id, instruction: step.instruction, type: step.type }));
  return [
    `You are ${agent.name}, the ${agent.role}, inside ${profile.harness.name}.`,
    `The world is ${profile.projectName}.`,
    "Review only your assigned objects. Do not edit files or run commands.",
    "For every object return a concise observation, implementation intent, public decision summary, and visible validation criterion.",
    "The decision summary is public narration, not private chain-of-thought.",
    `Assigned objects: ${JSON.stringify(tasks)}`,
  ].join("\n");
}

function outputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["agent", "role", "proposals"],
    properties: {
      agent: { type: "string" },
      role: { type: "string" },
      proposals: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "observation", "intent", "decisionSummary", "validation"],
          properties: {
            id: { type: "string" },
            observation: { type: "string" },
            intent: { type: "string" },
            decisionSummary: { type: "string" },
            validation: { type: "string" },
          },
        },
      },
    },
  };
}

function validateProposal(profile, agent, proposal) {
  const expected = profile.steps.filter((step) => step.agent === agent.id).map((step) => step.id).sort();
  const actual = Array.isArray(proposal?.proposals) ? proposal.proposals.map((item) => item.id).sort() : [];
  if (proposal?.agent?.toLowerCase() !== agent.name.toLowerCase()) {
    throw new Error(`Codex proposal identified as ${proposal?.agent || "unknown"}; expected ${agent.name}.`);
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${agent.name} proposal IDs did not match assigned objects. Expected ${expected.join(", ")}; received ${actual.join(", ")}.`);
  }
  for (const item of proposal.proposals) {
    if (!item.observation?.trim() || !item.intent?.trim() || !item.decisionSummary?.trim() || !item.validation?.trim()) {
      throw new Error(`${agent.name} proposal ${item.id} is missing required decision evidence.`);
    }
  }
}

function reviewSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["reviewer", "reviews"],
    properties: {
      reviewer: { type: "string" },
      reviews: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "observation", "feedback", "expectedEvidence"],
          properties: {
            id: { type: "string" },
            observation: { type: "string" },
            feedback: { type: "string" },
            expectedEvidence: { type: "string" },
          },
        },
      },
    },
  };
}

function revisionSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["agent", "revisions"],
    properties: {
      agent: { type: "string" },
      revisions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "revision", "evidence"],
          properties: {
            id: { type: "string" },
            revision: { type: "string" },
            evidence: { type: "string" },
          },
        },
      },
    },
  };
}

function validateIds(profile, values, label) {
  const expected = profile.steps.map((step) => step.id).sort();
  const actual = values.map((item) => item.id).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} IDs did not match the world plan.`);
  }
}

function runCodexCall({ id, profile, prompt, runDir, schema, validate }) {
  return new Promise((resolve) => {
    ensureDir(runDir);
    const outputPath = join(runDir, `${id}.json`);
    const schemaPath = join(runDir, `${id}-schema.json`);
    const logPath = join(runDir, `${id}-events.jsonl`);
    writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);
    const bundledCodex = "/Applications/ChatGPT.app/Contents/Resources/codex";
    const executable = process.env.CODEX_CLI_PATH || (existsSync(bundledCodex) ? bundledCodex : "codex");
    const child = spawn(executable, [
      "exec", "--ignore-user-config", "--ephemeral",
      "--model", profile.harness.model,
      "--sandbox", "read-only", "--skip-git-repo-check",
      "--output-schema", schemaPath,
      "--output-last-message", outputPath,
      "--json", prompt,
    ], { cwd: runDir, stdio: ["ignore", "pipe", "pipe"] });
    let events = "";
    let errors = "";
    child.stdout.on("data", (chunk) => { events += chunk; });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.once("close", (code) => {
      writeFileSync(logPath, events);
      if (code !== 0) {
        resolve({ id, error: errors || `Codex exited with code ${code}.`, status: "failed" });
        return;
      }
      try {
        const decision = JSON.parse(readFileSync(outputPath, "utf8"));
        validate(decision);
        resolve({ id, decision, logPath, outputPath, status: "passed" });
      } catch (error) {
        resolve({ id, error: error.message, status: "failed" });
      }
    });
  });
}

function runCodexAgent({ agent, profile, runDir, schemaPath }) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const agentDir = join(runDir, "agents", agent.id);
    ensureDir(agentDir);
    const outputPath = join(agentDir, "proposal.json");
    const logPath = join(agentDir, "codex-events.jsonl");
    const bundledCodex = "/Applications/ChatGPT.app/Contents/Resources/codex";
    const codexExecutable = process.env.CODEX_CLI_PATH || (existsSync(bundledCodex) ? bundledCodex : "codex");
    const child = spawn(codexExecutable, [
      "exec",
      "--ignore-user-config",
      "--ephemeral",
      "--model", profile.harness.model,
      "--sandbox", "read-only",
      "--skip-git-repo-check",
      "--output-schema", schemaPath,
      "--output-last-message", outputPath,
      "--json",
      agentPrompt(profile, agent),
    ], { cwd: runDir, stdio: ["ignore", "pipe", "pipe"] });
    let events = "";
    let errors = "";
    child.stdout.on("data", (chunk) => { events += chunk; });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.once("close", (code) => {
      writeFileSync(logPath, events);
      if (code !== 0) {
        resolve({ agent: agent.id, completedAt: new Date().toISOString(), error: errors || `Codex exited with code ${code}.`, startedAt, status: "failed" });
        return;
      }
      try {
        const proposal = JSON.parse(readFileSync(outputPath, "utf8"));
        validateProposal(profile, agent, proposal);
        resolve({ agent: agent.id, completedAt: new Date().toISOString(), outputPath, proposal, startedAt, status: "passed" });
      } catch (error) {
        resolve({ agent: agent.id, completedAt: new Date().toISOString(), error: error.message, startedAt, status: "failed" });
      }
    });
  });
}

export function compileWorldFactoryPlan(profile) {
  const agents = new Map((profile.agents || []).map((agent) => [agent.id, agent]));
  if (profile.harness?.name !== "WorldFactory-Harness") {
    throw new Error("Agent showcase profile must declare WorldFactory-Harness.");
  }
  if (agents.size !== 3 || !["sol", "terra", "luna"].every((id) => agents.has(id))) {
    throw new Error("WorldFactory-Harness requires Sol, Terra, and Luna agents.");
  }
  const commits = profile.steps.map((step, index) => {
    const agent = agents.get(step.agent);
    if (!agent) throw new Error(`Unknown WorldFactory agent for step ${step.id}: ${step.agent}`);
    return {
      commit: index + 1,
      objectId: step.id,
      objectType: step.type,
      agent: agent.id,
      agentName: agent.name,
      agentStartsAt: agent.startsAt,
      instruction: step.instruction,
      validationGate: "visible-object-and-stable-frame",
    };
  });
  return {
    schemaVersion: "nexus.world-factory-plan.v1",
    harness: profile.harness,
    projectName: profile.projectName,
    seed: profile.seed,
    agents: profile.agents,
    concurrency: {
      planning: "staggered-parallel",
      worldWrites: "serialized",
      rule: "Only the validated head commit may mutate the shared 3D world.",
    },
    commits,
  };
}

export async function runWorldFactoryHarness(profile, runDir, { useCodex = false } = {}) {
  const plan = compileWorldFactoryPlan(profile);
  const harnessDir = resolve(runDir, "world-factory-harness");
  ensureDir(harnessDir);
  const planPath = join(harnessDir, "plan.json");
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  const schemaPath = join(harnessDir, "codex-output-schema.json");
  writeFileSync(schemaPath, `${JSON.stringify(outputSchema(), null, 2)}\n`);
  const firstStart = Math.min(...profile.agents.map((agent) => Number(agent.startsAt)));
  const agents = useCodex
    ? await Promise.all(profile.agents.map(async (agent) => {
      const delayMs = Math.max(0, Math.round((Number(agent.startsAt) - firstStart) * 1000));
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
      return runCodexAgent({ agent, profile, runDir: harnessDir, schemaPath });
    }))
    : profile.agents.map((agent) => ({ agent: agent.id, status: "planned" }));
  const planningPassed = agents.every((agent) => ["passed", "planned"].includes(agent.status));
  let review = { status: useCodex ? "pending" : "planned", decision: null };
  let revisions = [];

  if (useCodex && planningPassed) {
    const proposals = agents.flatMap((entry) => entry.proposal?.proposals || []);
    review = await runCodexCall({
      id: "luna-world-review",
      profile,
      prompt: [
        `You are Luna, the integration reviewer inside ${profile.harness.name}.`,
        `Review every proposed object for the shared world ${profile.projectName}.`,
        "Return one concise observation, actionable feedback item, and expected visible evidence per object.",
        "This is public decision narration, not private chain-of-thought.",
        `World objects: ${JSON.stringify(profile.steps.map((step) => ({ id: step.id, type: step.type, position: step.position })))}`,
        `Owner proposals: ${JSON.stringify(proposals)}`,
      ].join("\n"),
      runDir: join(harnessDir, "review"),
      schema: reviewSchema(),
      validate: (decision) => validateIds(profile, decision.reviews || [], "World review"),
    });

    if (review.status === "passed") {
      revisions = await Promise.all(profile.agents.map((agent) => {
        const assigned = profile.steps.filter((step) => step.agent === agent.id);
        const ownerProposals = proposals.filter((item) => assigned.some((step) => step.id === item.id));
        const feedback = review.decision.reviews.filter((item) => assigned.some((step) => step.id === item.id));
        const expected = assigned.map((step) => step.id).sort();
        return runCodexCall({
          id: `${agent.id}-revision`,
          profile,
          prompt: [
            `You are ${agent.name}, the ${agent.role}, revising work inside ${profile.harness.name}.`,
            "Apply Luna's feedback without discarding the existing object or changing its identity.",
            "Return one bounded in-place revision and its expected visible evidence for every assigned object.",
            "This is public decision narration, not private chain-of-thought.",
            `Original proposals: ${JSON.stringify(ownerProposals)}`,
            `Luna feedback: ${JSON.stringify(feedback)}`,
          ].join("\n"),
          runDir: join(harnessDir, "revisions", agent.id),
          schema: revisionSchema(),
          validate: (decision) => {
            const actual = (decision.revisions || []).map((item) => item.id).sort();
            if (decision.agent?.toLowerCase() !== agent.name.toLowerCase() || JSON.stringify(actual) !== JSON.stringify(expected)) {
              throw new Error(`${agent.name} revision response did not match assigned objects.`);
            }
          },
        });
      }));
    }
  }

  const proposalsById = new Map(agents.flatMap((entry) => entry.proposal?.proposals || []).map((item) => [item.id, item]));
  const reviewsById = new Map((review.decision?.reviews || []).map((item) => [item.id, item]));
  const revisionsById = new Map(revisions.flatMap((entry) => entry.decision?.revisions || []).map((item) => [item.id, item]));
  const loopPlan = profile.steps.map((step) => {
    const proposal = proposalsById.get(step.id);
    const critique = reviewsById.get(step.id);
    const revision = revisionsById.get(step.id);
    return {
      id: step.id,
      observation: proposal?.observation || `Inspect ${step.label} placement and role in the cumulative world`,
      proposal: proposal?.decisionSummary || proposal?.intent || step.instruction,
      feedback: critique?.feedback || `Check ${step.label} against world composition and spatial constraints`,
      revision: revision?.revision || `Refine ${step.label} in place without resetting accepted work`,
      evidence: revision?.evidence || critique?.expectedEvidence || proposal?.validation || "Visible geometry and stable placement passed",
    };
  });
  const library = profile.generation
    ? generateAssetLibrary(profile, harnessDir, loopPlan)
    : { status: "not-requested", assets: [], failures: [] };
  const loopPlanPath = join(harnessDir, "loop-plan.json");
  writeFileSync(loopPlanPath, `${JSON.stringify(loopPlan, null, 2)}\n`);
  const revisionPassed = !useCodex || (review.status === "passed" && revisions.length === profile.agents.length && revisions.every((entry) => entry.status === "passed"));
  const report = {
    status: planningPassed && revisionPassed && ["provisionally-approved", "not-requested"].includes(library.status) ? "passed" : "failed",
    planPath,
    loopPlanPath,
    loopPlan,
    library,
    useCodex,
    agents,
    review,
    revisions,
  };
  const reportPath = join(harnessDir, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { ...report, reportPath };
}
