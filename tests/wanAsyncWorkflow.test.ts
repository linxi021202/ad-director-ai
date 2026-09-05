import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Wan asynchronous generation workflow", () => {
  it("returns after task submission and exposes a separate polling endpoint", async () => {
    const client = await readFile(path.join(root, "lib/video/wanVideoClient.ts"), "utf8");
    const route = await readFile(path.join(root, "app/api/projects/[projectId]/wan-video/route.ts"), "utf8");

    expect(client).toContain("export async function submitWanVideo");
    expect(client).toContain("export async function getWanVideoTaskStatus");
    expect(client).not.toContain("POLL_MAX_ATTEMPTS");
    expect(route).toContain("export async function GET");
    expect(route).toContain("attachGenerationEventProviderTask");
    expect(route).toContain("202");
  });

  it("uses tolerant response parsing while the browser polls the task", async () => {
    const workflow = await readFile(path.join(root, "components/GenerateWorkflow.tsx"), "utf8");
    expect(workflow).toContain("pollWanVideoUntilComplete");
    expect(workflow).toContain("readClientApiResponse<WanVideoData>");
    expect(workflow).toContain("[502, 503, 504]");
  });
});
