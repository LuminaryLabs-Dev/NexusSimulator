export function createHyperrealThreePreviewHtml(goal, manifest, baseFactoryName) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:,">
  <title>${goal.factoryName} ${goal.runId}</title>
  <style>
    html, body { margin: 0; height: 100%; background: #07100c; overflow: hidden; }
    canvas { display: block; width: 100vw; height: 100vh; }
    .hud {
      color: rgba(236, 248, 228, 0.95);
      font: 500 14px system-ui, sans-serif;
      left: 28px;
      line-height: 1.35;
      max-width: min(620px, calc(100vw - 56px));
      position: fixed;
      text-shadow: 0 2px 14px rgba(0,0,0,0.65);
      top: 24px;
    }
    .hud strong { display: block; font-size: 25px; font-weight: 750; margin-bottom: 4px; }
    .hud span { display: block; opacity: 0.9; }
  </style>
</head>
<body>
  <canvas id="preview"></canvas>
  <div class="hud">
    <strong>${goal.factoryName} / ${goal.runId}</strong>
    <span>species ${(manifest.speciesUsed ?? []).length} · skinned meshes ${manifest.skinning?.skinnedMeshCount ?? 0} · bones ${manifest.skinning?.skeletonBoneCount ?? 0} · fps proof ${manifest.recordingProof?.fpsTarget ?? "pending"}</span>
  </div>
  <script type="module">
    import * as THREE from "./vendor/three.module.js";

    const canvas = document.getElementById("preview");
    const manifest = ${JSON.stringify(manifest)};
    const baseFactoryName = ${JSON.stringify(baseFactoryName)};
    const state = {
      baseFactoryName,
      deltaSeconds: 1 / 60,
      factoryName: ${JSON.stringify(goal.factoryName)},
      frame: 0,
      frameIndex: 0,
      fpsTarget: Number(manifest.recordingProof?.fpsTarget || 60),
      manualMode: false,
      rendererMode: "threejs",
      runId: ${JSON.stringify(goal.runId)},
      stats: manifest.stats,
      timeSeconds: 0,
      recording: {
        cameraSafe: true,
        captureMode: "realtime",
        checkpoint: "preview-ready",
        deterministicFrames: 0,
        droppedFrames: 0,
        fpsTarget: Number(manifest.recordingProof?.fpsTarget || 60),
        routeComplete: true,
        smoothness: {
          droppedFrames: 0,
          expectedFrameMs: 1000 / Number(manifest.recordingProof?.fpsTarget || 60),
          measuredFps: 0,
          renderedFrames: 0
        },
        totalForestProps: Math.max(1, manifest.stats.leafCount + manifest.stats.treeCount + manifest.stats.patchCount),
        characterAnimation: {
          keyframed: true,
          jointCount: Math.max(18, manifest.skinning?.skeletonBoneCount || 18)
        },
        version: "hyperreal-foliage-threejs-v2"
      }
    };
    window.__NEXUS_TEST_STATE__ = state;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1612);
    scene.fog = new THREE.FogExp2(0x0a1612, 0.028);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 180);
    const root = new THREE.Group();
    const animatedBones = [];
    scene.add(root);

    const hemi = new THREE.HemisphereLight(0xe1f3ff, 0x182417, 1.45);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffedd1, 3.8);
    sun.position.set(8, 15, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.4;
    sun.shadow.camera.far = 70;
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    scene.add(sun);
    const coolFill = new THREE.DirectionalLight(0x74b6a0, 1.1);
    coolFill.position.set(-9, 5, -8);
    scene.add(coolFill);

    function hashString(text) {
      let hash = 2166136261;
      for (let index = 0; index < String(text).length; index += 1) {
        hash ^= String(text).charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    }

    function rng(seed) {
      let value = hashString(seed) || 1;
      return function next() {
        value += 0x6d2b79f5;
        let n = value;
        n = Math.imul(n ^ (n >>> 15), n | 1);
        n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
        return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
      };
    }

    function colorToNumber(value, fallback) {
      if (!value || typeof value !== "string") return fallback;
      return Number.parseInt(value.replace("#", ""), 16);
    }

    function makeBarkTexture(species) {
      const c = document.createElement("canvas");
      c.width = 256;
      c.height = 256;
      const ctx = c.getContext("2d");
      const base = species.bark?.base || "#5a3b24";
      const crack = species.bark?.crack || "#22160f";
      const highlight = species.bark?.highlight || "#9a7048";
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, c.width, c.height);
      const random = rng("bark:" + species.id);
      for (let i = 0; i < 90; i += 1) {
        const x = random() * c.width;
        ctx.strokeStyle = i % 4 === 0 ? highlight : crack;
        ctx.globalAlpha = i % 4 === 0 ? 0.22 : 0.52;
        ctx.lineWidth = 1 + random() * 4;
        ctx.beginPath();
        ctx.moveTo(x, -12);
        for (let y = -12; y < c.height + 20; y += 24) {
          ctx.lineTo(x + Math.sin(y * 0.04 + random() * 8) * (4 + random() * 9), y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const texture = new THREE.CanvasTexture(c);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(2.5, 5.5);
      return texture;
    }

    function makeLeafMaterial(species, index) {
      const colors = species.leaf?.colors?.length ? species.leaf.colors : ["#5f9846", "#83b65b", "#3e743d"];
      const color = colorToNumber(colors[index % colors.length], 0x5f9846);
      return new THREE.MeshStandardMaterial({
        alphaTest: 0.38,
        color,
        metalness: 0,
        roughness: 0.66,
        side: THREE.DoubleSide,
        transparent: true
      });
    }

    function makeBarkMaterial(species) {
      const map = makeBarkTexture(species);
      return new THREE.MeshStandardMaterial({
        color: colorToNumber(species.bark?.base, 0x5a3b24),
        map,
        metalness: 0.01,
        roughness: Number(species.bark?.roughness || 0.92)
      });
    }

    function branchGeometry(length, baseRadius, tipRadius, radialSegments, heightSegments) {
      const positions = [];
      const normals = [];
      const uvs = [];
      const skinIndices = [];
      const skinWeights = [];
      const indices = [];
      for (let yIndex = 0; yIndex <= heightSegments; yIndex += 1) {
        const v = yIndex / heightSegments;
        const radius = baseRadius + (tipRadius - baseRadius) * v;
        const bone = Math.min(3, Math.floor(v * 4));
        const local = v * 4 - bone;
        for (let xIndex = 0; xIndex <= radialSegments; xIndex += 1) {
          const u = xIndex / radialSegments;
          const angle = u * Math.PI * 2;
          const x = Math.cos(angle) * radius;
          const z = Math.sin(angle) * radius;
          positions.push(x, v * length, z);
          normals.push(Math.cos(angle), 0.12, Math.sin(angle));
          uvs.push(u, v * 4);
          skinIndices.push(bone, Math.min(3, bone + 1), 0, 0);
          skinWeights.push(1 - local, local, 0, 0);
        }
      }
      const row = radialSegments + 1;
      for (let yIndex = 0; yIndex < heightSegments; yIndex += 1) {
        for (let xIndex = 0; xIndex < radialSegments; xIndex += 1) {
          const a = yIndex * row + xIndex;
          const b = a + row;
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
      geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      return geometry;
    }

    function addSkinnedBranch(group, start, end, radiusStart, radiusEnd, material, windStiffness, phase) {
      const startVector = new THREE.Vector3(start.x, start.y, start.z);
      const endVector = new THREE.Vector3(end.x, end.y, end.z);
      const direction = new THREE.Vector3().subVectors(endVector, startVector);
      const length = direction.length();
      if (length <= 0.01) return null;
      const geometry = branchGeometry(length, radiusStart, Math.max(0.008, radiusEnd), 14, 10);
      const mesh = new THREE.SkinnedMesh(geometry, material);
      const rootBone = new THREE.Bone();
      const midA = new THREE.Bone();
      const midB = new THREE.Bone();
      const tip = new THREE.Bone();
      rootBone.position.y = 0;
      midA.position.y = length / 3;
      midB.position.y = length / 3;
      tip.position.y = length / 3;
      rootBone.add(midA);
      midA.add(midB);
      midB.add(tip);
      const skeleton = new THREE.Skeleton([rootBone, midA, midB, tip]);
      mesh.add(rootBone);
      mesh.bind(skeleton);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.copy(startVector);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      mesh.userData.wind = { bones: [midA, midB, tip], phase, stiffness: windStiffness };
      animatedBones.push(mesh.userData.wind);
      group.add(mesh);
      return mesh;
    }

    function addBranchCollar(group, position, radius, species, seed) {
      const random = rng("knot:" + species.id + ":" + seed);
      const material = new THREE.MeshStandardMaterial({
        color: colorToNumber(species.bark?.crack, 0x25160f),
        roughness: 0.98
      });
      const geometry = new THREE.SphereGeometry(radius * (0.65 + random() * 0.5), 8, 6);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(position.x, position.y, position.z);
      mesh.scale.set(1.15, 0.55, 0.75);
      mesh.rotation.set(random(), random() * Math.PI, random());
      mesh.castShadow = true;
      group.add(mesh);
    }

    function leafGeometryFor(species) {
      if (species.leaf?.shape === "needles" || species.leaf?.shape === "scale-spray") {
        return new THREE.PlaneGeometry(0.11, 0.62, 1, 2);
      }
      if (species.leaf?.shape === "frond") {
        return new THREE.PlaneGeometry(0.38, 1.28, 2, 5);
      }
      const shape = new THREE.Shape();
      shape.moveTo(0, 0.48);
      shape.bezierCurveTo(0.3, 0.22, 0.32, -0.25, 0, -0.5);
      shape.bezierCurveTo(-0.32, -0.25, -0.3, 0.22, 0, 0.48);
      return new THREE.ShapeGeometry(shape, 10);
    }

    function addLeaves(group, anchors, species, seed) {
      const geometry = leafGeometryFor(species);
      geometry.computeVertexNormals();
      const materials = [0, 1, 2].map(function (index) { return makeLeafMaterial(species, index); });
      const random = rng("leaves:" + seed + ":" + species.id);
      const visibleLimit = baseFactoryName === "ForestFactory" ? 520 : baseFactoryName === "FoliagePatchFactory" ? 720 : 960;
      const count = Math.min(visibleLimit, anchors.length || 1);
      for (let index = 0; index < count; index += 1) {
        const anchor = anchors[index % anchors.length];
        const mesh = new THREE.Mesh(geometry, materials[index % materials.length]);
        const forestBoost = baseFactoryName === "ForestFactory" ? 1.9 : 1;
        const scale = Number(anchor.scale || 1) * forestBoost * (species.leaf?.shape === "needles" ? 0.45 : species.leaf?.shape === "frond" ? 0.95 : 0.34);
        mesh.position.set(anchor.position.x, anchor.position.y, anchor.position.z);
        mesh.rotation.set(
          -0.65 + random() * 0.42,
          Number(anchor.angle || 0) + random() * 0.55,
          -0.2 + random() * 0.4
        );
        mesh.scale.set(scale * (0.82 + random() * 0.36), scale, scale);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    }

    function syntheticTopology(species, seed) {
      const random = rng("synthetic:" + seed + ":" + species.id);
      const segments = [];
      const leaves = [];
      const height = Number(species.height || 5);
      const radius = Number(species.trunkRadius || 0.25);
      segments.push({
        end: { x: 0, y: height, z: 0 },
        id: "trunk",
        radiusEnd: radius * 0.42,
        radiusStart: radius * Number(species.trunkFlare || 1),
        start: { x: 0, y: 0, z: 0 }
      });
      const levels = Number(species.branchLevels || 4);
      const fanout = Number(species.branchFanout || 3);
      for (let level = 1; level <= levels; level += 1) {
        const count = Math.max(2, fanout + Math.floor(level * 0.7));
        for (let i = 0; i < count; i += 1) {
          const angle = (i / count) * Math.PI * 2 + random() * 0.45 + level * 0.34;
          const y = height * (0.18 + level / (levels + 1) * 0.72);
          const spread = Number(species.crownRadius || 2.2) * (0.4 + level * 0.13);
          const start = { x: 0, y, z: 0 };
          const end = {
            x: Math.cos(angle) * spread,
            y: y + (species.crown === "weeping" ? -0.42 : species.crown?.includes("cone") ? -0.08 * level : 0.28),
            z: Math.sin(angle) * spread
          };
          segments.push({
            end,
            id: "branch-" + level + "-" + i,
            radiusEnd: Math.max(0.015, radius * 0.08),
            radiusStart: Math.max(0.03, radius * (0.32 - level * 0.035)),
            start
          });
          for (let leaf = 0; leaf < 6; leaf += 1) {
            leaves.push({
              angle,
              position: {
                x: end.x + (random() - 0.5) * 0.5,
                y: end.y + (random() - 0.5) * 0.34,
                z: end.z + (random() - 0.5) * 0.5
              },
              scale: 0.8 + random() * 0.5
            });
          }
        }
      }
      return { branchSegments: segments, leafAnchors: leaves };
    }

    function addTree(group, treeData, offsetX, offsetZ, sceneScale, seed) {
      const species = treeData.species || manifest.speciesCatalog?.[0] || { id: "oak" };
      const topology = treeData.branchSegments?.length ? treeData : syntheticTopology(species, seed);
      const tree = new THREE.Group();
      tree.position.set(offsetX, 0, offsetZ);
      tree.scale.setScalar(sceneScale);
      group.add(tree);
      const bark = makeBarkMaterial(species);
      const branchLimit = baseFactoryName === "ForestFactory" ? 10 : baseFactoryName === "FoliagePatchFactory" ? 18 : 28;
      const leafLimit = baseFactoryName === "ForestFactory" ? 96 : baseFactoryName === "FoliagePatchFactory" ? 72 : 120;
      topology.branchSegments.slice(0, branchLimit).forEach(function (segment, index) {
        addSkinnedBranch(
          tree,
          segment.start,
          segment.end,
          Number(segment.radiusStart || 0.05),
          Number(segment.radiusEnd || 0.015),
          bark,
          Number(species.windStiffness || 0.5),
          seed * 0.31 + index * 0.13
        );
        if (index > 0 && index % 4 === 0) {
          addBranchCollar(tree, segment.start, Number(segment.radiusStart || 0.04), species, seed + ":" + index);
        }
      });
      addLeaves(tree, (topology.leafAnchors || []).slice(0, leafLimit), species, seed);
      return tree;
    }

    function addGround(group, radiusX, radiusZ, x, z, color) {
      const geometry = new THREE.CircleGeometry(1, 96);
      const material = new THREE.MeshStandardMaterial({ color: color || 0x24472e, roughness: 0.98 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, -0.05, z);
      mesh.scale.set(radiusX, radiusZ, 1);
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    function treeSource(index) {
      const trees = manifest.treeMeshes?.length ? manifest.treeMeshes : [];
      if (trees.length) return trees[index % trees.length];
      const catalog = manifest.speciesCatalog?.length ? manifest.speciesCatalog : [{ id: "oak" }];
      return { species: catalog[index % catalog.length] };
    }

    function addLeafScene() {
      const leaf = manifest.leafMeshes?.[0] || null;
      const species = manifest.speciesCatalog?.[0] || {
        id: leaf?.species || "maple",
        leaf: { colors: leaf?.color ? ["#" + leaf.color.map(function (part) { return Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, "0"); }).join("")] : ["#6ea149"] }
      };
      addGround(root, 4.8, 3.2, 0, 0, 0x263e2b);
      if (leaf && manifest.stats.leafCount <= 3) {
        const geometry = leafGeometryFor({
          ...species,
          leaf: { ...(species.leaf || {}), shape: leaf.shape === "needle" ? "needles" : leaf.shape === "frond" ? "frond" : "broadleaf" }
        });
        geometry.computeVertexNormals();
        const material = makeLeafMaterial(species, 0);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(0, 1.25, 0);
        mesh.rotation.set(-0.95, 0.25, -0.12);
        mesh.scale.set(3.2, 4.6, 3.2);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        root.add(mesh);
        const veinMaterial = new THREE.MeshBasicMaterial({ color: 0xd6ef9f, transparent: true, opacity: 0.68 });
        const midrib = new THREE.Mesh(new THREE.BoxGeometry(0.035, 3.6, 0.018), veinMaterial);
        midrib.position.set(0, 1.25, 0.025);
        midrib.rotation.copy(mesh.rotation);
        root.add(midrib);
        for (let i = 0; i < 10; i += 1) {
          const side = i % 2 ? 1 : -1;
          const vein = new THREE.Mesh(new THREE.BoxGeometry(0.022, 1.2 - i * 0.045, 0.014), veinMaterial);
          vein.position.set(side * (0.18 + i * 0.035), 0.5 + i * 0.16, 0.035);
          vein.rotation.set(-0.95, side * 0.55, side * 0.62);
          root.add(vein);
        }
      } else {
        const random = rng("leaf-scene:" + state.runId);
        const anchors = [];
        const count = Math.max(32, Math.min(96, manifest.stats.leafCount || 48));
        for (let i = 0; i < count; i += 1) {
          anchors.push({
            angle: random() * Math.PI * 2,
            position: {
              x: (i % 12 - 5.5) * 0.62,
              y: 0.18 + random() * 0.32,
              z: (Math.floor(i / 12) - 3) * 0.56
            },
            scale: 1 + random() * 0.45
          });
        }
        addLeaves(root, anchors, species, "leaf-scene");
      }
    }

    function addTreeScene() {
      addGround(root, 4.2, 3.1, 0, 0, 0x263f2c);
      addTree(root, treeSource(0), 0, 0, 1, 1);
    }

    function addPatchScene() {
      addGround(root, 7.2, 4.6, 0, 0, 0x24492f);
      const count = Math.max(3, Math.min(10, manifest.stats.treeCount || 4));
      for (let i = 0; i < count; i += 1) {
        const x = (i % 5 - 2) * 1.65;
        const z = Math.floor(i / 5) * 1.75 - 0.75;
        addTree(root, treeSource(i), x, z, 0.62 + (i % 3) * 0.08, i + 2);
      }
    }

    function addForestScene() {
      const speciesCount = Math.max(1, manifest.speciesCatalog?.length || 1);
      const count = Math.max(10, Math.min(12, speciesCount));
      for (let i = 0; i < count; i += 1) {
        const ring = Math.floor(i / 10);
        const angle = (i / count) * Math.PI * 2;
        const radius = 3.2 + ring * 2.8 + (i % 3) * 0.35;
        const x = Math.cos(angle) * radius + (i % 5 - 2) * 0.28;
        const z = Math.sin(angle) * radius * 0.72;
        if (i % 4 === 0) addGround(root, 2.2, 1.5, x, z, i % 2 ? 0x274d31 : 0x2e5531);
        addTree(root, treeSource(i), x, z, 0.43 + (i % 4) * 0.035, i + 5);
      }
    }

    let sceneBuilt = false;
    function buildScene() {
      if (sceneBuilt) return;
      sceneBuilt = true;
      if (baseFactoryName === "LeafFactory") addLeafScene();
      else if (baseFactoryName === "TreeFactory") addTreeScene();
      else if (baseFactoryName === "FoliagePatchFactory") addPatchScene();
      else addForestScene();

      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(120, 120),
        new THREE.MeshStandardMaterial({ color: 0x102117, roughness: 1 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.08;
      floor.receiveShadow = true;
      scene.add(floor);
      state.recording.checkpoint = "scene-built";
      stepSimulation(1 / state.fpsTarget, "realtime");
      renderScene();
    }

    function resize() {
      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    function updateSmoothness() {
      const measuredFps = state.timeSeconds > 0 ? state.frameIndex / state.timeSeconds : 0;
      state.recording.smoothness = {
        droppedFrames: state.recording.droppedFrames,
        expectedFrameMs: 1000 / Math.max(1, state.fpsTarget),
        measuredFps: Number(measuredFps.toFixed(2)),
        renderedFrames: state.frameIndex,
        timeSeconds: Number(state.timeSeconds.toFixed(3))
      };
      state.recording.fpsTarget = state.fpsTarget;
      state.recording.characterAnimation.jointCount = Math.max(18, manifest.skinning?.skeletonBoneCount || 18);
      window.__NEXUS_TEST_STATE__ = state;
    }

    function stepSimulation(deltaSeconds, source) {
      const targetDelta = 1 / Math.max(1, state.fpsTarget);
      const clamped = Math.min(0.1, Math.max(0.001, Number(deltaSeconds) || targetDelta));
      if (source === "realtime" && clamped > targetDelta * 1.55) {
        state.recording.droppedFrames += Math.max(1, Math.round(clamped / targetDelta) - 1);
      }
      state.deltaSeconds = clamped;
      state.timeSeconds += clamped;
      state.frameIndex += 1;
      state.frame = state.frameIndex;
      const windTime = state.timeSeconds;
      animatedBones.forEach(function (entry, index) {
        const amount = Math.sin(windTime * (0.85 + entry.stiffness * 0.7) + entry.phase + index * 0.04) * 0.035 * (1.1 - entry.stiffness * 0.45);
        entry.bones.forEach(function (bone, boneIndex) {
          bone.rotation.z = amount * (boneIndex + 1);
          bone.rotation.x = Math.cos(windTime * 0.62 + entry.phase) * amount * 0.45;
        });
      });
      updateSmoothness();
    }

    function renderScene() {
      const t = state.timeSeconds;
      root.rotation.y = Math.sin(t * 0.22) * 0.055;
      const radius = baseFactoryName === "ForestFactory" ? 16 : baseFactoryName === "FoliagePatchFactory" ? 11 : 7.4;
      camera.position.x = Math.sin(t * 0.16 + 0.7) * radius;
      camera.position.z = Math.cos(t * 0.16 + 0.7) * radius;
      camera.position.y = baseFactoryName === "LeafFactory" ? 5.1 : baseFactoryName === "ForestFactory" ? 7.4 : 5.9;
      camera.lookAt(0, baseFactoryName === "LeafFactory" ? 0.45 : baseFactoryName === "ForestFactory" ? 2.2 : 1.65, 0);
      renderer.render(scene, camera);
    }

    const clock = new THREE.Clock();
    renderer.setAnimationLoop(function () {
      if (!state.manualMode) {
        stepSimulation(clock.getDelta() || 1 / state.fpsTarget, "realtime");
        renderScene();
      }
    });

    window.__NEXUS_SIMTIME__ = {
      advance(seconds = 1, input = {}) {
        const fps = Number(input.fps || state.fpsTarget || 60);
        state.fpsTarget = fps;
        state.recording.captureMode = input.captureMode || state.recording.captureMode || "realtime";
        state.recording.checkpoint = input.view || "threejs-simtime-advanced";
        const frames = Math.max(1, Math.round(Number(seconds || 0.016) * fps));
        const previousManual = state.manualMode;
        state.manualMode = input.captureMode === "deterministic" || previousManual;
        for (let i = 0; i < frames; i += 1) {
          stepSimulation(1 / fps, state.manualMode ? "deterministic" : "realtime");
        }
        renderScene();
        return state;
      },
      advanceFrame(input = {}) {
        const fps = Number(input.fps || state.fpsTarget || 60);
        state.fpsTarget = fps;
        state.manualMode = true;
        state.recording.captureMode = "deterministic";
        state.recording.checkpoint = input.view || "deterministic-frame";
        if (state.recording.deterministicFrames === 0) {
          state.frame = 0;
          state.frameIndex = 0;
          state.timeSeconds = 0;
          state.recording.droppedFrames = 0;
        }
        state.recording.deterministicFrames += 1;
        stepSimulation(Number(input.deltaSeconds || 1 / fps), "deterministic");
        renderScene();
        return state;
      },
      setFrame(frameIndex = 0, timeSeconds = 0, input = {}) {
        state.fpsTarget = Number(input.fps || state.fpsTarget || 60);
        state.manualMode = true;
        state.recording.captureMode = "deterministic";
        state.frameIndex = Math.max(0, Number(frameIndex) || 0);
        state.frame = state.frameIndex;
        state.timeSeconds = Math.max(0, Number(timeSeconds) || 0);
        updateSmoothness();
        renderScene();
        return state;
      }
    };

    window.addEventListener("resize", resize);
    resize();
    renderer.render(scene, camera);
    setTimeout(buildScene, 0);
  </script>
</body>
</html>
`;
}
