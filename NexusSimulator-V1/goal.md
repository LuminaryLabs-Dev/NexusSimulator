# Durable Product Goal

This file owns the long-term product outcome and acceptance criteria. Current execution state and the next bounded task are tracked in `../.agent/goal.md` and its active goal packet.

Build a reusable procedural world-asset library through bounded Codex planning, critique, revision, algorithm search, seed search, failure filtering, confidence promotion, and durable lessons.

Acceptance criteria:

- Every asset is custom indexed wound-triangle geometry.
- Rejected candidates remain auditable and never enter the promoted library.
- Runtime validation covers normals, winding, degenerates, lighting, placement, silhouette, and performance.
- NexusEngine terrain streaming passes coverage plus shared-edge height and normal checks before browser capture starts.
- Banded terrain, object import, and grounding contracts from NexusEngine-ProtoKits pass before generated assets enter the world.
- The promoted library populates only validated streamed chunks; no unvalidated terrain is loaded or recorded.
- A real-time 60-second proof inspects assets individually and then follows the validated streaming path through the populated world.
