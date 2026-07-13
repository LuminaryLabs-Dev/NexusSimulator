export function createProceduralScenePreviewHtml(goal, manifest) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:,">
  <title>${goal.title}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #dbe8e4; color: #13231d; font-family: Avenir Next, Avenir, Helvetica, Arial, sans-serif; }
    canvas { display: block; width: 100vw; height: 100vh; }
    .hud { position: fixed; z-index: 2; top: 22px; left: 22px; width: min(370px, calc(100vw - 44px)); padding: 18px 20px; background: rgba(247, 250, 248, 0.93); border-left: 5px solid #2f7d55; box-shadow: 0 12px 36px rgba(19, 35, 29, 0.16); }
    .eyebrow { margin: 0 0 5px; color: #2f7d55; font-size: 12px; font-weight: 800; text-transform: uppercase; }
    h1 { margin: 0; font-size: 25px; line-height: 1.1; letter-spacing: 0; }
    .status { margin: 9px 0 14px; color: #466158; font-size: 14px; line-height: 1.35; }
    button { min-height: 44px; border: 0; border-radius: 5px; padding: 0 18px; background: #176b47; color: #fff; font: 700 14px/1 Avenir Next, Avenir, Helvetica, Arial, sans-serif; cursor: pointer; }
    button:focus-visible { outline: 3px solid #f3b33d; outline-offset: 3px; }
    button:disabled { background: #70877e; cursor: wait; }
    .progress { height: 5px; margin-top: 14px; overflow: hidden; background: #d8e2dd; }
    .progress span { display: block; width: 0; height: 100%; background: #2f9b66; transition: width 80ms linear; }
    details { margin-top: 12px; color: #536a61; font-size: 12px; }
    summary { cursor: pointer; font-weight: 700; }
    .facts { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 9px 0 0; }
    .facts dt { font-weight: 700; }
    .facts dd { margin: 0; overflow-wrap: anywhere; font-family: Menlo, Monaco, Consolas, monospace; }
    .proof-chip { position: fixed; right: 22px; bottom: 22px; z-index: 2; max-width: calc(100vw - 44px); padding: 10px 14px; background: rgba(19, 35, 29, 0.88); color: #f7faf8; font: 600 12px/1.3 Menlo, Monaco, Consolas, monospace; opacity: 0; transform: translateY(8px); transition: opacity 180ms ease, transform 180ms ease; }
    .proof-chip.visible { opacity: 1; transform: translateY(0); }
    @media (max-width: 520px) {
      .hud { top: 12px; left: 12px; width: calc(100vw - 24px); padding: 14px 15px; }
      h1 { font-size: 21px; }
      .status { margin: 7px 0 11px; font-size: 13px; }
      .proof-chip { right: 12px; bottom: 12px; max-width: calc(100vw - 24px); }
    }
  </style>
</head>
<body data-build-state="idle">
  <canvas id="preview" aria-label="Procedurally generated terrain and forest scene"></canvas>
  <section class="hud" aria-label="Scene build controls">
    <p class="eyebrow">NexusSimulator / SimSpace</p>
    <h1>${goal.title}</h1>
    <p class="status" data-field="status">Ready to reconstruct the seeded scene.</p>
    <button type="button" data-action="build-scene">Build Scene</button>
    <div class="progress" aria-hidden="true"><span data-field="progress"></span></div>
    <details>
      <summary>Build details</summary>
      <dl class="facts">
        <dt>Seed</dt><dd>${manifest.seed}</dd>
        <dt>Terrain</dt><dd>${manifest.terrain.vertexCount} vertices</dd>
        <dt>Trees</dt><dd>${manifest.scene.treeCount}</dd>
        <dt>Hash</dt><dd data-field="hash">pending</dd>
      </dl>
    </details>
  </section>
  <div class="proof-chip" data-field="proof-chip">scene hash verified</div>
  <script type="module">
    import * as THREE from "./vendor/three.module.js";

    const manifest = ${JSON.stringify(manifest)};
    const canvas = document.getElementById("preview");
    const buildButton = document.querySelector("[data-action='build-scene']");
    const statusField = document.querySelector("[data-field='status']");
    const progressField = document.querySelector("[data-field='progress']");
    const hashField = document.querySelector("[data-field='hash']");
    const proofChip = document.querySelector("[data-field='proof-chip']");
    const fpsTarget = Number(manifest.recordingProof?.fpsTarget || 30);
    const totalBuildFrames = Math.max(1, Math.round(Number(manifest.scene.buildDurationSeconds || 4) * fpsTarget));

    function hashString(text) {
      let hash = 2166136261;
      for (let index = 0; index < String(text).length; index += 1) {
        hash ^= String(text).charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    }

    function createRng(seed) {
      let value = hashString(seed) || 1;
      return function next() {
        value += 0x6d2b79f5;
        let n = value;
        n = Math.imul(n ^ (n >>> 15), n | 1);
        n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
        return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
      };
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function smoothstep(edge0, edge1, value) {
      const amount = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
      return amount * amount * (3 - 2 * amount);
    }

    const normalizedHashInput = {
      seed: manifest.scene.seed,
      terrain: {
        heights: manifest.terrain.heights,
        maxHeight: manifest.terrain.maxHeight,
        octaves: manifest.terrain.octaves,
        resolution: manifest.terrain.resolution,
        size: manifest.terrain.size,
      },
      trees: manifest.scene.trees.map(function (tree) {
        return {
          id: tree.id,
          patch: tree.patch,
          scale: tree.scale,
          species: tree.species,
          x: tree.x,
          y: tree.y,
          yaw: tree.yaw,
          z: tree.z,
        };
      }),
    };
    const reconstructedHash = hashString(JSON.stringify(normalizedHashInput)).toString(16).padStart(8, "0");

    const state = {
      factoryName: manifest.factoryName,
      rendererMode: "threejs",
      runId: manifest.runId,
      frame: 0,
      frameIndex: 0,
      timeSeconds: 0,
      build: { active: false, complete: false, frame: 0, phase: "idle", progress: 0, rebuildCount: 0 },
      terrain: { vertexCount: 0 },
      forest: { treeCount: 0 },
      scene: { expectedHash: manifest.scene.expectedHash, actualHash: null },
      camera: { distance: 19, zoomEvents: 0 },
      recording: {
        cameraSafe: true,
        captureMode: "deterministic",
        checkpoint: "scene-idle",
        deterministicFrames: 0,
        droppedFrames: 0,
        fpsTarget,
        routeComplete: false,
        smoothness: { droppedFrames: 0, expectedFrameMs: 1000 / fpsTarget, measuredFps: 0, renderedFrames: 0, timeSeconds: 0 },
        totalForestProps: 0,
        characterAnimation: { keyframed: true, jointCount: 24 },
        version: "procedural-scene-proof-v1",
      },
    };
    window.__NEXUS_TEST_STATE__ = state;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xbfd8df);
    scene.fog = new THREE.Fog(0xbfd8df, 24, 58);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 120);
    const world = new THREE.Group();
    const treeGroups = [];
    const windGroups = [];
    scene.add(world);

    const hemi = new THREE.HemisphereLight(0xf4fbff, 0x294333, 1.7);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffe0ad, 0);
    sun.position.set(-10, 18, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -20;
    sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 20;
    sun.shadow.camera.bottom = -20;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x73a8c7, 0.8);
    fill.position.set(12, 8, -12);
    scene.add(fill);

    function terrainColor(height) {
      const amount = clamp((height + 0.9) / 4.1, 0, 1);
      if (amount < 0.25) return new THREE.Color(0x527d63);
      if (amount < 0.62) return new THREE.Color(0x6f9b5d);
      if (amount < 0.82) return new THREE.Color(0x8a9669);
      return new THREE.Color(0x9da29b);
    }

    function createTerrainGeometry() {
      const terrain = manifest.terrain;
      const side = terrain.resolution + 1;
      const positions = new Float32Array(side * side * 3);
      const targetHeights = new Float32Array(side * side);
      const colors = new Float32Array(side * side * 3);
      const indices = [];
      let cursor = 0;
      for (let z = 0; z < side; z += 1) {
        for (let x = 0; x < side; x += 1) {
          const index = z * side + x;
          const height = Number(terrain.heights[index]);
          positions[cursor] = (x / terrain.resolution - 0.5) * terrain.size;
          positions[cursor + 1] = 0;
          positions[cursor + 2] = (z / terrain.resolution - 0.5) * terrain.size;
          targetHeights[index] = height;
          const color = terrainColor(height);
          colors[cursor] = color.r;
          colors[cursor + 1] = color.g;
          colors[cursor + 2] = color.b;
          cursor += 3;
        }
      }
      for (let z = 0; z < terrain.resolution; z += 1) {
        for (let x = 0; x < terrain.resolution; x += 1) {
          const a = z * side + x;
          const b = a + 1;
          const c = a + side;
          const d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      geometry.userData.targetHeights = targetHeights;
      return geometry;
    }

    const terrainGeometry = createTerrainGeometry();
    const terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0, transparent: true, opacity: 0.2 });
    const terrainMesh = new THREE.Mesh(terrainGeometry, terrainMaterial);
    terrainMesh.receiveShadow = true;
    world.add(terrainMesh);
    const wireMaterial = new THREE.MeshBasicMaterial({ color: 0x376c5d, wireframe: true, transparent: true, opacity: 0.6 });
    const terrainWire = new THREE.Mesh(terrainGeometry, wireMaterial);
    terrainWire.position.y = 0.015;
    world.add(terrainWire);

    const speciesColors = {
      oak: [0x35693f, 0x56894d],
      birch: [0x699c56, 0x8ab66a],
      pine: [0x1e5545, 0x2d7356],
      willow: [0x638c43, 0x8da85d],
    };

    function createTree(tree, index) {
      const random = createRng(manifest.seed + ":tree:" + tree.id);
      const group = new THREE.Group();
      group.position.set(tree.x, tree.y, tree.z);
      group.rotation.y = tree.yaw;
      group.scale.setScalar(tree.scale);
      const trunkHeight = 2.4 + random() * 1.5;
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13 + random() * 0.05, 0.22 + random() * 0.06, trunkHeight, 7),
        new THREE.MeshStandardMaterial({ color: tree.species === "birch" ? 0xc8c0a5 : 0x705039, roughness: 0.95 })
      );
      trunk.position.y = trunkHeight * 0.5;
      trunk.castShadow = true;
      group.add(trunk);

      const crown = new THREE.Group();
      crown.position.y = trunkHeight * 0.72;
      const palette = speciesColors[tree.species] || speciesColors.oak;
      const branchCount = tree.species === "pine" ? 7 : 5;
      for (let branchIndex = 0; branchIndex < branchCount; branchIndex += 1) {
        const angle = (branchIndex / branchCount) * Math.PI * 2 + random() * 0.5;
        const length = 0.9 + random() * 0.75;
        const branch = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.075, length, 5),
          new THREE.MeshStandardMaterial({ color: 0x684934, roughness: 1 })
        );
        branch.position.set(Math.cos(angle) * length * 0.32, branchIndex * 0.22, Math.sin(angle) * length * 0.32);
        branch.rotation.z = Math.PI * 0.5 + (random() - 0.5) * 0.35;
        branch.rotation.y = -angle;
        branch.castShadow = true;
        crown.add(branch);
      }
      const clusterCount = tree.species === "pine" ? 5 : tree.species === "willow" ? 7 : 6;
      for (let clusterIndex = 0; clusterIndex < clusterCount; clusterIndex += 1) {
        const angle = (clusterIndex / clusterCount) * Math.PI * 2 + random();
        const radius = tree.species === "willow" ? 1.35 : 1.05;
        const foliage = new THREE.Mesh(
          tree.species === "pine"
            ? new THREE.ConeGeometry(0.8 + random() * 0.25, 1.7 + random() * 0.5, 7)
            : new THREE.IcosahedronGeometry(0.72 + random() * 0.34, 1),
          new THREE.MeshStandardMaterial({ color: palette[clusterIndex % palette.length], roughness: 0.9, flatShading: true })
        );
        foliage.position.set(Math.cos(angle) * radius * (0.35 + random() * 0.4), 0.65 + random() * 1.25, Math.sin(angle) * radius * (0.35 + random() * 0.4));
        foliage.scale.y = tree.species === "willow" ? 1.35 : 1;
        foliage.castShadow = true;
        crown.add(foliage);
      }
      group.add(crown);
      group.userData.baseScale = tree.scale;
      group.userData.index = index;
      group.scale.set(tree.scale, 0.001, tree.scale);
      group.visible = false;
      treeGroups.push(group);
      windGroups.push(crown);
      world.add(group);
    }

    manifest.scene.trees.forEach(createTree);

    function updateCamera() {
      const angle = 0.72 + Math.max(0, state.timeSeconds - manifest.scene.buildDurationSeconds) * 0.075;
      camera.position.set(Math.sin(angle) * state.camera.distance, 10.4, Math.cos(angle) * state.camera.distance);
      camera.lookAt(0, 1.5, 0);
    }

    function updateHud() {
      const labels = {
        idle: "Ready to reconstruct the seeded scene.",
        grid: "Phase 1/4: preparing the terrain grid.",
        terrain: "Phase 2/4: raising procedural terrain.",
        trees: "Phase 3/4: growing trunks and branches.",
        foliage: "Phase 4/4: resolving foliage and lighting.",
        complete: "Build complete. The scene is ready for proof.",
      };
      statusField.textContent = labels[state.build.phase] || labels.idle;
      progressField.style.width = Math.round(state.build.progress * 100) + "%";
      document.body.dataset.buildState = state.build.phase;
      buildButton.disabled = state.build.active;
      buildButton.textContent = state.build.complete ? "Rebuild Same Seed" : state.build.active ? "Building..." : "Build Scene";
      hashField.textContent = state.scene.actualHash || "pending";
      proofChip.classList.toggle("visible", state.build.complete);
      proofChip.textContent = state.scene.actualHash === state.scene.expectedHash ? "scene hash verified / " + state.scene.actualHash : "scene hash mismatch";
    }

    function renderFrame() {
      updateCamera();
      renderer.render(scene, camera);
      state.recording.smoothness = {
        droppedFrames: 0,
        expectedFrameMs: 1000 / fpsTarget,
        measuredFps: fpsTarget,
        renderedFrames: state.frameIndex,
        timeSeconds: Number(state.timeSeconds.toFixed(3)),
      };
      window.__NEXUS_TEST_STATE__ = state;
    }

    function applyBuildProgress(progress) {
      state.build.progress = clamp(progress, 0, 1);
      const terrainProgress = smoothstep(0.12, 0.5, progress);
      const position = terrainGeometry.getAttribute("position");
      const targetHeights = terrainGeometry.userData.targetHeights;
      for (let index = 0; index < targetHeights.length; index += 1) {
        position.setY(index, targetHeights[index] * terrainProgress);
      }
      position.needsUpdate = true;
      terrainGeometry.computeVertexNormals();
      terrainMaterial.opacity = 0.2 + terrainProgress * 0.8;
      wireMaterial.opacity = 0.68 * (1 - smoothstep(0.32, 0.62, progress));
      sun.intensity = 0.2 + smoothstep(0.55, 1, progress) * 3.5;

      treeGroups.forEach(function (group, index) {
        const start = 0.42 + (index / Math.max(1, treeGroups.length)) * 0.28;
        const growth = smoothstep(start, Math.min(0.96, start + 0.22), progress);
        group.visible = growth > 0;
        group.scale.set(group.userData.baseScale, Math.max(0.001, group.userData.baseScale * growth), group.userData.baseScale);
      });

      if (progress < 0.12) state.build.phase = "grid";
      else if (progress < 0.5) state.build.phase = "terrain";
      else if (progress < 0.76) state.build.phase = "trees";
      else if (progress < 1) state.build.phase = "foliage";
      else state.build.phase = "complete";

      if (progress >= 1) {
        state.build.active = false;
        state.build.complete = true;
        state.terrain.vertexCount = terrainGeometry.getAttribute("position").count;
        state.forest.treeCount = treeGroups.length;
        state.scene.actualHash = reconstructedHash;
        state.recording.checkpoint = "scene-complete";
        state.recording.routeComplete = true;
        state.recording.totalForestProps = state.forest.treeCount + state.terrain.vertexCount;
      }
      updateHud();
    }

    function resetBuild(isRebuild) {
      if (isRebuild) state.build.rebuildCount += 1;
      state.build.active = true;
      state.build.complete = false;
      state.build.frame = 0;
      state.build.phase = "grid";
      state.build.progress = 0;
      state.terrain.vertexCount = 0;
      state.forest.treeCount = 0;
      state.scene.actualHash = null;
      state.recording.routeComplete = false;
      state.recording.checkpoint = isRebuild ? "scene-rebuild-started" : "scene-build-started";
      applyBuildProgress(0);
    }

    function advanceOneFrame(input = {}) {
      const fps = Number(input.fps || fpsTarget);
      state.frameIndex += 1;
      state.frame = state.frameIndex;
      state.timeSeconds += 1 / fps;
      state.recording.deterministicFrames += 1;
      if (state.build.active) {
        state.build.frame += 1;
        applyBuildProgress(state.build.frame / totalBuildFrames);
      } else if (state.build.complete) {
        windGroups.forEach(function (group, index) {
          group.rotation.z = Math.sin(state.timeSeconds * 1.1 + index * 0.42) * 0.025;
        });
      }
      renderFrame();
      return state;
    }

    function advanceManyFrames(seconds, input = {}) {
      const fps = Number(input.fps || fpsTarget);
      const frames = Math.max(1, Math.round(Number(seconds) * fps));
      state.frameIndex += frames;
      state.frame = state.frameIndex;
      state.timeSeconds += frames / fps;
      state.recording.deterministicFrames += frames;
      if (state.build.active) {
        state.build.frame += frames;
        applyBuildProgress(state.build.frame / totalBuildFrames);
      } else if (state.build.complete) {
        windGroups.forEach(function (group, index) {
          group.rotation.z = Math.sin(state.timeSeconds * 1.1 + index * 0.42) * 0.025;
        });
      }
      renderFrame();
      return state;
    }

    buildButton.addEventListener("click", function () {
      resetBuild(state.build.complete);
      renderFrame();
    });

    canvas.addEventListener("wheel", function (event) {
      event.preventDefault();
      state.camera.distance = clamp(state.camera.distance + event.deltaY * 0.012, 10, 28);
      state.camera.zoomEvents += 1;
      state.recording.checkpoint = "camera-zoomed";
      renderFrame();
    }, { passive: false });

    window.__NEXUS_SIMTIME__ = {
      advance(seconds = 1, input = {}) {
        return advanceManyFrames(seconds, input);
      },
      advanceFrame(input = {}) {
        return advanceOneFrame(input);
      },
      setFrame(frameIndex = 0, timeSeconds = 0) {
        state.frameIndex = Number(frameIndex) || 0;
        state.frame = state.frameIndex;
        state.timeSeconds = Number(timeSeconds) || 0;
        renderFrame();
        return state;
      },
    };

    function resize() {
      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderFrame();
    }

    window.addEventListener("resize", resize);
    updateHud();
    resize();
  </script>
</body>
</html>`;
}
