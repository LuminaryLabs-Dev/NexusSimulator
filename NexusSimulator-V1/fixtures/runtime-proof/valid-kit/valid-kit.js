export function createKit() {
  return Object.freeze({
    id: "n-runtime-fixture-kit",
    components: {},
    resources: {},
    events: {},
    systems: [],
    shaders: [],
    materials: [],
    sequences: [],
    subscriptions: [],
    sequenceNodes: [],
    sequenceNodeTypes: [],
    sequenceNodeSubscriptions: [],
    sequenceNodeOptions: {},
    requires: [],
    provides: ["n:runtime-fixture", "n:runtime-fixture:accepted"],
    bindings: {},
    metadata: Object.freeze({
      kind: "domain-service-kit",
      domain: "runtime-fixture",
      domainPath: "n:runtime-fixture",
      apiName: "runtimeFixture",
      version: "0.1.0",
      stability: "experimental",
      resetPolicy: "clear-applied-input-ids",
      snapshotPolicy: "serialize-applied-input-ids"
    })
  });
}

export function createProofAdapter() {
  let applied = [];
  return {
    async handle(input) {
      if (applied.includes(input.id)) return { duplicateIgnored: true, id: input.id };
      applied.push(input.id);
      return { event: "accepted", id: input.id };
    },
    async snapshot() {
      return { applied: [...applied] };
    },
    async loadSnapshot(snapshot) {
      applied = [...(snapshot?.applied ?? [])];
    },
    async reset() {
      applied = [];
    }
  };
}
