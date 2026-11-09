# ADR-0003: Production pipeline for the 3D Virtual Café

**Status:** Accepted, 09 Nov 2026. Amit wants a polished, saleable 3D café (D-13). It must be reusable for other cafés (BRAND-02).

## Decision

* **Runtime:** three.js through React Three Fiber and drei, on `WebGLRenderer` (WebGL 2). WebGPU is not adopted yet: it is not reliably faster for a scene this size, and it would force shaders into TSL. Revisit in 2027.
* **Authoring:** Blender (free) for the café interior and the manager character. Lighting is baked into lightmaps and AO on a second UV set, so the runtime needs at most one or two dynamic lights.
* **Character:** one rigged manager, with a small animation set (idle, greet, wave, point to menu, pour, nod). The first cut uses a CC0/royalty-free base character and motion-capture clips retargeted in Blender. Each clip is trimmed and compressed.
* **Asset pipeline (scripted, in the repo):** Blender to glTF, then `gltf-transform` (Meshopt geometry, quantised vertices, KTX2 textures: ETC1S for colour, UASTC for normals). That replaces hand-tuning with a repeatable build.
* **Reusability:** tenant branding (café name, sign, apron logo, colours, greeting lines) is applied at runtime from tenant config (decals, materials and text), not baked into the model. One café scene can serve many cafés.
* **2D path is first-class:** the full order flow works without WebGL (ADR-CX-05). 3D is an enhancement layered on top.

## Performance budgets (reference device: a mid-range Android, about ₹15k, 4 GB RAM)

| Metric | Budget |
|---|---|
| Draw calls per frame | ≤ 100 |
| Triangles in view | ≤ 100k |
| First 3D frame download | ≤ 2.5 MB (poster image shows first) |
| Full scene download | ≤ 8 MB, streamed |
| Texture size | ≤ 2048², KTX2 |
| Frame rate | ≥ 30 fps sustained, 60 fps target on flagships |
| Device pixel ratio | Adaptive from 1 to 1.75 via `PerformanceMonitor`; drops to 2D if it stays below 24 fps |
| LCP | ≤ 2.5 s (the poster is the LCP element) |

## Skills the 3D work needs

Blender modelling, UV and lightmap baking; character rigging and animation retargeting; glTF optimisation; three.js and R3F performance work (instancing, material sharing, adaptive quality); and shader basics for the warm café look (tone mapping, light bloom on lamps, steam). Claude does the code, the pipeline and procedural parts. A human 3D artist's polish pass on the final models is recommended before selling the product, and is a cost line for the SOW.

## Sources

* Utsubo, "100 Three.js Tips That Actually Improve Performance (2026)": https://www.utsubo.com/blog/threejs-best-practices-100-tips
* MessyPoly, "How to Optimize 3D Models in React Three Fiber": https://www.messypoly.com/learn/optimize-react-three-fiber-models

## First cut (Sprint 1, 09 Nov 2026)

* The scene is procedural in code (`apps/customer/src/components/Cafe3D.tsx`): no model files, so it costs no extra downloads. It is a lazily loaded chunk of 244 KB gzipped, fetched after the 2D poster has painted.
* Measured: 80 draw calls and about 12k triangles, inside the budgets above.
* Branding comes from tenant data: the sign shows the café name, the apron shows its initial, and the chalkboard lists the menu's bestsellers with live prices.
* The barista follows the visitor's finger or cursor, blinks, and waves on arrival, every so often, and when tapped.
* Falls back to the 2D scene when WebGL 2 is missing, Save-Data is on, device memory is under 3 GB, the scene errors, or `PerformanceMonitor` reports a sustained low frame rate. Reduced motion gets a still 3D frame. `?scene=2d` and `?scene=3d` force either path for demos.
* Rendering stops when the scene is off screen or the tab is hidden.
* Still to do for the saleable version: replace the procedural barista with the rigged character and baked café model from the Blender pipeline above, after the 3D artist's polish pass.
