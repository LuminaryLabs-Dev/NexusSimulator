export function createForestShowcaseHtml(profile) {
  const serialized = JSON.stringify(profile).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:,">
  <title>${profile.title} - ${profile.projectName}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #111816; color: #fff; font-family: Avenir Next, Avenir, Helvetica, Arial, sans-serif; }
    canvas { display: block; width: 100vw; height: 100vh; }
    .vignette { position: fixed; inset: 0; pointer-events: none; background: radial-gradient(circle at 51% 44%, transparent 48%, rgba(5, 9, 7, .38) 100%); }
    .intro, .asset-copy, .transition-copy, .completion { position: fixed; z-index: 2; pointer-events: none; opacity: 0; text-shadow: 0 3px 24px rgba(0,0,0,.72); }
    .intro { left: 64px; top: 58px; }
    .intro h1 { margin: 0; font-size: 60px; line-height: 1; letter-spacing: 0; }
    .intro p { margin: 13px 0 0; color: rgba(255,255,255,.82); font-size: 24px; letter-spacing: 0; }
    .intro .credit { margin-top: 9px; color: rgba(255,255,255,.58); font-size: 15px; }
    .asset-copy { left: 64px; bottom: 56px; max-width: 770px; padding-left: 18px; border-left: 3px solid #68d391; }
    .asset-copy .agent { margin: 0 0 7px; color: #8be7b4; font-size: 14px; font-weight: 800; text-transform: uppercase; letter-spacing: 0; }
    .asset-copy h2 { margin: 0; font-size: 32px; line-height: 1.08; letter-spacing: 0; }
    .asset-copy .phase { margin: 10px 0 0; color: rgba(255,255,255,.72); font: 700 14px/1.2 Menlo, Monaco, Consolas, monospace; letter-spacing: 0; }
    .transition-copy { inset: 0; display: grid; align-content: center; justify-content: center; text-align: center; }
    .transition-copy h2 { margin: 0; font-size: 48px; letter-spacing: 0; }
    .transition-copy p { margin: 13px 0 0; color: rgba(255,255,255,.72); font-size: 20px; letter-spacing: 0; }
    .completion { left: 64px; bottom: 56px; }
    .completion h2 { margin: 0; font-size: 42px; line-height: 1.05; letter-spacing: 0; }
    .completion p { margin: 12px 0 0; color: rgba(255,255,255,.8); font-size: 19px; letter-spacing: 0; }
    .world-type-control { position: fixed; z-index: 3; top: 46px; right: 48px; display: grid; gap: 7px; color: rgba(255,255,255,.68); font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0; }
    .world-type-control select { width: 190px; min-height: 40px; border: 1px solid rgba(255,255,255,.22); border-radius: 5px; padding: 0 12px; background: rgba(17,24,22,.88); color: #fff; font: 650 14px/1 Avenir Next, Avenir, Helvetica, Arial, sans-serif; letter-spacing: 0; }
    .world-type-control select:focus-visible { outline: 3px solid #68d391; outline-offset: 2px; }
    .world-type-control[hidden] { display: none; }
    .editor-panel { position: fixed; z-index: 4; inset: 0 0 0 auto; display: flex; width: 400px; flex-direction: column; overflow-y: auto; background: rgba(15,22,20,.97); border-left: 1px solid rgba(255,255,255,.13); color: #eef4f0; box-shadow: -18px 0 42px rgba(0,0,0,.24); }
    .editor-panel[hidden] { display: none; }
    .editor-header, .editor-section, .editor-actions { padding: 18px 22px; border-bottom: 1px solid rgba(255,255,255,.1); }
    .editor-header { padding-top: 22px; }
    .editor-kicker { margin: 0 0 6px; color: #77dfa5; font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .editor-header h1 { margin: 0; font-size: 24px; line-height: 1.1; letter-spacing: 0; }
    .editor-status { margin: 9px 0 0; color: rgba(255,255,255,.6); font: 600 12px/1.4 Menlo, Monaco, Consolas, monospace; }
    .editor-section { display: grid; gap: 14px; }
    .editor-section h2 { margin: 0; font-size: 14px; letter-spacing: 0; }
    .editor-field { display: grid; gap: 7px; color: rgba(255,255,255,.68); font-size: 12px; font-weight: 700; }
    .editor-field output { justify-self: end; color: #fff; font-family: Menlo, Monaco, Consolas, monospace; }
    .editor-field select, .editor-field input[type="text"] { width: 100%; min-height: 40px; border: 1px solid rgba(255,255,255,.18); border-radius: 4px; padding: 0 11px; background: #202c28; color: #fff; font: 650 13px/1 Avenir Next, Avenir, Helvetica, Arial, sans-serif; }
    .editor-field input[type="range"] { width: 100%; accent-color: #68d391; }
    .editor-field input[type="color"] { width: 100%; height: 36px; border: 1px solid rgba(255,255,255,.18); border-radius: 4px; padding: 3px; background: #202c28; }
    .editor-actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; position: sticky; bottom: 0; margin-top: auto; background: rgba(15,22,20,.98); border-top: 1px solid rgba(255,255,255,.1); }
    .editor-actions button { min-height: 42px; border: 0; border-radius: 4px; background: #2b3a34; color: #fff; font: 750 12px/1 Avenir Next, Avenir, Helvetica, Arial, sans-serif; cursor: pointer; }
    .editor-actions button[data-action="validate"] { background: #236d4b; }
    .editor-actions button[data-action="add"] { background: #d49b45; color: #162019; }
    .editor-actions button:disabled { opacity: .38; cursor: not-allowed; }
    .preview-modes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
    .preview-modes button { min-height: 34px; border: 1px solid rgba(255,255,255,.14); border-radius: 4px; background: transparent; color: rgba(255,255,255,.72); font: 700 11px/1 Avenir Next, Avenir, Helvetica, Arial, sans-serif; cursor: pointer; }
    .preview-modes button[aria-pressed="true"] { border-color: #68d391; background: rgba(104,211,145,.14); color: #fff; }
    .validation-results { display: grid; gap: 7px; margin: 0; padding: 0; list-style: none; }
    .validation-results li { padding-left: 15px; color: rgba(255,255,255,.68); font: 600 11px/1.35 Menlo, Monaco, Consolas, monospace; }
    .validation-results li::before { content: "-"; margin-left: -15px; margin-right: 8px; color: #77dfa5; }
    .capture-pointer { position: fixed; z-index: 20; width: 18px; height: 18px; border: 2px solid #fff; border-radius: 50%; pointer-events: none; opacity: 0; transform: translate(-50%, -50%); box-shadow: 0 2px 10px rgba(0,0,0,.55); transition: left .28s ease, top .28s ease, width .12s ease, height .12s ease, background .12s ease; }
    body[data-capture-human="true"] .capture-pointer { opacity: 1; }
    body[data-capture-human="true"] .capture-pointer[data-pressed="true"] { width: 28px; height: 28px; background: rgba(104,211,145,.42); border-color: #8be7b4; }
    @media (max-width: 899px) {
      .editor-panel { width: min(400px, 92vw); }
      .editor-header, .editor-section, .editor-actions { padding-left: 16px; padding-right: 16px; }
      .editor-header h1 { font-size: 21px; }
    }
  </style>
</head>
<body>
  <canvas id="showcase" aria-label="WorldFactory-Harness building and validating fifteen procedural forest assets before composing a forest world"></canvas>
  <div class="vignette"></div>
  <div class="capture-pointer" aria-hidden="true"></div>
  <header class="intro">
    <h1>${profile.title}</h1>
    <p>${profile.subtitle} / <span class="world-name">${profile.projectName}</span></p>
    <p class="credit">${profile.guidance.credit}</p>
  </header>
  <section class="asset-copy">
    <p class="agent"></p>
    <h2></h2>
    <p class="phase"></p>
  </section>
  <section class="transition-copy">
    <h2>15 assets validated</h2>
    <p>Composing <span class="world-name">${profile.projectName}</span></p>
  </section>
  <section class="completion">
    <h2>A world built from proven parts.</h2>
    <p>${profile.harness.name} / 15 validated assets / 15 world commits</p>
  </section>
  <label class="world-type-control">
    World type
    <select aria-label="World type">
      ${Object.entries(profile.worldTypes || {}).map(([id, preset]) => `<option value="${id}">${preset.label}</option>`).join("")}
    </select>
  </label>
  <aside class="editor-panel" aria-label="WorldHarness object editor" hidden>
    <header class="editor-header">
      <p class="editor-kicker">WorldHarness V1</p>
      <h1>Procedural Object Editor</h1>
      <p class="editor-status" data-editor-status>Draft / select an object</p>
    </header>
    <section class="editor-section">
      <h2>Object</h2>
      <label class="editor-field">Selected object
        <select data-editor="object">
          ${profile.steps.map((step, index) => `<option value="${index}">${String(index + 1).padStart(2, "0")} / ${step.label}</option>`).join("")}
        </select>
      </label>
      <label class="editor-field">World type
        <select data-editor="world-type">
          ${Object.entries(profile.worldTypes || {}).map(([id, preset]) => `<option value="${id}">${preset.label}</option>`).join("")}
        </select>
      </label>
      <label class="editor-field">World structure
        <select data-editor="world-structure">
          ${Object.entries(profile.worldStructures || {}).map(([id, structure]) => `<option value="${id}">${structure.label}</option>`).join("")}
        </select>
      </label>
      <label class="editor-field">Variant seed
        <input data-editor="seed" type="text" spellcheck="false">
      </label>
    </section>
    <section class="editor-section">
      <h2>Procedural Controls</h2>
      <label class="editor-field">Scale <output data-output="scale">1.00</output>
        <input data-editor="scale" type="range" min="0.5" max="1.8" step="0.01" value="1">
      </label>
      <label class="editor-field">Rotation <output data-output="rotation">0deg</output>
        <input data-editor="rotation" type="range" min="-180" max="180" step="1" value="0">
      </label>
      <label class="editor-field">Surface roughness <output data-output="roughness">0.55</output>
        <input data-editor="roughness" type="range" min="0.05" max="1" step="0.01" value="0.55">
      </label>
      <label class="editor-field">Detail budget <output data-output="detail">100%</output>
        <input data-editor="detail" type="range" min="20" max="100" step="1" value="100">
      </label>
      <label class="editor-field">Material tint
        <input data-editor="color" type="color" value="#68d391">
      </label>
    </section>
    <section class="editor-section">
      <h2>Preview</h2>
      <div class="preview-modes">
        <button type="button" data-preview="turntable" aria-pressed="true">Turntable</button>
        <button type="button" data-preview="wireframe" aria-pressed="false">Wireframe</button>
        <button type="button" data-preview="collision" aria-pressed="false">Collision</button>
      </div>
    </section>
    <section class="editor-section">
      <h2>Validation</h2>
      <ul class="validation-results" data-validation-results>
        <li>Run validation before adding to the world.</li>
      </ul>
    </section>
    <footer class="editor-actions">
      <button type="button" data-action="preview">Preview</button>
      <button type="button" data-action="validate">Validate</button>
      <button type="button" data-action="add" disabled>Add</button>
    </footer>
  </aside>
  <script type="module">
    import * as THREE from "./vendor/three.module.js";

    const profile = ${serialized};
    const timeline = profile.timeline;
    const worldTypes = profile.worldTypes || {};
    const worldStructures = profile.worldStructures || {};
    const query = new URLSearchParams(window.location.search);
    const requestedWorldType = query.get("world");
    const requestedWorldStructure = query.get("structure");
    const captureMode = query.get("capture") === "1";
    const editorMode = query.get("editor") === "1";
    const humanCaptureMode = query.get("human") === "1";
    const liveLoopMode = query.get("live-loop") === "1";
    let activeWorldTypeId = worldTypes[requestedWorldType] ? requestedWorldType : profile.defaultWorldType;
    let activeWorldType = worldTypes[activeWorldTypeId] || Object.values(worldTypes)[0];
    let activeWorldStructureId = worldStructures[requestedWorldStructure] ? requestedWorldStructure : profile.defaultWorldStructure;
    let activeWorldStructure = worldStructures[activeWorldStructureId] || Object.values(worldStructures)[0];
    const canvas = document.getElementById("showcase");
    const capturePointer = document.querySelector(".capture-pointer");
    const intro = document.querySelector(".intro");
    const assetCopy = document.querySelector(".asset-copy");
    const agentCopy = document.querySelector(".asset-copy .agent");
    const titleCopy = document.querySelector(".asset-copy h2");
    const phaseCopy = document.querySelector(".asset-copy .phase");
    const transitionCopy = document.querySelector(".transition-copy");
    const completion = document.querySelector(".completion");
    const worldTypeControl = document.querySelector(".world-type-control");
    const worldTypeSelect = worldTypeControl.querySelector("select");
    const editorPanel = document.querySelector(".editor-panel");
    const editorObjectSelect = document.querySelector('[data-editor="object"]');
    const editorWorldTypeSelect = document.querySelector('[data-editor="world-type"]');
    const editorWorldStructureSelect = document.querySelector('[data-editor="world-structure"]');
    const editorStatus = document.querySelector("[data-editor-status]");
    const validationResults = document.querySelector("[data-validation-results]");
    const addButton = document.querySelector('[data-action="add"]');
    const editorInputs = Object.fromEntries(["seed", "scale", "rotation", "roughness", "detail", "color"].map((name) => [name, document.querySelector('[data-editor="' + name + '"]')]));
    const editorOutputs = Object.fromEntries(["scale", "rotation", "roughness", "detail"].map((name) => [name, document.querySelector('[data-output="' + name + '"]')]));
    const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
    const smooth = (value) => { const x = clamp(value); return x * x * (3 - 2 * x); };
    const easeOutBack = (value) => { const x = clamp(value) - 1; return 1 + 2.15 * x * x * x + 1.15 * x * x; };
    const lerp = (a, b, amount) => a + (b - a) * amount;

    function hash(text) {
      let value = 2166136261;
      for (let index = 0; index < String(text).length; index += 1) {
        value ^= String(text).charCodeAt(index);
        value = Math.imul(value, 16777619);
      }
      return value >>> 0;
    }

    function rng(seed) {
      let value = hash(seed) || 1;
      return () => {
        value += 0x6d2b79f5;
        let number = value;
        number = Math.imul(number ^ (number >>> 15), number | 1);
        number ^= number + Math.imul(number ^ (number >>> 7), number | 61);
        return ((number ^ (number >>> 14)) >>> 0) / 4294967296;
      };
    }

    function woundGeometry(positions, indices, algorithm) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      geometry.userData.topology = "custom-wound-triangles";
      geometry.userData.algorithm = algorithm;
      geometry.userData.triangleCount = indices.length / 3;
      return geometry;
    }

    function triangleBox(width, height, depth) {
      const x = width / 2, y = height / 2, z = depth / 2;
      const positions = [
        -x,-y,z, x,-y,z, x,y,z, -x,y,z, x,-y,-z, -x,-y,-z, -x,y,-z, x,y,-z,
        -x,-y,-z, -x,-y,z, -x,y,z, -x,y,-z, x,-y,z, x,-y,-z, x,y,-z, x,y,z,
        -x,y,z, x,y,z, x,y,-z, -x,y,-z, -x,-y,-z, x,-y,-z, x,-y,z, -x,-y,z,
      ];
      const indices = [];
      for (let face = 0; face < 6; face += 1) {
        const offset = face * 4;
        indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
      }
      return woundGeometry(positions, indices, "box-wound-v1");
    }

    function triangleCylinder(radiusTop, radiusBottom, height, segments = 12) {
      const count = Math.max(3, Math.round(segments));
      const positions = [];
      for (let index = 0; index < count; index += 1) {
        const angle = index / count * Math.PI * 2;
        positions.push(Math.cos(angle) * radiusBottom, -height / 2, Math.sin(angle) * radiusBottom);
        positions.push(Math.cos(angle) * radiusTop, height / 2, Math.sin(angle) * radiusTop);
      }
      const bottomRing = positions.length / 3;
      for (let index = 0; index < count; index += 1) {
        const angle = index / count * Math.PI * 2;
        positions.push(Math.cos(angle) * radiusBottom, -height / 2, Math.sin(angle) * radiusBottom);
      }
      const bottomCenter = positions.length / 3;
      positions.push(0, -height / 2, 0);
      const topRing = positions.length / 3;
      for (let index = 0; index < count; index += 1) {
        const angle = index / count * Math.PI * 2;
        positions.push(Math.cos(angle) * radiusTop, height / 2, Math.sin(angle) * radiusTop);
      }
      const topCenter = positions.length / 3;
      positions.push(0, height / 2, 0);
      const indices = [];
      for (let index = 0; index < count; index += 1) {
        const next = (index + 1) % count;
        const bottom = index * 2, top = bottom + 1, nextBottom = next * 2, nextTop = nextBottom + 1;
        indices.push(bottom, top, nextBottom, top, nextTop, nextBottom);
        if (radiusBottom > 0) indices.push(bottomCenter, bottomRing + index, bottomRing + next);
        if (radiusTop > 0) indices.push(topCenter, topRing + next, topRing + index);
      }
      return woundGeometry(positions, indices, radiusTop === 0 ? "cone-wound-v1" : "cylinder-wound-v1");
    }

    function triangleCone(radius, height, segments = 12) {
      const count = Math.max(3, Math.round(segments));
      const positions = [];
      for (let index = 0; index < count; index += 1) {
        const angle = index / count * Math.PI * 2;
        positions.push(Math.cos(angle) * radius, -height / 2, Math.sin(angle) * radius);
      }
      const apex = positions.length / 3;
      positions.push(0, height / 2, 0);
      const bottomRing = positions.length / 3;
      for (let index = 0; index < count; index += 1) {
        const angle = index / count * Math.PI * 2;
        positions.push(Math.cos(angle) * radius, -height / 2, Math.sin(angle) * radius);
      }
      const bottomCenter = positions.length / 3;
      positions.push(0, -height / 2, 0);
      const indices = [];
      for (let index = 0; index < count; index += 1) {
        const next = (index + 1) % count;
        indices.push(index, apex, next, bottomCenter, bottomRing + index, bottomRing + next);
      }
      return woundGeometry(positions, indices, "cone-wound-v2");
    }

    function trianglePlane(width, height, widthSegments = 1, heightSegments = 1) {
      const columns = Math.max(1, Math.round(widthSegments));
      const rows = Math.max(1, Math.round(heightSegments));
      const positions = [];
      for (let row = 0; row <= rows; row += 1) {
        for (let column = 0; column <= columns; column += 1) {
          positions.push(column / columns * width - width / 2, height / 2 - row / rows * height, 0);
        }
      }
      const indices = [];
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const a = row * (columns + 1) + column;
          const b = (row + 1) * (columns + 1) + column;
          const c = b + 1;
          const d = a + 1;
          indices.push(a, b, d, b, c, d);
        }
      }
      return woundGeometry(positions, indices, "grid-plane-wound-v1");
    }

    function triangleSphere(radius, widthSegments = 12, heightSegments = 8, phiStart = 0, phiLength = Math.PI * 2, thetaStart = 0, thetaLength = Math.PI) {
      const columns = Math.max(3, Math.round(widthSegments));
      const rows = Math.max(2, Math.round(heightSegments));
      const positions = [];
      for (let row = 0; row <= rows; row += 1) {
        const v = row / rows;
        const theta = thetaStart + v * thetaLength;
        for (let column = 0; column <= columns; column += 1) {
          const phi = phiStart + column / columns * phiLength;
          positions.push(-radius * Math.cos(phi) * Math.sin(theta), radius * Math.cos(theta), radius * Math.sin(phi) * Math.sin(theta));
        }
      }
      const indices = [];
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const a = row * (columns + 1) + column + 1;
          const b = row * (columns + 1) + column;
          const c = (row + 1) * (columns + 1) + column;
          const d = c + 1;
          if (row !== 0 || thetaStart > 0) indices.push(a, b, d);
          if (row !== rows - 1 || thetaStart + thetaLength < Math.PI) indices.push(b, c, d);
        }
      }
      return woundGeometry(positions, indices, "latlong-wound-v1");
    }

    function trianglePoly(radius, detail = 1, algorithm = "faceted-radial") {
      const segments = Math.max(4, 5 + Math.round(detail) * 2);
      const geometry = triangleSphere(radius, segments, Math.max(3, Math.round(segments * 0.62)));
      const position = geometry.getAttribute("position");
      for (let index = 0; index < position.count; index += 1) {
        const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
        const modulation = 0.9 + ((Math.abs(Math.sin(x * 3.1 + y * 2.3 + z * 4.7)) * 0.18));
        position.setXYZ(index, x * modulation, y * modulation, z * modulation);
      }
      geometry.computeVertexNormals();
      geometry.userData.algorithm = algorithm;
      return geometry;
    }

    function triangleTorus(radius, tube, radialSegments = 10, tubularSegments = 32) {
      const rows = Math.max(3, Math.round(radialSegments));
      const columns = Math.max(3, Math.round(tubularSegments));
      const positions = [];
      for (let row = 0; row <= rows; row += 1) {
        const v = row / rows * Math.PI * 2;
        for (let column = 0; column <= columns; column += 1) {
          const u = column / columns * Math.PI * 2;
          positions.push((radius + tube * Math.cos(v)) * Math.cos(u), tube * Math.sin(v), (radius + tube * Math.cos(v)) * Math.sin(u));
        }
      }
      const indices = [];
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const a = row * (columns + 1) + column;
          const b = (row + 1) * (columns + 1) + column;
          const c = b + 1;
          const d = a + 1;
          indices.push(a, b, d, b, c, d);
        }
      }
      return woundGeometry(positions, indices, "torus-wound-v1");
    }

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111816);
    scene.fog = new THREE.FogExp2(activeWorldType.fog, 0.026);
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 120);

    const sky = new THREE.Mesh(
      triangleSphere(62, 32, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {
          topColor: { value: new THREE.Color(activeWorldType.skyTop) },
          bottomColor: { value: new THREE.Color(activeWorldType.skyBottom) },
          offset: { value: 7.5 },
          exponent: { value: 0.72 },
        },
        vertexShader: "varying vec3 vWorldPosition; void main(){ vec4 worldPosition=modelMatrix*vec4(position,1.0); vWorldPosition=worldPosition.xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
        fragmentShader: "uniform vec3 topColor; uniform vec3 bottomColor; uniform float offset; uniform float exponent; varying vec3 vWorldPosition; void main(){ float h=normalize(vWorldPosition+vec3(0.0,offset,0.0)).y; gl_FragColor=vec4(mix(bottomColor,topColor,max(pow(max(h,0.0),exponent),0.0)),1.0); }",
      })
    );
    scene.add(sky);

    const hemi = new THREE.HemisphereLight(0xd9eee5, 0x18251e, 1.75);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(activeWorldType.sun, 3.8);
    sun.position.set(-10, 16, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    sun.shadow.bias = -0.0003;
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x72c7e8, 2.5);
    rim.position.set(10, 9, -12);
    scene.add(rim);

    function physical(color, options = {}) {
      return new THREE.MeshPhysicalMaterial({
        color,
        roughness: options.roughness ?? 0.55,
        metalness: options.metalness ?? 0.05,
        transparent: Boolean(options.transparent),
        opacity: options.opacity ?? 1,
        transmission: options.transmission ?? 0,
        thickness: options.thickness ?? 0,
        emissive: options.emissive ?? 0x000000,
        emissiveIntensity: options.emissiveIntensity ?? 0,
        clearcoat: options.clearcoat ?? 0.12,
        clearcoatRoughness: options.clearcoatRoughness ?? 0.4,
        side: options.side ?? THREE.FrontSide,
        vertexColors: Boolean(options.vertexColors),
      });
    }

    function mesh(geometry, surface) {
      const object = new THREE.Mesh(geometry, surface);
      object.castShadow = true;
      object.receiveShadow = true;
      return object;
    }

    function cylinderBetween(start, end, radius, surface, segments = 8) {
      const direction = end.clone().sub(start);
      const object = mesh(triangleCylinder(radius, radius * 1.08, direction.length(), segments), surface);
      object.position.copy(start).add(end).multiplyScalar(0.5);
      object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
      return object;
    }

    const studio = new THREE.Group();
    const forestWorld = new THREE.Group();
    const worldStructureGuide = new THREE.Group();
    scene.add(studio, forestWorld, worldStructureGuide);

    function disposeGuideObject(object) {
      object.traverse((child) => {
        child.geometry?.dispose?.();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((surface) => surface?.dispose?.());
      });
    }

    function wireObject(geometry, color, opacity = 0.62) {
      const edges = new THREE.WireframeGeometry(geometry);
      geometry.dispose();
      return new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
    }

    function rebuildWorldStructureGuide() {
      worldStructureGuide.children.forEach(disposeGuideObject);
      worldStructureGuide.clear();
      const guide = activeWorldStructure?.guide || {};
      const size = Number(guide.size) || 5;
      const color = guide.color || "#72c7e8";
      if (guide.kind === "grid" || guide.kind === "patch-grid") {
        const divisions = guide.kind === "patch-grid" ? 4 : 18;
        const grid = new THREE.GridHelper(size * 2, divisions, color, color);
        grid.material.transparent = true;
        grid.material.opacity = guide.kind === "patch-grid" ? 0.72 : 0.38;
        grid.position.y = 0.12;
        worldStructureGuide.add(grid);
      }
      if (guide.kind === "patch-grid") {
        for (const x of [-1, 0, 1]) {
          for (const z of [-1, 0, 1]) {
            const patch = wireObject(triangleBox(size * 0.58, 0.22, size * 0.58), color, 0.46);
            patch.position.set(x * size * 0.62, 0.22, z * size * 0.62);
            worldStructureGuide.add(patch);
          }
        }
      } else if (guide.kind === "box") {
        const box = wireObject(triangleBox(size * 1.5, size * 0.82, size * 1.5), color);
        box.position.y = size * 0.41;
        worldStructureGuide.add(box);
      } else if (guide.kind === "sphere") {
        const sphere = wireObject(triangleSphere(size, 20, 14), color, 0.52);
        sphere.position.y = size * 0.72;
        worldStructureGuide.add(sphere);
      } else if (guide.kind === "axes") {
        const axes = new THREE.AxesHelper(size);
        axes.position.y = 0.12;
        worldStructureGuide.add(axes);
        const volume = wireObject(trianglePoly(size * 0.76, 1, "volume-faceted"), color, 0.32);
        volume.position.y = size * 0.5;
        worldStructureGuide.add(volume);
      } else if (guide.kind === "torus") {
        const torus = wireObject(triangleTorus(size, size * 0.34, 12, 42), color, 0.58);
        torus.rotation.x = Math.PI / 2;
        torus.position.y = size * 0.48;
        worldStructureGuide.add(torus);
      } else if (guide.kind === "layers") {
        for (let index = 0; index < 4; index += 1) {
          const ring = wireObject(triangleCylinder(size, size, 0.08, 40), color, 0.28 + index * 0.1);
          ring.position.y = 0.35 + index * 1.3;
          worldStructureGuide.add(ring);
        }
      }
      worldStructureGuide.visible = editorMode;
    }

    const studioFloor = mesh(triangleCylinder(4.3, 4.65, 0.38, 72), physical(0x1f2d29, { roughness: 0.32, metalness: 0.42, clearcoat: 0.4 }));
    studioFloor.position.y = -0.2;
    studio.add(studioFloor);
    const studioInset = mesh(triangleCylinder(3.85, 3.85, 0.06, 72), physical(0x355e4d, { roughness: 0.48, metalness: 0.16, emissive: 0x193d2c, emissiveIntensity: 0.34 }));
    studioInset.position.y = 0.03;
    studio.add(studioInset);
    const studioRing = mesh(triangleTorus(4.05, 0.035, 10, 96), physical(0x68d391, { emissive: 0x68d391, emissiveIntensity: 1.8, roughness: 0.15 }));
    studioRing.rotation.x = Math.PI / 2;
    studioRing.position.y = 0.08;
    studio.add(studioRing);
    const scanRing = mesh(triangleTorus(2.2, 0.025, 8, 72), physical(0x8cf0ba, { transparent: true, opacity: 0.85, emissive: 0x68d391, emissiveIntensity: 2.4, roughness: 0.12 }));
    scanRing.rotation.x = Math.PI / 2;
    studio.add(scanRing);

    const nexusTerrain = profile.nexusTerrain?.status === "passed" ? profile.nexusTerrain : null;
    const validatedChunks = nexusTerrain?.chunks || [];

    function validatedTerrainHeightAt(x, z) {
      const chunk = validatedChunks.find((entry) => x >= entry.bounds.minX && x <= entry.bounds.maxX && z >= entry.bounds.minZ && z <= entry.bounds.maxZ);
      if (!chunk) return null;
      const resolution = chunk.resolution;
      const size = resolution + 1;
      const tx = clamp((x - chunk.bounds.minX) / chunk.size) * resolution;
      const tz = clamp((z - chunk.bounds.minZ) / chunk.size) * resolution;
      const x0 = Math.floor(tx), z0 = Math.floor(tz);
      const x1 = Math.min(resolution, x0 + 1), z1 = Math.min(resolution, z0 + 1);
      const fx = tx - x0, fz = tz - z0;
      const a = chunk.heightField[z0 * size + x0];
      const b = chunk.heightField[z0 * size + x1];
      const c = chunk.heightField[z1 * size + x0];
      const d = chunk.heightField[z1 * size + x1];
      return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
    }

    function terrainHeightAt(x, z) {
      const validatedHeight = validatedTerrainHeightAt(x, z);
      if (validatedHeight !== null) return validatedHeight;
      const base = Math.sin(x * 0.33) * 0.42 + Math.cos(z * 0.41) * 0.34 + Math.sin((x + z) * 0.72) * 0.16;
      const riverValley = Math.max(0, 1 - Math.abs(x) / 1.8) * 0.72;
      return base - riverValley;
    }

    function terrainGeometry() {
      const geometry = trianglePlane(28, 20, 56, 40);
      geometry.rotateX(-Math.PI / 2);
      const position = geometry.getAttribute("position");
      const colors = [];
      for (let index = 0; index < position.count; index += 1) {
        const x = position.getX(index);
        const z = position.getZ(index);
        const height = terrainHeightAt(x, z);
        position.setY(index, height);
        const color = new THREE.Color(height > 0.42 ? activeWorldType.terrainHigh : height < -0.25 ? activeWorldType.terrainLow : activeWorldType.terrainMid);
        colors.push(color.r, color.g, color.b);
      }
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      return geometry;
    }

    function validatedChunkGeometry(chunk) {
      const geometry = new THREE.BufferGeometry();
      const size = chunk.resolution + 1;
      const step = chunk.size / chunk.resolution;
      const positions = [];
      const colors = [];
      const indices = [];
      for (let z = 0; z < size; z += 1) {
        for (let x = 0; x < size; x += 1) {
          const index = z * size + x;
          positions.push(chunk.bounds.minX + x * step, chunk.heightField[index], chunk.bounds.minZ + z * step);
          const materialName = chunk.materialPalette[chunk.materialField[index]] || "grass";
          const color = new THREE.Color(chunk.materialColors[materialName] || activeWorldType.terrainMid);
          colors.push(color.r, color.g, color.b);
        }
      }
      for (let z = 0; z < chunk.resolution; z += 1) {
        for (let x = 0; x < chunk.resolution; x += 1) {
          const a = z * size + x, b = a + 1, c = a + size, d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
      }
      geometry.setIndex(indices);
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(chunk.normalField, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geometry.userData.topology = "custom-wound-triangles";
      geometry.userData.validatedChunkId = chunk.id;
      geometry.computeBoundingSphere();
      return geometry;
    }

    const ground = mesh(terrainGeometry(), physical(0xffffff, { roughness: 0.96, metalness: 0, vertexColors: true }));
    ground.visible = !nexusTerrain;
    forestWorld.add(ground);
    const validatedTerrainGroup = new THREE.Group();
    if (nexusTerrain) {
      validatedChunks.forEach((chunk) => {
        const surface = mesh(validatedChunkGeometry(chunk), physical(0xffffff, { roughness: 0.96, metalness: 0, vertexColors: true }));
        surface.userData.validatedChunkId = chunk.id;
        validatedTerrainGroup.add(surface);
      });
      forestWorld.add(validatedTerrainGroup);
    }
    const river = mesh(trianglePlane(2.15, 18, 1, 24), physical(activeWorldType.river, { transparent: true, opacity: 0.78, transmission: 0.22, thickness: 0.5, roughness: 0.12, metalness: 0.08, clearcoat: 0.9 }));
    river.rotation.x = -Math.PI / 2;
    river.position.set(0, -0.26, 0.5);
    river.visible = !nexusTerrain;
    forestWorld.add(river);

    const detailRandom = rng(profile.seed + ":terrain-detail");
    const grassCount = 280;
    const grass = new THREE.InstancedMesh(
      triangleCone(0.075, 0.42, 4),
      physical(activeWorldType.detail, { roughness: 0.94, metalness: 0 }),
      grassCount
    );
    const detailMatrix = new THREE.Matrix4();
    const detailQuaternion = new THREE.Quaternion();
    const detailScale = new THREE.Vector3();
    for (let index = 0; index < grassCount; index += 1) {
      let x = (detailRandom() - 0.5) * 25;
      const z = (detailRandom() - 0.5) * 17;
      if (Math.abs(x) < 1.5) x += x < 0 ? -1.6 : 1.6;
      const y = terrainHeightAt(x, z) + 0.16;
      detailQuaternion.setFromEuler(new THREE.Euler(0, detailRandom() * Math.PI * 2, (detailRandom() - 0.5) * 0.16));
      detailScale.set(0.75 + detailRandom() * 0.7, 0.65 + detailRandom() * 1.15, 0.75 + detailRandom() * 0.7);
      detailMatrix.compose(new THREE.Vector3(x, y, z), detailQuaternion, detailScale);
      grass.setMatrixAt(index, detailMatrix);
    }
    grass.castShadow = true;
    grass.receiveShadow = true;
    grass.instanceMatrix.needsUpdate = true;
    grass.visible = !nexusTerrain;
    forestWorld.add(grass);

    const path = new THREE.Group();
    for (let index = 0; index < 23; index += 1) {
      const z = 7.6 - index * 0.66;
      const x = (z > 2.8 ? 1.65 : z < 1.8 ? -1.55 : lerp(-1.55, 1.65, (z - 1.8))) + Math.sin(index * 0.8) * 0.16;
      const stone = mesh(triangleCylinder(0.32 + (index % 3) * 0.07, 0.36, 0.08, 9), physical(index % 2 ? 0x938f75 : 0x7f836e, { roughness: 0.96, metalness: 0 }));
      stone.position.set(x, terrainHeightAt(x, z) + 0.06, z);
      stone.rotation.y = index * 0.61;
      stone.scale.z = 0.7 + (index % 4) * 0.08;
      path.add(stone);
    }
    forestWorld.add(path);
    path.visible = !nexusTerrain;

    function treeAsset(step, mode, species) {
      const group = new THREE.Group();
      const random = rng((step.seed || profile.seed) + step.id + mode);
      const count = mode === "test" ? 1 : ({ oak: 5, birch: 7, pine: 9, willow: 4 }[species] || 4);
      for (let index = 0; index < count; index += 1) {
        const tree = new THREE.Group();
        const height = (species === "pine" ? 4.2 : species === "willow" ? 3.5 : 3.7) * (0.82 + random() * 0.35);
        const trunkColor = species === "birch" ? 0xd4d0bd : species === "willow" ? 0x6a5840 : 0x69462f;
        const trunk = mesh(triangleCylinder(0.16, 0.28, height, 9), physical(trunkColor, { roughness: 0.94, metalness: 0 }));
        trunk.position.y = height * 0.5;
        tree.add(trunk);
        const branchSurface = physical(trunkColor, { roughness: 0.96, metalness: 0 });
        const branchCount = species === "pine" ? 5 : 7;
        for (let branchIndex = 0; branchIndex < branchCount; branchIndex += 1) {
          const angle = branchIndex / branchCount * Math.PI * 2 + random() * 0.4;
          const start = new THREE.Vector3(0, height * (0.52 + branchIndex * 0.045), 0);
          const length = 0.7 + random() * 0.65;
          const end = new THREE.Vector3(Math.cos(angle) * length, start.y + 0.25 + random() * 0.35, Math.sin(angle) * length);
          tree.add(cylinderBetween(start, end, 0.055, branchSurface, 7));
        }
        const foliageColors = species === "pine" ? [0x1f5944, 0x2c7250] : species === "willow" ? [0x5f8247, 0x7f9d58] : species === "birch" ? [0x6f9f58, 0x95ba70] : [0x376f45, 0x568d4e];
        const crownCount = species === "pine" ? 5 : species === "willow" ? 8 : 7;
        for (let crownIndex = 0; crownIndex < crownCount; crownIndex += 1) {
          const angle = crownIndex / crownCount * Math.PI * 2 + random();
          const radius = species === "willow" ? 1.35 : 1.05;
          const crown = mesh(
            species === "pine"
              ? triangleCone(0.72 + random() * 0.26, 1.5 + random() * 0.5, 9)
              : trianglePoly(0.62 + random() * 0.3, 2, step.algorithm || "canopy-faceted"),
            physical(foliageColors[crownIndex % 2], { roughness: 0.86, metalness: 0, clearcoat: 0.06 })
          );
          crown.position.set(Math.cos(angle) * radius * (0.3 + random() * 0.45), height * 0.7 + random() * 1.15, Math.sin(angle) * radius * (0.3 + random() * 0.45));
          crown.scale.y = species === "willow" ? 1.55 : 1;
          tree.add(crown);
        }
        if (mode === "world") {
          const angle = index / count * Math.PI * 2 + random() * 0.7;
          const spread = 1.1 + Math.floor(index / 3) * 0.9 + random() * 0.7;
          tree.position.set(Math.cos(angle) * spread, 0, Math.sin(angle) * spread);
          tree.scale.setScalar(0.72 + random() * 0.42);
          tree.rotation.y = random() * Math.PI * 2;
        }
        group.add(tree);
      }
      return group;
    }

    function terrainPatch(step, mode) {
      const group = new THREE.Group();
      const patch = mesh(triangleCylinder(mode === "test" ? 2.5 : 4.5, mode === "test" ? 2.7 : 4.8, 0.42, 32), physical(0x4c704e, { roughness: 0.96, metalness: 0 }));
      patch.position.y = 0.16;
      group.add(patch);
      for (let index = 0; index < (mode === "test" ? 9 : 18); index += 1) {
        const random = rng((step.seed || profile.seed) + step.id + mode + index);
        const stone = mesh(trianglePoly(0.12 + random() * 0.16, 1, step.algorithm || "terrain-stone"), physical(index % 2 ? 0x778176 : 0x5f6c61, { roughness: 0.9, metalness: 0 }));
        const angle = random() * Math.PI * 2;
        const radius = 0.5 + random() * (mode === "test" ? 1.7 : 3.5);
        stone.position.set(Math.cos(angle) * radius, 0.42, Math.sin(angle) * radius);
        group.add(stone);
      }
      return group;
    }

    function boulders(step, mode) {
      const group = new THREE.Group();
      const count = mode === "test" ? 4 : 9;
      const random = rng((step.seed || profile.seed) + step.id + mode);
      for (let index = 0; index < count; index += 1) {
        const rock = mesh(trianglePoly(0.55 + random() * 0.42, 2, step.algorithm || "boulder-faceted"), physical(0x68716b, { roughness: 0.93, metalness: 0.02 }));
        rock.scale.set(1.1 + random() * 0.7, 0.65 + random() * 0.55, 0.9 + random() * 0.6);
        rock.position.set((random() - 0.5) * (mode === "test" ? 3.1 : 5), 0.48, (random() - 0.5) * (mode === "test" ? 2.3 : 4));
        rock.rotation.set(random(), random() * Math.PI, random() * 0.4);
        group.add(rock);
        const moss = mesh(trianglePoly(0.35 + random() * 0.22, 1, "moss-cluster"), physical(step.color, { roughness: 1, metalness: 0 }));
        moss.scale.set(1.25, 0.35, 1.1);
        moss.position.copy(rock.position).add(new THREE.Vector3(0, 0.62, 0));
        group.add(moss);
      }
      return group;
    }

    function crystals(step, mode) {
      const group = new THREE.Group();
      const count = mode === "test" ? 7 : 11;
      const random = rng((step.seed || profile.seed) + step.id + mode);
      for (let index = 0; index < count; index += 1) {
        const crystal = mesh(trianglePoly(0.32 + random() * 0.3, 0, step.algorithm || "crystal-radial"), physical(index % 2 ? step.color : 0xbdeef0, { roughness: 0.1, metalness: 0.16, transmission: 0.1, emissive: step.color, emissiveIntensity: 0.75, clearcoat: 0.85 }));
        crystal.scale.y = 1.8 + random() * 2;
        crystal.position.set((random() - 0.5) * 2.6, crystal.scale.y * 0.18, (random() - 0.5) * 2.2);
        crystal.rotation.y = random() * Math.PI;
        group.add(crystal);
      }
      const light = new THREE.PointLight(step.color, mode === "test" ? 15 : 24, 7, 2);
      light.position.y = 1.2;
      group.add(light);
      return group;
    }

    function shrine(step) {
      const group = new THREE.Group();
      const stone = physical(0x747970, { roughness: 0.9, metalness: 0 });
      const wood = physical(0x79523a, { roughness: 0.82, metalness: 0.02 });
      const base = mesh(triangleCylinder(1.4, 1.6, 0.3, 8), stone);
      group.add(base);
      [-0.86, 0.86].forEach((x) => {
        const pillar = mesh(triangleCylinder(0.14, 0.2, 2.7, 10), wood);
        pillar.position.set(x, 1.45, 0);
        group.add(pillar);
      });
      const roof = mesh(triangleCone(1.65, 0.68, 4), physical(0x355447, { roughness: 0.68, metalness: 0.08 }));
      roof.position.y = 3.05;
      roof.rotation.y = Math.PI / 4;
      group.add(roof);
      const flame = mesh(trianglePoly(0.23, 2, "flame-faceted"), physical(step.color, { emissive: step.color, emissiveIntensity: 2.4, roughness: 0.1 }));
      flame.position.y = 1.15;
      group.add(flame);
      const light = new THREE.PointLight(step.color, 18, 5, 2);
      light.position.y = 1.3;
      group.add(light);
      return group;
    }

    function arch(step) {
      const group = new THREE.Group();
      const stone = physical(0x858d84, { roughness: 0.94, metalness: 0 });
      for (let index = 0; index < 11; index += 1) {
        const angle = Math.PI * (index / 10);
        const block = mesh(triangleBox(0.62, 0.52, 0.82), stone);
        block.position.set(Math.cos(angle) * 1.75, Math.sin(angle) * 1.75 + 1.45, 0);
        block.rotation.z = angle - Math.PI / 2;
        group.add(block);
      }
      [-1.75, 1.75].forEach((x) => {
        for (let index = 0; index < 4; index += 1) {
          const block = mesh(triangleBox(0.7, 0.68, 0.9), stone);
          block.position.set(x, 0.36 + index * 0.66, 0);
          block.rotation.y = (index % 2) * 0.08;
          group.add(block);
        }
      });
      return group;
    }

    function bridge(step, mode) {
      const group = new THREE.Group();
      const wood = physical(0x805638, { roughness: 0.88, metalness: 0 });
      const rope = physical(0x9f8a63, { roughness: 1, metalness: 0 });
      const plankCount = mode === "test" ? 9 : 13;
      for (let index = 0; index < plankCount; index += 1) {
        const plank = mesh(triangleBox(2.5, 0.13, 0.34), wood);
        plank.position.set(0, 0.1 + Math.sin(index / (plankCount - 1) * Math.PI) * -0.18, (index - (plankCount - 1) / 2) * 0.36);
        plank.rotation.y = (index % 2 ? 1 : -1) * 0.025;
        group.add(plank);
      }
      [-1.22, 1.22].forEach((x) => {
        const start = new THREE.Vector3(x, 0.75, -plankCount * 0.18);
        const end = new THREE.Vector3(x, 0.75, plankCount * 0.18);
        group.add(cylinderBetween(start, end, 0.035, rope, 7));
      });
      return group;
    }

    function waterfall(step) {
      const group = new THREE.Group();
      const rock = physical(0x606a65, { roughness: 0.94, metalness: 0 });
      for (let index = 0; index < 7; index += 1) {
        const stone = mesh(trianglePoly(0.72 + (index % 3) * 0.15, 1, step.algorithm || "waterfall-rock"), rock);
        stone.position.set((index % 3 - 1) * 0.95, 0.55 + Math.floor(index / 3) * 0.9, (index % 2 - 0.5) * 0.4);
        stone.scale.y = 0.8 + index * 0.05;
        group.add(stone);
      }
      const water = mesh(trianglePlane(1.25, 3.2, 1, 16), physical(step.color, { transparent: true, opacity: 0.76, transmission: 0.28, thickness: 0.4, roughness: 0.08, clearcoat: 1, side: THREE.DoubleSide }));
      water.position.set(0, 1.75, 0.78);
      group.add(water);
      const mist = new THREE.PointLight(0xa9e4ef, 12, 5, 2);
      mist.position.set(0, 0.6, 1);
      group.add(mist);
      return group;
    }

    function mushrooms(step, mode) {
      const group = new THREE.Group();
      const count = mode === "test" ? 9 : 16;
      for (let index = 0; index < count; index += 1) {
        const angle = index / count * Math.PI * 2;
        const mushroom = new THREE.Group();
        const stemHeight = 0.42 + (index % 3) * 0.12;
        const stem = mesh(triangleCylinder(0.06, 0.09, stemHeight, 8), physical(0xd8cdb1, { roughness: 0.9, metalness: 0 }));
        stem.position.y = stemHeight * 0.5;
        mushroom.add(stem);
        const cap = mesh(triangleSphere(0.23 + (index % 2) * 0.06, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), physical(index % 3 ? step.color : 0xe39b63, { roughness: 0.66, metalness: 0, clearcoat: 0.28 }));
        cap.position.y = stemHeight;
        mushroom.add(cap);
        const radius = mode === "test" ? 1.25 : 1.8;
        mushroom.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
        mushroom.scale.setScalar(0.8 + (index % 4) * 0.12);
        group.add(mushroom);
      }
      return group;
    }

    function fireflies(step, mode) {
      const group = new THREE.Group();
      const count = mode === "test" ? 80 : 220;
      const random = rng((step.seed || profile.seed) + step.id + mode);
      const geometry = trianglePoly(mode === "test" ? 0.055 : 0.04, 0, step.algorithm || "firefly-tetra");
      const surface = physical(step.color, { emissive: step.color, emissiveIntensity: 2.6, roughness: 0.12 });
      const swarm = new THREE.InstancedMesh(geometry, surface, count);
      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      for (let index = 0; index < count; index += 1) {
        const radius = mode === "test" ? 2.3 : 5.5;
        const position = new THREE.Vector3((random() - 0.5) * radius * 2, 0.35 + random() * (mode === "test" ? 3.5 : 5), (random() - 0.5) * radius * 2);
        const size = 0.65 + random() * 0.7;
        scale.set(size, size, size);
        matrix.compose(position, quaternion, scale);
        swarm.setMatrixAt(index, matrix);
      }
      swarm.instanceMatrix.needsUpdate = true;
      group.add(swarm);
      return group;
    }

    function lantern(step) {
      const group = new THREE.Group();
      const post = mesh(triangleCylinder(0.11, 0.16, 2.8, 9), physical(0x3e332a, { roughness: 0.8, metalness: 0.1 }));
      post.position.y = 1.4;
      group.add(post);
      const arm = cylinderBetween(new THREE.Vector3(0, 2.55, 0), new THREE.Vector3(0.72, 2.55, 0), 0.08, physical(0x3e332a, { roughness: 0.8 }));
      group.add(arm);
      const frameSurface = physical(0x26302d, { roughness: 0.28, metalness: 0.72 });
      for (const x of [-0.21, 0.21]) {
        for (const z of [-0.21, 0.21]) {
          const bar = mesh(triangleBox(0.055, 0.7, 0.055), frameSurface);
          bar.position.set(0.72 + x, 2.16, z);
          group.add(bar);
        }
      }
      for (const y of [1.82, 2.5]) {
        const frame = mesh(triangleBox(0.54, 0.06, 0.54), frameSurface);
        frame.position.set(0.72, y, 0);
        group.add(frame);
      }
      const glow = mesh(triangleBox(0.3, 0.44, 0.3), physical(step.color, { emissive: step.color, emissiveIntensity: 2.8, transparent: true, opacity: 0.85, transmission: 0.2, roughness: 0.12 }));
      glow.position.set(0.72, 2.16, 0);
      group.add(glow);
      const light = new THREE.PointLight(step.color, 24, 8, 2);
      light.position.set(0.72, 2.16, 0);
      group.add(light);
      return group;
    }

    function monolith(step) {
      const group = new THREE.Group();
      const body = mesh(triangleBox(1.25, 3.7, 0.72), physical(0x172521, { roughness: 0.24, metalness: 0.62, clearcoat: 0.46 }));
      body.position.y = 1.85;
      group.add(body);
      const runeSurface = physical(step.color, { emissive: step.color, emissiveIntensity: 2.8, roughness: 0.08 });
      for (let index = 0; index < 5; index += 1) {
        const width = 0.55 - index * 0.045;
        for (const z of [-0.385, 0.385]) {
          const rune = mesh(triangleBox(width, 0.055, 0.04), runeSurface);
          rune.position.set(0, 2.85 - index * 0.46, z);
          rune.rotation.z = (index % 2 ? 1 : -1) * 0.18;
          group.add(rune);
        }
        for (const x of [-0.635, 0.635]) {
          const rune = mesh(triangleBox(0.04, 0.055, width * 0.75), runeSurface);
          rune.position.set(x, 2.85 - index * 0.46, 0);
          rune.rotation.x = (index % 2 ? 1 : -1) * 0.18;
          group.add(rune);
        }
      }
      for (const x of [-0.64, 0.64]) {
        for (const z of [-0.38, 0.38]) {
          const edge = mesh(triangleBox(0.035, 3.3, 0.035), runeSurface);
          edge.position.set(x, 1.9, z);
          group.add(edge);
        }
      }
      const light = new THREE.PointLight(step.color, 20, 7, 2);
      light.position.set(0, 2.1, 0.8);
      group.add(light);
      return group;
    }

    const factories = {
      terrainPatch,
      oak: (step, mode) => treeAsset(step, mode, "oak"),
      birch: (step, mode) => treeAsset(step, mode, "birch"),
      pine: (step, mode) => treeAsset(step, mode, "pine"),
      willow: (step, mode) => treeAsset(step, mode, "willow"),
      boulders,
      crystals,
      shrine,
      arch,
      bridge,
      waterfall,
      mushrooms,
      fireflies,
      lantern,
      monolith,
    };

    const testScale = { terrainPatch: 0.9, oak: 1.12, birch: 1.15, pine: 1.08, willow: 0.98, boulders: 1, crystals: 1.08, shrine: 1.04, arch: 1.02, bridge: 1.05, waterfall: 1, mushrooms: 1.28, fireflies: 1.12, lantern: 1.28, monolith: 1.04 };
    const worldScale = { terrainPatch: 0.72, oak: 0.84, birch: 0.78, pine: 0.78, willow: 0.7, boulders: 0.76, crystals: 0.68, shrine: 0.92, arch: 0.94, bridge: 1.08, waterfall: 0.92, mushrooms: 0.9, fireflies: 1, lantern: 0.94, monolith: 0.94 };
    const editorOverrides = profile.steps.map((step) => ({
      seed: profile.seed + ":" + step.id,
      scale: 1,
      rotation: 0,
      roughness: 0.55,
      detail: 100,
      color: step.color,
      preview: "turntable",
      validation: "draft",
      added: false,
    }));
    const testAssets = profile.steps.map((step, index) => {
      const object = factories[step.type]({ ...step, seed: editorOverrides[index].seed }, "test");
      object.visible = false;
      studio.add(object);
      return object;
    });
    const worldAssets = profile.steps.map((step, index) => {
      const object = factories[step.type]({ ...step, seed: editorOverrides[index].seed }, "world");
      object.position.fromArray(step.position);
      if (nexusTerrain) {
        const grounding = nexusTerrain.grounding.profiles.find((entry) => entry.id === step.id)?.groundingProfile;
        object.position.y = terrainHeightAt(object.position.x, object.position.z) - Number(grounding?.rootSink || 0);
      }
      object.userData.target = object.position.clone();
      object.userData.targetYaw = Number(step.yaw || 0);
      object.userData.step = step;
      object.visible = false;
      forestWorld.add(object);
      return object;
    });
    const candidateAssets = profile.steps.map((step, index) => {
      const plan = profile.loopPlan?.[index];
      const attempts = Array.isArray(plan?.attempts) ? plan.attempts : [];
      const rejected = attempts.filter((attempt) => attempt.status === "rejected").slice(0, 2);
      const selected = attempts.find((attempt) => attempt.algorithm === plan?.selectedAlgorithm && attempt.seed === plan?.selectedSeed);
      const visibleAttempts = [...rejected, ...(selected ? [selected] : [])];
      return visibleAttempts.map((attempt) => {
        const object = factories[step.type]({ ...step, algorithm: attempt.algorithm, seed: attempt.seed }, "test");
        object.visible = false;
        object.userData.candidate = attempt;
        studio.add(object);
        return object;
      });
    });

    const massiveWorld = new THREE.Group();
    const massiveConfig = profile.generation?.massiveWorld;
    let massiveSectorCount = 1;
    let massiveAssetCount = profile.steps.length;
    if (massiveConfig && nexusTerrain) {
      massiveSectorCount = validatedChunks.length;
      const groundingById = new Map(nexusTerrain.grounding.profiles.map((entry) => [entry.id, entry.groundingProfile]));
      validatedChunks.forEach((chunk) => {
        profile.steps.forEach((step, index) => {
          const placement = rng(profile.seed + ":chunk:" + chunk.id + ":" + step.id);
          if (placement() > Number(massiveConfig.assetDensity)) return;
          const margin = chunk.size * 0.12;
          const x = lerp(chunk.bounds.minX + margin, chunk.bounds.maxX - margin, placement());
          const z = lerp(chunk.bounds.minZ + margin, chunk.bounds.maxZ - margin, placement());
          const grounding = groundingById.get(step.id);
          if (grounding?.valid !== true) return;
          const object = factories[step.type]({ ...step, seed: step.seed + ":chunk:" + chunk.id }, "world");
          object.position.set(x, terrainHeightAt(x, z) - Number(grounding.rootSink || 0), z);
          object.rotation.y = Number(step.yaw || 0) + placement() * Math.PI * 2;
          object.scale.setScalar(0.72 + placement() * 0.34);
          object.traverse((child) => { if (child.isLight) child.visible = false; });
          object.userData.libraryAssetId = profile.steps[index].id;
          object.userData.validatedChunkId = chunk.id;
          massiveWorld.add(object);
          massiveAssetCount += 1;
        });
      });
      forestWorld.add(massiveWorld);
    } else if (massiveConfig) {
      const sectorRadius = Math.max(1, Math.round(massiveConfig.sectorRadius));
      const spacing = Number(massiveConfig.sectorSpacing);
      for (let sectorX = -sectorRadius; sectorX <= sectorRadius; sectorX += 1) {
        for (let sectorZ = -sectorRadius; sectorZ <= sectorRadius; sectorZ += 1) {
          if (sectorX === 0 && sectorZ === 0) continue;
          massiveSectorCount += 1;
          const tile = ground.clone();
          tile.position.set(sectorX * spacing, 0, sectorZ * spacing);
          massiveWorld.add(tile);
          profile.steps.forEach((step, index) => {
            const placement = rng(profile.seed + ":sector:" + sectorX + ":" + sectorZ + ":" + step.id);
            if (placement() > Number(massiveConfig.assetDensity)) return;
            const object = factories[step.type]({ ...step, seed: step.seed + ":sector:" + sectorX + ":" + sectorZ }, "world");
            object.position.set(
              sectorX * spacing + step.position[0] + (placement() - 0.5) * 8,
              step.position[1],
              sectorZ * spacing + step.position[2] + (placement() - 0.5) * 8
            );
            object.rotation.y = Number(step.yaw || 0) + placement() * Math.PI * 2;
            object.scale.setScalar(0.72 + placement() * 0.34);
            object.traverse((child) => { if (child.isLight) child.visible = false; });
            object.userData.libraryAssetId = profile.steps[index].id;
            massiveWorld.add(object);
            massiveAssetCount += 1;
          });
        }
      }
      forestWorld.add(massiveWorld);
    }

    function validateLibraryAssets() {
      let triangleCount = 0;
      let degenerateCount = 0;
      let invertedCount = 0;
      let customMeshCount = 0;
      let meshCount = 0;
      let readableMaterialCount = 0;
      const assets = worldAssets.map((root, assetIndex) => {
        let assetTriangles = 0;
        let assetDegenerate = 0;
        let assetInverted = 0;
        let assetCustom = true;
        root.traverse((object) => {
          if (!object.isMesh) return;
          meshCount += 1;
          const geometry = object.geometry;
          const position = geometry?.getAttribute("position");
          const normal = geometry?.getAttribute("normal");
          const index = geometry?.index;
          if (!position || !normal || !index || geometry.userData.topology !== "custom-wound-triangles") {
            assetCustom = false;
            return;
          }
          customMeshCount += 1;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          if (materials.some((surface) => {
            const color = surface?.color;
            const luminance = color ? color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722 : 0;
            return luminance >= 0.035 || Number(surface?.emissiveIntensity || 0) > 0;
          })) readableMaterialCount += 1;
          const sampleStride = Math.max(1, Math.ceil(index.count / 3 / 600));
          for (let triangle = 0; triangle < index.count / 3; triangle += sampleStride) {
            const aIndex = index.getX(triangle * 3), bIndex = index.getX(triangle * 3 + 1), cIndex = index.getX(triangle * 3 + 2);
            const a = new THREE.Vector3().fromBufferAttribute(position, aIndex);
            const b = new THREE.Vector3().fromBufferAttribute(position, bIndex);
            const c = new THREE.Vector3().fromBufferAttribute(position, cIndex);
            const cross = b.clone().sub(a).cross(c.clone().sub(a));
            assetTriangles += 1;
            if (!Number.isFinite(cross.lengthSq()) || cross.lengthSq() < 1e-12) { assetDegenerate += 1; continue; }
            cross.normalize();
            const averagedNormal = new THREE.Vector3(
              normal.getX(aIndex) + normal.getX(bIndex) + normal.getX(cIndex),
              normal.getY(aIndex) + normal.getY(bIndex) + normal.getY(cIndex),
              normal.getZ(aIndex) + normal.getZ(bIndex) + normal.getZ(cIndex)
            ).normalize();
            if (cross.dot(averagedNormal) < 0.25) assetInverted += 1;
          }
        });
        triangleCount += assetTriangles;
        degenerateCount += assetDegenerate;
        invertedCount += assetInverted;
        return {
          id: profile.steps[assetIndex].id,
          algorithm: profile.steps[assetIndex].algorithm,
          confidence: profile.steps[assetIndex].confidence,
          sampledTriangles: assetTriangles,
          customTopology: assetCustom,
          degenerateTriangles: assetDegenerate,
          invertedNormals: assetInverted,
        };
      });
      const placementPairs = [];
      for (let left = 0; left < profile.steps.length; left += 1) {
        for (let right = left + 1; right < profile.steps.length; right += 1) {
          const a = new THREE.Vector3().fromArray(profile.steps[left].position);
          const b = new THREE.Vector3().fromArray(profile.steps[right].position);
          placementPairs.push(a.distanceTo(b) >= 0.4);
        }
      }
      const metrics = {
        customTriangleTopology: customMeshCount === meshCount ? 1 : 0,
        windingConsistency: triangleCount ? 1 - invertedCount / triangleCount : 0,
        normalConsistency: triangleCount ? 1 - invertedCount / triangleCount : 0,
        degenerateTriangleRatio: triangleCount ? degenerateCount / triangleCount : 1,
        lightingReadability: meshCount ? readableMaterialCount / meshCount : 0,
        placementClearance: placementPairs.length ? placementPairs.filter(Boolean).length / placementPairs.length : 1,
        silhouetteReadability: assets.every((asset) => asset.sampledTriangles >= 4) ? 1 : 0,
        performanceBudget: triangleCount <= 120000 ? 1 : 0,
      };
      const filters = profile.generation?.failureFilters || [];
      const failures = filters.filter((filter) => {
        const actual = metrics[filter.metric];
        if (filter.operator === "min") return actual < filter.value;
        if (filter.operator === "max") return actual > filter.value;
        if (filter.operator === "equals") return actual !== filter.value;
        return true;
      }).map((filter) => ({ id: filter.id, actual: metrics[filter.metric], expected: filter.value }));
      return { passed: failures.length === 0, assets, failures, metrics, massiveSectorCount, massiveAssetCount };
    }

    const libraryValidation = validateLibraryAssets();

    const state = {
      phase: "intro",
      time: 0,
      test: { currentIndex: -1, built: 0, viewed: 0, validated: 0 },
      world: { committed: 0, expected: profile.steps.length, type: activeWorldTypeId, structure: activeWorldStructureId, structureValid: null },
      complete: false,
      quality: { canvasRendered: true, objectCount: profile.steps.length, environmentDetailInstances: grassCount + path.children.length, serializedCommits: true },
      editor: { enabled: editorMode, selectedIndex: 0, status: "draft", preview: "turntable", added: [] },
      library: libraryValidation,
      terrain: nexusTerrain ? {
        status: nexusTerrain.status,
        streamedChunkCount: validatedChunks.length,
        seamCount: nexusTerrain.seams.seamCount,
        maxHeightDelta: nexusTerrain.seams.maxHeightDelta,
        maxNormalDelta: nexusTerrain.seams.maxNormalDelta,
        bandedContract: nexusTerrain.banded.passed,
        groundingProfiles: nexusTerrain.grounding.passed,
        flightPathValidated: nexusTerrain.flightPath.every((point) => point.x >= nexusTerrain.validatedBounds.minX && point.x <= nexusTerrain.validatedBounds.maxX && point.z >= nexusTerrain.validatedBounds.minZ && point.z <= nexusTerrain.validatedBounds.maxZ),
        visibleChunkCount: 0,
        visibleChunkIds: [],
      } : null,
    };
    window.__NEXUS_SHOWCASE_STATE__ = state;

    let editorSelectedIndex = 0;
    let collisionHelper = null;

    function rememberMaterialState(root) {
      root.traverse((object) => {
        if (!object.isMesh && !object.isPoints && !object.isLine) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((surface) => {
          if (!surface || surface.userData.editorBaseColor) return;
          surface.userData.editorBaseColor = surface.color ? "#" + surface.color.getHexString() : null;
          surface.userData.editorBaseRoughness = surface.roughness;
        });
      });
    }

    [...testAssets, ...worldAssets].forEach(rememberMaterialState);

    function applyEditorOverride(index) {
      const override = editorOverrides[index];
      for (const root of [testAssets[index], worldAssets[index]]) {
        const meshes = [];
        root.traverse((object) => { if (object.isMesh || object.isPoints || object.isLine) meshes.push(object); });
        const visibleCount = Math.max(3, Math.ceil(meshes.length * override.detail / 100));
        meshes.forEach((object, meshIndex) => {
          object.visible = meshIndex < visibleCount;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((surface) => {
            if (!surface) return;
            if (surface.color && surface.userData.editorBaseColor) {
              surface.color.set(surface.userData.editorBaseColor).lerp(new THREE.Color(override.color), 0.28);
            }
            if ("roughness" in surface) surface.roughness = override.roughness;
            surface.wireframe = override.preview === "wireframe";
            surface.needsUpdate = true;
          });
        });
      }
    }

    function regenerateEditorAsset(index) {
      const step = { ...profile.steps[index], seed: editorOverrides[index].seed };
      studio.remove(testAssets[index]);
      forestWorld.remove(worldAssets[index]);
      const testObject = factories[step.type](step, "test");
      testObject.visible = false;
      studio.add(testObject);
      testAssets[index] = testObject;
      const worldObject = factories[step.type](step, "world");
      worldObject.position.fromArray(step.position);
      worldObject.userData.target = worldObject.position.clone();
      worldObject.userData.targetYaw = Number(step.yaw || 0);
      worldObject.userData.step = step;
      worldObject.visible = false;
      forestWorld.add(worldObject);
      worldAssets[index] = worldObject;
      rememberMaterialState(testObject);
      rememberMaterialState(worldObject);
      applyEditorOverride(index);
    }

    function updateTerrainPalette() {
      const position = ground.geometry.getAttribute("position");
      const colors = ground.geometry.getAttribute("color");
      for (let index = 0; index < position.count; index += 1) {
        const height = position.getY(index);
        const color = new THREE.Color(height > 0.42 ? activeWorldType.terrainHigh : height < -0.25 ? activeWorldType.terrainLow : activeWorldType.terrainMid);
        colors.setXYZ(index, color.r, color.g, color.b);
      }
      colors.needsUpdate = true;
    }

    function setWorldType(id) {
      if (!worldTypes[id]) return false;
      activeWorldTypeId = id;
      activeWorldType = worldTypes[id];
      sky.material.uniforms.topColor.value.set(activeWorldType.skyTop);
      sky.material.uniforms.bottomColor.value.set(activeWorldType.skyBottom);
      scene.fog.color.set(activeWorldType.fog);
      sun.color.set(activeWorldType.sun);
      river.material.color.set(activeWorldType.river);
      grass.material.color.set(activeWorldType.detail);
      updateTerrainPalette();
      document.querySelectorAll(".world-name").forEach((element) => { element.textContent = activeWorldType.label; });
      worldTypeSelect.value = id;
      editorWorldTypeSelect.value = id;
      state.world.type = id;
      renderAt(state.time);
      return true;
    }

    function setWorldStructure(id) {
      if (!worldStructures[id]) return false;
      activeWorldStructureId = id;
      activeWorldStructure = worldStructures[id];
      editorWorldStructureSelect.value = id;
      state.world.structure = id;
      state.world.structureValid = null;
      rebuildWorldStructureGuide();
      if (editorMode) setEditorStatus("draft", activeWorldStructure.label + " requires validation");
      renderAt(state.time);
      return true;
    }

    function opacityWindow(time, start, fadeIn, end, fadeOut) {
      return Math.min(smooth((time - start) / fadeIn), smooth((end - time) / fadeOut));
    }

    function setValidatedFlightCamera(flight) {
      const points = nexusTerrain.flightPath;
      const scaled = flight * Math.max(1, points.length - 1);
      const index = Math.min(points.length - 2, Math.floor(scaled));
      const amount = scaled - index;
      const current = points[index] || points[0];
      const next = points[index + 1] || current;
      const x = lerp(current.x, next.x, amount);
      const z = lerp(current.z, next.z, amount);
      const directionX = next.x - current.x;
      const directionZ = next.z - current.z;
      const directionLength = Math.hypot(directionX, directionZ) || 1;
      const forwardX = directionX / directionLength;
      const forwardZ = directionZ / directionLength;
      const cameraConfig = profile.generation.nexusTerrain.camera;
      const lateral = Math.sin(flight * Math.PI * 2) * Number(cameraConfig.lateralOffset);
      const cameraX = x - forwardX * Number(cameraConfig.trailDistance) - forwardZ * lateral;
      const cameraZ = z - forwardZ * Number(cameraConfig.trailDistance) + forwardX * lateral;
      const lookX = x + forwardX * Number(cameraConfig.lookAhead);
      const lookZ = z + forwardZ * Number(cameraConfig.lookAhead);
      const visibleChunkIds = nexusTerrain.coverage.steps[Math.min(index, nexusTerrain.coverage.steps.length - 1)]?.visible || [];
      const visibleChunks = new Set(visibleChunkIds);
      validatedTerrainGroup.children.forEach((surface) => { surface.visible = visibleChunks.has(surface.userData.validatedChunkId); });
      massiveWorld.children.forEach((object) => { object.visible = visibleChunks.has(object.userData.validatedChunkId); });
      state.terrain.visibleChunkIds = visibleChunkIds;
      state.terrain.visibleChunkCount = visibleChunkIds.length;
      camera.position.set(cameraX, terrainHeightAt(cameraX, cameraZ) + Number(cameraConfig.height), cameraZ);
      camera.lookAt(lookX, terrainHeightAt(lookX, lookZ) + 1.1, lookZ);
    }

    function renderLiveLoopAt(time) {
      const t = clamp(Number(time) || 0, 0, profile.durationSeconds);
      const introEnd = 2;
      const libraryEnd = Math.min(32, profile.durationSeconds * 0.54);
      const completionStart = profile.durationSeconds - 4;
      const inspectionSpan = (libraryEnd - introEnd) / profile.steps.length;
      const inspectionProgress = Math.max(0, (t - introEnd) / inspectionSpan);
      const activeIndex = Math.min(profile.steps.length - 1, Math.max(0, Math.floor(inspectionProgress)));
      const activeLocal = clamp(inspectionProgress - activeIndex);
      const cycle = profile.loopPlan?.[activeIndex] || {};
      const step = profile.steps[activeIndex];
      const agent = profile.agents.find((item) => item.id === step.agent);
      const inspecting = t >= introEnd && t < libraryEnd;
      const flying = t >= libraryEnd;
      state.time = t;
      state.phase = t < introEnd ? "intro" : t >= completionStart ? "complete" : inspecting ? "library-inspection" : "massive-world-flight";

      intro.style.opacity = String(opacityWindow(t, 0.08, 0.45, introEnd, 0.45));
      transitionCopy.style.opacity = "0";
      completion.style.opacity = String(opacityWindow(t, completionStart, 0.55, profile.durationSeconds, 0.35));
      studio.visible = inspecting;
      scanRing.visible = false;
      testAssets.forEach((object) => { object.visible = false; });
      candidateAssets.flat().forEach((object) => { object.visible = false; });
      forestWorld.visible = flying;
      forestWorld.scale.setScalar(1);
      ground.material.opacity = 1;
      ground.material.transparent = false;
      river.material.opacity = 0.78;

      worldAssets.forEach((object, index) => {
        object.visible = flying && !nexusTerrain;
        if (!flying) return;
        const finalScale = (worldScale[object.userData.step.type] || 1) * editorOverrides[index].scale;
        object.scale.setScalar(finalScale);
        object.position.copy(object.userData.target);
        object.rotation.y = object.userData.targetYaw + THREE.MathUtils.degToRad(editorOverrides[index].rotation);
        object.traverse((child) => { if (child.isMesh || child.isPoints || child.isLine) child.visible = true; });
      });
      massiveWorld.visible = flying;

      if (inspecting) {
        const candidates = candidateAssets[activeIndex];
        const candidateIndex = Math.min(candidates.length - 1, Math.floor(activeLocal * Math.max(1, candidates.length)));
        const candidate = candidates[Math.max(0, candidateIndex)];
        const attempt = candidate?.userData.candidate;
        if (candidate) {
          candidate.visible = true;
          const candidateLocal = (activeLocal * candidates.length) % 1;
          candidate.scale.setScalar(Math.max(0.001, easeOutBack(candidateLocal / 0.45) * (testScale[step.type] || 1)));
          candidate.rotation.y = t * 0.62;
        }
        const promoted = attempt?.algorithm === cycle.selectedAlgorithm && attempt?.seed === cycle.selectedSeed;
        const stage = promoted ? "PROMOTE" : "FAIL FILTER";
        const detail = promoted
          ? attempt.algorithm + " / confidence " + attempt.confidence.toFixed(2) + " / custom wound triangles"
          : (attempt?.algorithm || "candidate") + " / " + (attempt?.failures || ["confidence"]).join(", ");
        agentCopy.textContent = agent.name.toUpperCase() + " / " + stage + " / ASSET " + String(activeIndex + 1).padStart(2, "0") + "/15";
        titleCopy.textContent = step.label;
        phaseCopy.textContent = detail;
        assetCopy.style.opacity = String(Math.min(smooth(activeLocal / 0.08), smooth((1 - activeLocal) / 0.05)));
        assetCopy.style.borderColor = agent.color;
      } else if (flying && t < completionStart) {
        agentCopy.textContent = nexusTerrain ? "APPROVED LIBRARY / VALIDATED STREAMING FLIGHT" : "APPROVED LIBRARY / MASSIVE WORLD FLIGHT TEST";
        titleCopy.textContent = "Everglen multi-sector validation";
        phaseCopy.textContent = nexusTerrain
          ? nexusTerrain.chunks.length + " chunks / " + nexusTerrain.seams.seamCount + " seamless edges / grounded ProtoKit assets"
          : libraryValidation.massiveSectorCount + " sectors / " + libraryValidation.massiveAssetCount + " placed assets / topology, lighting, and placement passed";
        assetCopy.style.opacity = "1";
        assetCopy.style.borderColor = "#68d391";
      } else {
        assetCopy.style.opacity = "0";
      }

      state.test.currentIndex = activeIndex;
      state.test.built = flying ? profile.steps.length : Math.min(profile.steps.length, activeIndex + 1);
      state.test.viewed = flying ? profile.steps.length : Math.min(profile.steps.length, activeIndex + 1);
      state.test.validated = flying ? profile.steps.length : activeIndex;
      state.world.committed = flying ? profile.steps.length : 0;
      state.complete = t >= completionStart
        && state.world.committed === profile.steps.length
        && libraryValidation.passed
        && (!nexusTerrain || state.terrain?.status === "passed");

      if (inspecting || t < introEnd) {
        const angle = -0.58 + t * 0.16;
        camera.position.set(Math.sin(angle) * 8.8, 4.8, Math.cos(angle) * 8.8);
        camera.lookAt(0, 1.45, 0);
      } else if (nexusTerrain) {
        const flight = clamp((t - libraryEnd) / Math.max(1, profile.durationSeconds - libraryEnd));
        setValidatedFlightCamera(flight);
      } else {
        const flight = clamp((t - libraryEnd) / Math.max(1, profile.durationSeconds - libraryEnd));
        const angle = -1.05 + flight * Math.PI * 2.15;
        const radius = Number(massiveConfig?.flightRadius || 48) * (0.78 + Math.sin(flight * Math.PI) * 0.22);
        const height = Number(massiveConfig?.flightHeight || 10) + Math.sin(flight * Math.PI * 3) * 2.4;
        camera.position.set(Math.sin(angle) * radius, height, Math.cos(angle) * radius);
        const ahead = angle + 0.34;
        camera.lookAt(Math.sin(ahead) * radius * 0.52, 1.1, Math.cos(ahead) * radius * 0.52);
      }
      if (worldAssets[12]?.children[0]) worldAssets[12].rotation.y = t * 0.12;
      river.material.clearcoatRoughness = 0.18 + Math.sin(t * 0.7) * 0.04;
      renderer.render(scene, camera);
      window.__NEXUS_SHOWCASE_STATE__ = JSON.parse(JSON.stringify(state));
      return window.__NEXUS_SHOWCASE_STATE__;
    }

    function renderAt(time) {
      if (liveLoopMode) return renderLiveLoopAt(time);
      const t = clamp(Number(time) || 0, 0, profile.durationSeconds);
      state.time = t;
      const testSpan = (timeline.testEnd - timeline.testStart) / profile.steps.length;
      const worldSpan = (timeline.worldEnd - timeline.worldStart) / profile.steps.length;
      const transitionProgress = smooth((t - timeline.testEnd) / (timeline.transitionEnd - timeline.testEnd));
      const worldReveal = smooth((t - timeline.testEnd) / 1.5);
      intro.style.opacity = String(opacityWindow(t, 0.08, 0.45, timeline.introEnd, 0.35));
      transitionCopy.style.opacity = String(opacityWindow(t, timeline.testEnd - 0.05, 0.5, timeline.transitionEnd, 0.5));
      completion.style.opacity = String(opacityWindow(t, timeline.completionStart, 0.55, profile.durationSeconds, 0.45));

      const inTest = t >= timeline.testStart && t < timeline.testEnd;
      if (inTest) {
        state.phase = "test";
        const progress = (t - timeline.testStart) / testSpan;
        const index = Math.min(profile.steps.length - 1, Math.floor(progress));
        const local = progress - index;
        const step = profile.steps[index];
        const agent = profile.agents.find((item) => item.id === step.agent);
        state.test.currentIndex = index;
        state.test.built = index + (local >= 0.42 ? 1 : 0);
        state.test.viewed = index + (local >= 0.72 ? 1 : 0);
        state.test.validated = index + (local >= 0.92 ? 1 : 0);
        testAssets.forEach((object, objectIndex) => {
          object.visible = objectIndex === index;
          if (objectIndex !== index) return;
          const entrance = easeOutBack(local / 0.24);
          const exit = 1 - smooth((local - 0.91) / 0.09);
          const scale = Math.max(0.0001, entrance * exit * (testScale[step.type] || 1) * editorOverrides[objectIndex].scale);
          object.scale.setScalar(scale);
          object.position.set(0, 0.18 + (1 - smooth(local / 0.26)) * -0.7, 0);
          object.rotation.y = index * 0.52 + t * 0.72 + THREE.MathUtils.degToRad(editorOverrides[objectIndex].rotation);
        });
        const phase = local < 0.42 ? "BUILD" : local < 0.72 ? "VIEW" : local < 0.92 ? "VALIDATE" : "PASS";
        agentCopy.textContent = "CODEX / " + profile.harness.name + " / " + agent.name;
        titleCopy.textContent = step.label;
        phaseCopy.textContent = phase + "  " + String(index + 1).padStart(2, "0") + "/" + String(profile.steps.length).padStart(2, "0");
        assetCopy.style.opacity = String(Math.min(smooth(local / 0.13), smooth((1 - local) / 0.08)));
        assetCopy.style.borderColor = agent.color;
        scanRing.visible = local >= 0.72;
        scanRing.position.y = 0.2 + smooth((local - 0.72) / 0.2) * 3.7;
        scanRing.scale.setScalar(0.75 + smooth((local - 0.72) / 0.2) * 0.55);
        scanRing.material.color.set(local >= 0.92 ? 0x9cf3bc : step.color);
      } else {
        assetCopy.style.opacity = "0";
        scanRing.visible = false;
        testAssets.forEach((object) => { object.visible = false; });
        if (t >= timeline.testEnd) {
          state.test.currentIndex = profile.steps.length - 1;
          state.test.built = profile.steps.length;
          state.test.viewed = profile.steps.length;
          state.test.validated = profile.steps.length;
        }
      }

      const studioExit = smooth((t - timeline.testEnd) / 0.75);
      studio.visible = t < timeline.testEnd + 0.85;
      studio.scale.setScalar(Math.max(0.001, 1 - studioExit * 0.96));
      studio.rotation.y = transitionProgress * -0.35;
      forestWorld.visible = t >= timeline.testEnd;
      forestWorld.scale.setScalar(Math.max(0.001, 0.82 + worldReveal * 0.18));
      ground.material.opacity = worldReveal;
      ground.material.transparent = worldReveal < 1;
      river.material.opacity = worldReveal * 0.78;

      if (t >= timeline.worldStart) {
        state.phase = t >= timeline.completionStart ? "complete" : "world";
        const worldProgress = (t - timeline.worldStart) / worldSpan;
        const activeWorldIndex = Math.min(profile.steps.length - 1, Math.max(0, Math.floor(worldProgress)));
        worldAssets.forEach((object, index) => {
          const objectStart = timeline.worldStart + index * worldSpan;
          const progress = smooth((t - objectStart) / (worldSpan * 0.78));
          object.visible = progress > 0;
          const scale = Math.max(0.0001, easeOutBack(progress) * (worldScale[object.userData.step.type] || 1) * editorOverrides[index].scale);
          object.scale.setScalar(scale);
          object.position.copy(object.userData.target);
          object.position.y -= (1 - progress) * 1.2;
          object.rotation.y = object.userData.targetYaw + (1 - progress) * -0.32 + THREE.MathUtils.degToRad(editorOverrides[index].rotation);
        });
        state.world.committed = t >= timeline.worldEnd ? profile.steps.length : Math.max(0, activeWorldIndex + (worldProgress - activeWorldIndex > 0.82 ? 1 : 0));
        if (t < timeline.completionStart) {
          const step = profile.steps[activeWorldIndex];
          const agent = profile.agents.find((item) => item.id === step.agent);
          agentCopy.textContent = "WORLD APP / " + agent.name + " / VERIFIED ASSET";
          titleCopy.textContent = "Commit " + step.label;
          phaseCopy.textContent = "WORLD COMMIT  " + String(activeWorldIndex + 1).padStart(2, "0") + "/15";
          assetCopy.style.opacity = String(opacityWindow(t, timeline.worldStart, 0.35, timeline.completionStart, 0.35));
          assetCopy.style.borderColor = agent.color;
        }
      } else if (t >= timeline.testEnd) {
        state.phase = "transition";
      } else if (!inTest) {
        state.phase = "intro";
      }

      if (worldAssets[12]?.children[0]) {
        worldAssets[12].rotation.y = t * 0.12;
        const positions = worldAssets[12].children[0].geometry?.getAttribute("position");
        if (positions && worldAssets[12].children[0].geometry.userData.basePositions) {
          for (let index = 0; index < positions.count; index += 1) {
            const baseY = worldAssets[12].children[0].geometry.userData.basePositions[index * 3 + 1];
            positions.setY(index, baseY + Math.sin(t * 1.7 + index * 0.37) * 0.055);
          }
          positions.needsUpdate = true;
        }
      }
      river.material.clearcoatRoughness = 0.18 + Math.sin(t * 0.7) * 0.04;

      if (t < timeline.testEnd) {
        const angle = -0.58 + t * 0.1;
        const activeType = profile.steps[state.test.currentIndex]?.type;
        const tallAsset = ["oak", "birch", "pine", "willow", "shrine", "arch", "lantern", "monolith"].includes(activeType);
        const testDistance = tallAsset ? 9.35 : 8.2;
        camera.position.set(Math.sin(angle) * testDistance, tallAsset ? 4.9 : 4.35, Math.cos(angle) * testDistance);
        camera.lookAt(0, tallAsset ? 1.65 : 1.25, 0);
      } else if (t < timeline.transitionEnd) {
        const amount = transitionProgress;
        const angle = -0.58 + t * 0.1;
        const start = new THREE.Vector3(Math.sin(angle) * 8.2, 4.35, Math.cos(angle) * 8.2);
        const end = new THREE.Vector3(-13.6, 9.2, 14.5);
        camera.position.lerpVectors(start, end, amount);
        camera.lookAt(0, lerp(1.25, 0.8, amount), 0);
      } else if (nexusTerrain) {
        const flight = clamp((t - timeline.transitionEnd) / Math.max(1, profile.durationSeconds - timeline.transitionEnd));
        setValidatedFlightCamera(flight);
      } else {
        const worldTime = t - timeline.transitionEnd;
        const angle = -0.82 + worldTime * 0.115;
        const finalAmount = smooth((t - timeline.completionStart) / 2.5);
        const distance = lerp(18.4, 15.2, finalAmount);
        const height = lerp(8.8, 7.1, finalAmount);
        camera.position.set(Math.sin(angle) * distance, height, Math.cos(angle) * distance);
        camera.lookAt(0, 0.9, 0);
      }

      state.complete = t >= timeline.completionStart
        && state.world.committed === profile.steps.length
        && libraryValidation.passed
        && (!nexusTerrain || state.terrain?.status === "passed");
      if (editorMode) {
        intro.style.opacity = "0";
        assetCopy.style.opacity = "0";
        transitionCopy.style.opacity = "0";
        completion.style.opacity = "0";
      }
      renderer.render(scene, camera);
      window.__NEXUS_SHOWCASE_STATE__ = JSON.parse(JSON.stringify(state));
      return window.__NEXUS_SHOWCASE_STATE__;
    }

    function editorObjectTime(index) {
      const testSpan = (timeline.testEnd - timeline.testStart) / profile.steps.length;
      return timeline.testStart + (index + 0.56) * testSpan;
    }

    function setEditorStatus(status, message) {
      editorOverrides[editorSelectedIndex].validation = status;
      state.editor.status = status;
      editorStatus.textContent = status.toUpperCase() + " / " + message;
      addButton.disabled = status !== "passed";
    }

    function updateEditorOutputs() {
      const override = editorOverrides[editorSelectedIndex];
      editorInputs.seed.value = override.seed;
      editorInputs.scale.value = String(override.scale);
      editorInputs.rotation.value = String(override.rotation);
      editorInputs.roughness.value = String(override.roughness);
      editorInputs.detail.value = String(override.detail);
      editorInputs.color.value = override.color;
      editorOutputs.scale.textContent = override.scale.toFixed(2);
      editorOutputs.rotation.textContent = Math.round(override.rotation) + "deg";
      editorOutputs.roughness.textContent = override.roughness.toFixed(2);
      editorOutputs.detail.textContent = Math.round(override.detail) + "%";
      document.querySelectorAll("[data-preview]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.preview === override.preview));
      });
      addButton.disabled = override.validation !== "passed";
      editorStatus.textContent = override.validation.toUpperCase() + " / " + profile.steps[editorSelectedIndex].label;
    }

    function updateCollisionPreview() {
      if (collisionHelper) {
        scene.remove(collisionHelper);
        collisionHelper.geometry.dispose();
        collisionHelper.material.dispose();
        collisionHelper = null;
      }
      if (editorOverrides[editorSelectedIndex].preview === "collision") {
        collisionHelper = new THREE.BoxHelper(testAssets[editorSelectedIndex], 0x72c7e8);
        scene.add(collisionHelper);
      }
    }

    function selectEditorObject(index) {
      editorSelectedIndex = clamp(Math.round(Number(index) || 0), 0, profile.steps.length - 1);
      state.editor.selectedIndex = editorSelectedIndex;
      state.editor.preview = editorOverrides[editorSelectedIndex].preview;
      editorObjectSelect.value = String(editorSelectedIndex);
      renderAt(editorObjectTime(editorSelectedIndex));
      applyEditorOverride(editorSelectedIndex);
      updateEditorOutputs();
      updateCollisionPreview();
      renderer.render(scene, camera);
      return JSON.parse(JSON.stringify(state.editor));
    }

    function setPreviewMode(mode) {
      if (!["turntable", "wireframe", "collision"].includes(mode)) return false;
      editorOverrides[editorSelectedIndex].preview = mode;
      state.editor.preview = mode;
      applyEditorOverride(editorSelectedIndex);
      updateEditorOutputs();
      updateCollisionPreview();
      setEditorStatus("previewed", mode + " preview active");
      renderer.render(scene, camera);
      return true;
    }

    function valueAtPath(target, path) {
      return String(path || "").split(".").filter(Boolean).reduce((value, key) => value?.[key], target);
    }

    function evaluateWorldRequirement(structure, requirement) {
      const actual = valueAtPath(structure, requirement.path);
      let pass = false;
      if (requirement.operator === "equals") pass = actual === requirement.value;
      if (requirement.operator === "min") pass = Number.isFinite(Number(actual)) && Number(actual) >= Number(requirement.value);
      if (requirement.operator === "matches") {
        try {
          pass = new RegExp(String(requirement.value)).test(String(actual ?? ""));
        } catch {
          pass = false;
        }
      }
      return { label: requirement.label || requirement.path, pass };
    }

    function validateWorldStructure(structure = activeWorldStructure) {
      if (!structure) return [{ label: "A world structure is selected", pass: false }];
      const requirements = Array.isArray(structure.requirements) ? structure.requirements : [];
      return [
        { label: structure.label + " declares a coordinate model", pass: Boolean(structure.coordinateModel) },
        { label: structure.label + " declares validation requirements", pass: requirements.length > 0 },
        ...requirements.map((requirement) => evaluateWorldRequirement(structure, requirement)),
      ];
    }

    function validateEditorObject() {
      const override = editorOverrides[editorSelectedIndex];
      let renderableCount = 0;
      testAssets[editorSelectedIndex].traverse((object) => {
        if (object.isMesh || object.isPoints || object.isLine) renderableCount += 1;
      });
      const structureChecks = validateWorldStructure();
      state.world.structureValid = structureChecks.every((check) => check.pass);
      const checks = [
        ...structureChecks,
        { label: "Variant seed is explicit", pass: override.seed.trim().length > 0 },
        { label: "Scale stays inside the 1.55 world budget", pass: override.scale <= 1.55 },
        { label: "Detail budget preserves at least 35 percent", pass: override.detail >= 35 },
        { label: "Surface roughness stays physically readable", pass: override.roughness >= 0.12 },
        { label: "Generated preview contains renderable geometry", pass: renderableCount > 0 },
      ];
      validationResults.replaceChildren(...checks.map((check) => {
        const item = document.createElement("li");
        item.textContent = (check.pass ? "PASS / " : "FAIL / ") + check.label;
        item.style.color = check.pass ? "rgba(255,255,255,.72)" : "#ff9b79";
        return item;
      }));
      const passed = checks.every((check) => check.pass);
      setEditorStatus(passed ? "passed" : "failed", passed ? "ready to add" : "resolve failed checks");
      return { passed, checks, renderableCount, worldStructure: activeWorldStructureId };
    }

    function addEditorObject() {
      const override = editorOverrides[editorSelectedIndex];
      if (override.validation !== "passed") return false;
      override.added = true;
      if (!state.editor.added.includes(profile.steps[editorSelectedIndex].id)) {
        state.editor.added.push(profile.steps[editorSelectedIndex].id);
      }
      const worldSpan = (timeline.worldEnd - timeline.worldStart) / profile.steps.length;
      renderAt(timeline.worldStart + (editorSelectedIndex + 0.9) * worldSpan);
      setEditorStatus("added", "committed to " + activeWorldType.label + " / " + activeWorldStructure.label);
      addButton.disabled = true;
      return true;
    }

    function setEditorControl(name, value) {
      const input = editorInputs[name];
      if (!input) return false;
      input.value = String(value);
      input.dispatchEvent(new Event(name === "seed" ? "change" : "input", { bubbles: true }));
      return true;
    }

    function resize() {
      const panelWidth = editorMode && window.innerWidth >= 900 ? editorPanel.getBoundingClientRect().width : 0;
      const width = Math.max(320, window.innerWidth - panelWidth);
      canvas.style.width = width + "px";
      canvas.style.height = window.innerHeight + "px";
      renderer.setSize(width, window.innerHeight, false);
      camera.aspect = width / window.innerHeight;
      camera.updateProjectionMatrix();
      renderAt(state.time);
    }
    worldTypeSelect.value = activeWorldTypeId;
    document.body.dataset.captureHuman = String(humanCaptureMode);
    window.addEventListener("mousemove", (event) => {
      if (!humanCaptureMode) return;
      capturePointer.style.left = event.clientX + "px";
      capturePointer.style.top = event.clientY + "px";
    });
    window.addEventListener("mousedown", () => { if (humanCaptureMode) capturePointer.dataset.pressed = "true"; });
    window.addEventListener("mouseup", () => { if (humanCaptureMode) capturePointer.dataset.pressed = "false"; });
    worldTypeSelect.addEventListener("change", () => setWorldType(worldTypeSelect.value));
    editorPanel.hidden = !editorMode;
    document.body.dataset.editor = String(editorMode);
    worldTypeControl.hidden = captureMode || editorMode;
    editorWorldTypeSelect.value = activeWorldTypeId;
    editorWorldTypeSelect.addEventListener("change", () => setWorldType(editorWorldTypeSelect.value));
    editorWorldStructureSelect.value = activeWorldStructureId;
    editorWorldStructureSelect.addEventListener("change", () => setWorldStructure(editorWorldStructureSelect.value));
    editorObjectSelect.addEventListener("change", () => selectEditorObject(editorObjectSelect.value));
    for (const name of ["scale", "rotation", "roughness", "detail", "color"]) {
      editorInputs[name].addEventListener("input", () => {
        const override = editorOverrides[editorSelectedIndex];
        override[name] = name === "color" ? editorInputs[name].value : Number(editorInputs[name].value);
        applyEditorOverride(editorSelectedIndex);
        renderAt(editorObjectTime(editorSelectedIndex));
        updateEditorOutputs();
        updateCollisionPreview();
        setEditorStatus("draft", "changes require validation");
        renderer.render(scene, camera);
      });
    }
    editorInputs.seed.addEventListener("change", () => {
      editorOverrides[editorSelectedIndex].seed = editorInputs.seed.value.trim();
      regenerateEditorAsset(editorSelectedIndex);
      renderAt(editorObjectTime(editorSelectedIndex));
      updateCollisionPreview();
      setEditorStatus("draft", "variant regenerated; validation required");
    });
    document.querySelectorAll("[data-preview]").forEach((button) => {
      button.addEventListener("click", () => setPreviewMode(button.dataset.preview));
    });
    document.querySelector('[data-action="preview"]').addEventListener("click", () => setPreviewMode(editorOverrides[editorSelectedIndex].preview));
    document.querySelector('[data-action="validate"]').addEventListener("click", validateEditorObject);
    addButton.addEventListener("click", addEditorObject);
    window.addEventListener("resize", resize);
    function startRealtime() {
      const playbackStartedAt = performance.now();
      function play(now) {
        renderAt(Math.min(profile.durationSeconds, (now - playbackStartedAt) / 1000));
        if (now - playbackStartedAt < profile.durationSeconds * 1000) requestAnimationFrame(play);
      }
      requestAnimationFrame(play);
    }
    window.__NEXUS_SHOWCASE__ = {
      listWorldStructures: () => Object.keys(worldStructures),
      listWorldTypes: () => Object.keys(worldTypes),
      renderAt,
      startRealtime,
      setWorldStructure,
      setWorldType,
    };
    window.__WORLD_HARNESS_EDITOR__ = {
      addToWorld: addEditorObject,
      getState: () => ({ selected: profile.steps[editorSelectedIndex].id, worldType: activeWorldTypeId, worldStructure: activeWorldStructureId, override: { ...editorOverrides[editorSelectedIndex] }, editor: JSON.parse(JSON.stringify(state.editor)), world: JSON.parse(JSON.stringify(state.world)) }),
      listWorldStructures: () => Object.keys(worldStructures),
      preview: setPreviewMode,
      selectObject: selectEditorObject,
      setControl: setEditorControl,
      setWorldStructure,
      validate: validateEditorObject,
      validateWorldStructure,
    };
    rebuildWorldStructureGuide();
    resize();
    if (editorMode) selectEditorObject(0);
    document.body.dataset.ready = "true";
    if (!captureMode && !editorMode) {
      startRealtime();
    } else if (editorMode) {
      let editorFrameAt = performance.now();
      function editorPlay(now) {
        const deltaSeconds = Math.min(0.1, Math.max(0, (now - editorFrameAt) / 1000));
        editorFrameAt = now;
        if (editorOverrides[editorSelectedIndex].preview === "turntable" && testAssets[editorSelectedIndex].visible) {
          testAssets[editorSelectedIndex].rotation.y += deltaSeconds * 0.36;
          if (collisionHelper) collisionHelper.update();
          renderer.render(scene, camera);
        }
        requestAnimationFrame(editorPlay);
      }
      requestAnimationFrame(editorPlay);
    }
  </script>
</body>
</html>`;
}
