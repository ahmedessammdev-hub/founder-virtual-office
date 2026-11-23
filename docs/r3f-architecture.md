# React Three Fiber (R3F v9) & Three.js Architecture Reference

> **Purpose:** Local engineering guide for the `Living 3D Virtual Office` (`apps/web/src/components/office3d/`), ensuring compatibility with **React 19**, **@react-three/fiber v9**, **@react-three/drei v10**, and mid-range laptop hardware (`RTX 3050 4GB` + `AMD Radeon iGPU`).

## 1. Bundle Isolation & Zero-Overhead 2D Guarantee
- `OfficeFloorplan.tsx` lazy-loads `Studio3DCanvas.tsx` with `React.lazy(...)` wrapped in `WebGLErrorBoundary` + `Suspense`.
- Vite `manualChunks` places `three` (`three-core`), `@react-three/fiber` (`r3f-core`), and `@react-three/drei` + `three-stdlib` (`drei-kit`) in dedicated async chunks so **`2D Blueprint` boots with 0 KB of Three.js**.

## 2. World Coordinate Convention (`100px = 1.0m`)
- All 2D SVG floorplan coordinates (`0..width`, `0..height`) map to centered 3D meters via:
  - `x_m = (px - width / 2) / 100`
  - `z_m = (py - height / 2) / 100`
  - `y_m = 0` is the finished oak floor plane.
- Because `company.json` can move or rotate desks at runtime, `navgrid.ts` and `DynamicFurniture.tsx` derive positions directly from `CompanyConfig.floorplan` (`width`, `height`, `zones`, `desks`, `rotationDeg`).

## 3. Instancing & Draw Call Budget (`< 80` Target)
- Repeated architectural / furniture geometry (desk legs, chair legs, window mullions) uses `<instancedMesh>` inside `DynamicFurniture.tsx` and `ArchitecturalRoom.tsx` so employee growth stays well under budget.
- Keep lighting streamlined: 1 `directionalLight` with bounded shadow frustum + 1 `hemisphereLight` + minimal warm accent lights (avoid heavy post-processing bloom/SSAO passes on mobile GPUs).

## 4. GPU Memory Hygiene & Disposal
- Every procedural `CanvasTexture`, shared `BufferGeometry`, or `Material` created imperatively or in `useMemo` is explicitly `.dispose()`d in `useEffect` cleanup.
- Multi-instance rigged `.glb` avatars MUST clone via `SkeletonUtils.clone(gltf.scene)` (never shallow `scene.clone()`), clone mutable materials per instance before applying department tints, stop & uncache `THREE.AnimationMixer` actions on unmount, and dispose cloned materials.

## 5. Quality Tiers & Zero-GPU Background Mode
- Quality presets:
  - `high`: `dpr={[1, 1.5]}`, `PCFSoftShadowMap` `1024px`, `antialias: true`
  - `balanced`: `dpr={[1, 1.25]}`, basic `512px` shadow, `antialias: true`
  - `eco`: `dpr={1}`, shadows off, `antialias: false`
- Listen to `document.visibilitychange` and switch `<Canvas frameloop={tabHidden ? "demand" : "always"} />` so switching browser tabs drops GPU usage to ~`0%`.
- Attach `webglcontextlost` (`e.preventDefault()`) and `webglcontextrestored` handlers on `gl.domElement`.

## 6. Animation & Frame Loop Rules
- Never allocate `new THREE.Vector3()` or trigger Zustand `setState` inside hot `useFrame` ticks; mutate pooled refs (`vecA`, `vecB`) instead.
- Clamp simulation `delta = Math.min(rawDelta, 0.05)` so browser tab resumes never teleport characters through walls.
- Match leg/arm stride frequency directly to planar velocity `speed / strideLength` to prevent foot sliding (`animation-systems` best practice).
