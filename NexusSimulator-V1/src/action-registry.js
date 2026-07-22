import * as z from "zod/v4";

function jsonSchema(schema) {
  return z.toJSONSchema(schema);
}

export function createActionRegistry() {
  const actions = new Map();

  function register(descriptor) {
    if (!descriptor?.id || typeof descriptor.handler !== "function") {
      throw new TypeError("Action descriptors require id and handler.");
    }
    if (typeof descriptor.inputSchema?.parse !== "function" || typeof descriptor.outputSchema?.parse !== "function") {
      throw new TypeError(`Action "${descriptor.id}" requires Zod input and output schemas.`);
    }
    if (actions.has(descriptor.id)) throw new Error(`Duplicate action id "${descriptor.id}".`);
    actions.set(descriptor.id, Object.freeze({
      description: "",
      safety: { destructive: false, mutatesWorld: false, readOnly: true, replayable: true, rollback: "snapshot" },
      ...descriptor,
    }));
    return descriptor;
  }

  function get(id) {
    const action = actions.get(id);
    if (!action) {
      const error = new Error(`Unknown action "${id}".`);
      error.code = "UNKNOWN_ACTION";
      throw error;
    }
    return action;
  }

  async function dispatch(id, input, context = {}) {
    const action = get(id);
    const parsedInput = action.inputSchema?.parse ? action.inputSchema.parse(input) : input;
    const result = await action.handler(parsedInput, context);
    return action.outputSchema?.parse ? action.outputSchema.parse(result) : result;
  }

  function manifests() {
    return [...actions.values()].map((action) => ({
      description: action.description,
      id: action.id,
      inputSchema: jsonSchema(action.inputSchema),
      outputSchema: jsonSchema(action.outputSchema),
      safety: action.safety,
      title: action.title ?? action.id,
    })).sort((left, right) => left.id.localeCompare(right.id));
  }

  return Object.freeze({ dispatch, get, manifests, register });
}
