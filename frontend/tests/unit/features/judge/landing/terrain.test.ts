import { readFileSync } from "node:fs";
import path from "node:path";
import {
  cameraMatrix,
  COAST_STRIDE,
  decimateCoast,
  isoVertexCap,
  heightOf,
  IsoLines,
  mapCentreX,
  MAX_VERTICES,
  MESH,
  meshFor,
  projectToScreen,
  sceneShiftX,
  vertexCount,
  FpsMonitor,
  FPS_FLOOR,
  FPS_WINDOW_MS,
} from "@/features/judge/landing/terrain-math";
import { boxOf, clipCoast, isothermEach, isothermSegments, makeSampler, parseCoast, parseField } from "@/features/judge/landing/field-data";
import { geometry, project } from "@/features/judge/landing/field-draw";
import { canUpgrade } from "@/features/judge/landing/webgl-support";

/*
 * The terrain scene's pure parts: the vertex budget (ADR 0037: at most 6,000 on a desktop, 1,500 on a phone), the camera, the
 * relief, the frame-rate monitor that gives the scene up for the 2D field, and that the worker is a same-origin module worker.
 */

const SRC = path.resolve(import.meta.dirname, "../../../../../src/features/judge/landing");

const ROOT = path.resolve(import.meta.dirname, "../../../../..");
const json = (file: string): unknown => JSON.parse(readFileSync(path.join(ROOT, file), "utf8")) as unknown;
const grid = parseField(json("public/data/static/uae_ifs025_d1_wbgt_2026-09-03.json"));
const coast = clipCoast(parseCoast(json("public/data/static/coast.json")), boxOf(grid));

/** What one frame at `hour` sends to the GPU on the real field, built with the worker's own pieces. */
function frameAt(mobile: boolean, hour: number): { terrain: number; iso: number; coast: number; total: number; dropped: number } {
  const mesh = meshFor(mobile);
  const { nx, nz } = mesh;
  const [west, south, east, north] = boxOf(grid);
  const sample = makeSampler(grid);
  const values = new Float32Array(nx * nz);
  for (let k = 0; k < values.length; k++) {
    values[k] = sample(north - ((north - south) * Math.floor(k / nx)) / (nz - 1), west + ((east - west) * (k % nx)) / (nx - 1), hour);
  }
  const lines = decimateCoast(coast, COAST_STRIDE[mobile ? "phone" : "desktop"]);
  const coastVertices = lines.reduce((sum, line) => sum + line.length, 0);
  // the cap the worker gives the isotherms: its own function, not a mirrored formula
  const iso = new IsoLines(isoVertexCap(mobile, coastVertices));
  isothermEach(values, nx, nz, 1, (x1, y1, x2, y2, level) => {
    iso.add(x1, y1, x2, y2, level);
  });
  return { terrain: vertexCount(mesh), iso: iso.vertices, coast: coastVertices, total: vertexCount(mesh) + iso.vertices + coastVertices, dropped: iso.dropped };
}

describe("the vertex budget", () => {
  it("test_vertex_budget_phone_and_desktop: the terrain mesh alone is within 6,000 and 1,500, and finer than the 22 x 17 forecast grid", () => {
    expect(vertexCount(meshFor(false))).toBeLessThanOrEqual(6000);
    expect(vertexCount(meshFor(true))).toBeLessThanOrEqual(1500);
    expect(MESH.phone.nx).toBeGreaterThan(grid.lon.length);
    expect(MESH.phone.nz).toBeGreaterThan(grid.lat.length);
    expect(vertexCount(MESH.phone)).toBeLessThan(vertexCount(MESH.desktop));
  });

  it("test_total_vertices_per_frame_within_budget: terrain + isotherms + coast, at every quarter hour of the real day, on both devices", () => {
    for (const mobile of [false, true]) {
      const limit = MAX_VERTICES[mobile ? "phone" : "desktop"];
      let worst = 0;
      for (let hour = 0; hour < 24; hour += 0.25) {
        const frame = frameAt(mobile, hour);
        worst = Math.max(worst, frame.total);
        expect(frame.dropped, `${mobile ? "phone" : "desktop"} at ${String(hour)}: the cap dropped isotherm segments`).toBe(0);
        expect(frame.total, `${mobile ? "phone" : "desktop"} at ${String(hour)}`).toBeLessThanOrEqual(limit);
      }
      // non-vacuous: the lines are really there (the isotherms and the coast add vertices), and the budget is used, not wasted
      const frame = frameAt(mobile, 14);
      expect(frame.iso).toBeGreaterThan(100);
      expect(frame.coast).toBeGreaterThan(100);
      expect(worst).toBeGreaterThan(limit / 2);
    }
  });

  it("isotherm segments share the endpoints where they meet: a closed line of n segments is n vertices", () => {
    const lines = new IsoLines(100);
    lines.add(0, 0, 1, 0, 30);
    lines.add(1, 0, 1, 1, 30);
    lines.add(1, 1, 0, 1, 30);
    lines.add(0, 1, 0, 0, 30);
    expect(lines.segments).toBe(4);
    expect(lines.vertices).toBe(4);
    // the same spot on another level is another vertex
    lines.add(0, 0, 1, 0, 31);
    expect(lines.vertices).toBe(6);
    lines.reset();
    expect([lines.segments, lines.vertices]).toEqual([0, 0]);
  });

  it("drops segments, and says so, when its cap is reached (a guard, never silently over budget)", () => {
    const lines = new IsoLines(4);
    lines.add(0, 0, 1, 0, 30);
    lines.add(5, 5, 6, 5, 30);
    lines.add(9, 9, 9.5, 9, 30);
    expect(lines.vertices).toBe(4);
    expect(lines.dropped).toBe(1);
  });

  it("decimates a coast line by its stride and always keeps the last point", () => {
    const line = Array.from({ length: 10 }, (_, i) => i);
    expect(decimateCoast([line], 3)).toEqual([[0, 3, 6, 9]]);
    expect(decimateCoast([line], 4)).toEqual([[0, 4, 8, 9]]);
    expect(decimateCoast([[1, 2]], 5)).toEqual([[1, 2]]);
  });

  it("indexes with 16-bit indices (a mesh over 65,535 vertices would need a 32-bit index buffer)", () => {
    expect(vertexCount(MESH.desktop)).toBeLessThan(65_535);
  });
});

describe("the camera and the relief", () => {
  it("raises the surface with the temperature, linearly, 20 degrees at the ground", () => {
    expect(heightOf(20)).toBe(0);
    expect(heightOf(40)).toBeGreaterThan(heightOf(30));
    expect(heightOf(30) - heightOf(20)).toBeCloseTo(heightOf(40) - heightOf(30), 10);
  });

  it("projects the target of the camera inside the screen, and a point to its side to a different place", () => {
    const m = cameraMatrix({ mobile: false, azimuth: 0, aspect: 1.6 });
    const centre = projectToScreen(m, 0, 0.55, 0.1, 1440, 900);
    const side = projectToScreen(m, 1.5, 0.55, 0.1, 1440, 900);
    expect(centre[0]).toBeGreaterThan(0);
    expect(centre[0]).toBeLessThan(1440);
    expect(centre[1]).toBeGreaterThan(0);
    expect(centre[1]).toBeLessThan(900);
    expect(Math.abs(side[0] - centre[0])).toBeGreaterThan(50);
    // the desktop framing puts the scene right of the middle (the copy is on the start side), the phone's is centred
    const phone = cameraMatrix({ mobile: true, azimuth: 0, aspect: 0.46 });
    expect(projectToScreen(phone, 0, 0.55, 0.1, 390, 360)[0]).toBeGreaterThan(100);
    expect(projectToScreen(phone, 0, 0.55, 0.1, 390, 360)[0]).toBeLessThan(290);
  });

  it("test_rtl_camera_shift_mirrors: the scene sits on the end side, in either direction, at the 2D canvas's own centre", () => {
    expect(sceneShiftX(false)).toBeCloseTo((mapCentreX(false) - 0.5) * 2, 10);
    expect(sceneShiftX(true)).toBeCloseTo(-sceneShiftX(false), 10);
    expect(sceneShiftX(false)).toBeGreaterThan(0);
    expect(sceneShiftX(true)).toBeLessThan(0);
    const wide = { mobile: false, azimuth: 0, aspect: 1.6 } as const;
    const ltr = projectToScreen(cameraMatrix({ ...wide, rtl: false }), 0, 0.55, 0.1, 1440, 900)[0];
    const rtl = projectToScreen(cameraMatrix({ ...wide, rtl: true }), 0, 0.55, 0.1, 1440, 900)[0];
    const neutral = projectToScreen(cameraMatrix({ ...wide }), 0, 0.55, 0.1, 1440, 900)[0];
    // the camera's target lands where the 2D canvas puts the map centre, as a fraction of the width, and mirrors exactly
    expect(ltr / 1440).toBeCloseTo(mapCentreX(false), 2);
    expect(rtl / 1440).toBeCloseTo(mapCentreX(true), 2);
    expect(ltr + rtl).toBeCloseTo(1440, 0);
    expect(neutral).toBe(ltr); // `rtl` defaults to left-to-right
    // a phone is centred in both directions
    const phone = { mobile: true, azimuth: 0, aspect: 0.46 } as const;
    expect(projectToScreen(cameraMatrix({ ...phone, rtl: true }), 0, 0.55, 0.1, 390, 360)[0]).toBeCloseTo(projectToScreen(cameraMatrix({ ...phone }), 0, 0.55, 0.1, 390, 360)[0], 6);
  });

  it("the 2D canvas and the WebGL scene put the map on the same side, both ways", () => {
    const box = boxOf(grid);
    for (const rtl of [false, true]) {
      const g = geometry(1440, 900, box, rtl);
      expect(g.originX / 1440).toBeCloseTo(mapCentreX(rtl), 10);
      const [x] = project(g, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2);
      expect(rtl ? x < 720 : x > 720).toBe(true);
    }
  });

  it("is a 4 by 4 column-major matrix of finite numbers for any azimuth", () => {
    for (const azimuth of [0, 0.4, 3]) {
      const m = cameraMatrix({ mobile: false, azimuth, aspect: 1.6 });
      expect(m).toHaveLength(16);
      expect([...m].every(Number.isFinite)).toBe(true);
    }
  });
});

describe("isotherms on the mesh", () => {
  it("reports the level of each segment, so the line sits at the height of its own temperature", () => {
    const nx = 4;
    const nz = 3;
    const values = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) values[j * nx + i] = 25.5 + i; // 25.5, 26.5, 27.5, 28.5
    const levels: number[] = [];
    isothermEach(values, nx, nz, 1, (_x1, _y1, _x2, _y2, level) => {
      levels.push(level);
    });
    expect([...new Set(levels)].sort()).toEqual([26, 27, 28]);
    expect(isothermSegments(values, nx, nz, 1).length / 4).toBe(levels.length);
  });
});

describe("the frame-rate monitor (it times each frame the worker was asked for, request to answer)", () => {
  it("test_falls_back_when_fps_below_30_for_2s: gives the scene up after 2 s of frames slower than 30 per second", () => {
    expect(FPS_FLOOR).toBe(30);
    expect(FPS_WINDOW_MS).toBe(2000);
    const monitor = new FpsMonitor();
    let gaveUp = false;
    for (let spent = 0; spent < 1900; spent += 40) gaveUp = monitor.tick(40); // 25 frames per second
    expect(gaveUp).toBe(false); // 1.9 s is not enough
    for (let i = 0; i < 4 && !gaveUp; i++) gaveUp = monitor.tick(40);
    expect(gaveUp).toBe(true);
  });

  it("gives up a worker slower than the old pause constant: 300 ms and 600 ms a frame (3 and 1.7 per second)", () => {
    for (const frameMs of [150, 300, 600, 2500]) {
      const monitor = new FpsMonitor();
      let frames = 0;
      while (!monitor.tick(frameMs)) frames++;
      expect(frames * frameMs, `${String(frameMs)} ms a frame`).toBeLessThan(2000 + frameMs);
    }
  });

  it("never gives up at 40 frames per second, and a fast frame resets the count", () => {
    const monitor = new FpsMonitor();
    for (let i = 0; i < 400; i++) expect(monitor.tick(25)).toBe(false);
    // 1.5 s slow, one fast frame, 1.5 s slow again: never 2 s in a row
    const slow = new FpsMonitor();
    for (let i = 0; i < 37; i++) expect(slow.tick(40)).toBe(false);
    expect(slow.tick(10)).toBe(false);
    for (let i = 0; i < 37; i++) expect(slow.tick(40)).toBe(false);
  });

  it("reset forgets the run (the day stopped playing, or the page was hidden)", () => {
    const monitor = new FpsMonitor();
    for (let i = 0; i < 6; i++) monitor.tick(300);
    monitor.reset();
    for (let i = 0; i < 6; i++) expect(monitor.tick(300)).toBe(false);
    expect(monitor.tick(300)).toBe(true);
  });
});

describe("the worker", () => {
  const component = readFileSync(path.join(SRC, "FieldCanvasGL.tsx"), "utf8");

  it("test_worker_is_same_origin_module: started from a URL relative to this module, as a module worker, never from a blob", () => {
    expect(component).toContain('new Worker(new URL("./terrain.worker.ts", import.meta.url), { type: "module" })');
    expect(component).not.toMatch(/blob:|createObjectURL/);
    // the worker file exists and is a module (it imports, and it answers messages)
    const worker = readFileSync(path.join(SRC, "terrain.worker.ts"), "utf8");
    expect(worker).toMatch(/^import /m);
    expect(worker).toContain("onmessage");
  });

  it("test_falls_back_to_2d_without_offscreencanvas: the upgrade is attempted only where OffscreenCanvas, canvas transfer and workers exist, and never with ?static", () => {
    const all = { search: "", hasOffscreenCanvas: true, canTransfer: true, hasWorker: true };
    expect(canUpgrade(all)).toBe(true);
    expect(canUpgrade({ ...all, hasOffscreenCanvas: false })).toBe(false);
    expect(canUpgrade({ ...all, canTransfer: false })).toBe(false);
    expect(canUpgrade({ ...all, hasWorker: false })).toBe(false);
    expect(canUpgrade({ ...all, search: "?static" })).toBe(false);
    expect(canUpgrade({ ...all, search: "?a=1&static" })).toBe(false);
    expect(canUpgrade({ ...all, search: "?staticfoo=1" })).toBe(true);
    // the island asks before it imports the scene, so a browser without them never downloads it
    expect(readFileSync(path.join(SRC, "FieldIsland.tsx"), "utf8")).toContain("canUpgrade(");
  });
});
