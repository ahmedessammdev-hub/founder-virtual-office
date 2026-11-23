import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const glbPath = path.resolve(__dirname, "../public/assets/avatars/sample-rigged.glb");

describe("Phase 8 Sample Rigged GLB Asset", () => {
  it("is a valid glTF 2.0 binary with 8 joints, SkinnedMesh weights, and 6 animation clips", () => {
    expect(fs.existsSync(glbPath)).toBe(true);
    const buf = fs.readFileSync(glbPath);
    expect(buf.length).toBeGreaterThan(1024);

    // Check GLB header
    expect(buf.readUInt32LE(0)).toBe(0x46546c67); // "glTF"
    expect(buf.readUInt32LE(4)).toBe(2); // v2
    expect(buf.readUInt32LE(8)).toBe(buf.length);

    // Parse Chunk 0 JSON
    const jsonLen = buf.readUInt32LE(12);
    expect(buf.readUInt32LE(16)).toBe(0x4e4f534a); // "JSON"
    const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")) as {
      skins?: Array<{ joints: number[] }>;
      meshes?: Array<{ primitives: Array<{ attributes: Record<string, number> }> }>;
      animations?: Array<{ name: string }>;
    };

    expect(gltf.skins?.[0]?.joints.length).toBe(8);
    expect(gltf.meshes?.[0]?.primitives[0]?.attributes.JOINTS_0).toBeTypeOf("number");
    expect(gltf.meshes?.[0]?.primitives[0]?.attributes.WEIGHTS_0).toBeTypeOf("number");

    const clipNames = (gltf.animations ?? []).map((a) => a.name);
    expect(clipNames).toEqual(
      expect.arrayContaining(["Idle", "Walk", "Sit", "Type", "Talk", "RaiseHand"]),
    );
  });
});
