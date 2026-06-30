export const humanInteractionSupports = [
  "observe",
  "detectInteractions",
  "chooseInteraction",
  "checkpoint",
  "summarize",
  "escape",
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultInteractions(mode) {
  if (mode === "task") {
    return ["select required target", "fill required input", "submit primary action", "verify visible result"];
  }
  if (mode === "soak") {
    return ["observe responsiveness", "repeat safe interaction", "checkpoint visible state"];
  }
  return ["inspect visible controls", "try primary action", "try secondary action", "observe result"];
}

export function createHumanInteractionAdapter() {
  const id = "human-interaction";
  const type = "human";
  const surface = "controller";
  let state;

  function reset() {
    state = {
      availableInteractions: [],
      checkpoints: [],
      chosenInteractions: [],
      escapeReason: null,
      events: [],
      goal: null,
      logs: [],
      mode: "explore",
      observations: [],
      status: "running",
      summary: "",
    };
  }

  function log(message) {
    state.logs.push(message);
  }

  function post(event) {
    state.events.push(clone(event));
    const args = event.args ?? {};

    switch (event.command) {
      case "observe": {
        const observation = {
          note: args.note ?? args.text ?? "observed surface state",
          surface: args.surface ?? "unknown",
        };
        state.observations.push(observation);
        log(`observed ${observation.surface}`);
        return;
      }
      case "detectInteractions": {
        const mode = args.mode ?? state.mode;
        const interactions = Array.isArray(args.interactions) && args.interactions.length
          ? args.interactions
          : defaultInteractions(mode);
        state.availableInteractions = interactions.map((interaction) =>
          typeof interaction === "string" ? { label: interaction } : clone(interaction),
        );
        log(`detected ${state.availableInteractions.length} interactions`);
        return;
      }
      case "chooseInteraction": {
        state.mode = args.mode ?? state.mode;
        state.goal = args.goal ?? state.goal;
        if (!state.availableInteractions.length) {
          state.availableInteractions = defaultInteractions(state.mode).map((label) => ({ label }));
        }
        const index = Math.max(0, Math.min(Number(args.index ?? 0), state.availableInteractions.length - 1));
        const chosen = {
          goal: state.goal,
          interaction: clone(state.availableInteractions[index]),
          reason: args.reason ?? "next useful human-like action",
          suggestedEvent: args.suggestedEvent ? clone(args.suggestedEvent) : null,
        };
        state.chosenInteractions.push(chosen);
        log(`chose interaction: ${chosen.interaction.label ?? JSON.stringify(chosen.interaction)}`);
        return;
      }
      case "checkpoint": {
        const checkpoint = {
          name: args.name ?? `checkpoint-${state.checkpoints.length + 1}`,
          note: args.note ?? "",
        };
        state.checkpoints.push(checkpoint);
        log(`checkpoint ${checkpoint.name}`);
        return;
      }
      case "summarize": {
        state.summary = args.text ?? [
          `mode=${state.mode}`,
          `goal=${state.goal ?? "none"}`,
          `observations=${state.observations.length}`,
          `choices=${state.chosenInteractions.length}`,
          `escape=${state.escapeReason ?? "none"}`,
        ].join(" ");
        if (!state.escapeReason) state.status = "completed";
        log("summarized human interaction loop");
        return;
      }
      case "escape": {
        state.escapeReason = args.reason ?? "explicit escape";
        state.status = "escaped";
        log(`escape: ${state.escapeReason}`);
        return;
      }
      default:
        throw new Error(`human-interaction-simtime does not know how to post command "${event.command}".`);
    }
  }

  function getState() {
    return clone(state);
  }

  function getOutput() {
    return clone({
      availableInteractions: state.availableInteractions,
      checkpoints: state.checkpoints,
      chosenInteractions: state.chosenInteractions,
      escapeReason: state.escapeReason,
      goal: state.goal,
      logs: state.logs,
      mode: state.mode,
      observations: state.observations,
      simtime: id,
      status: state.status,
      summary: state.summary,
    });
  }

  reset();

  return {
    id,
    type,
    surface,
    label: "human-interaction-simtime",
    supports: humanInteractionSupports,
    post,
    getOutput,
    getState,
    reset,
  };
}
