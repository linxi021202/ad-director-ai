import { describe, expect, it, vi } from "vitest";

import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import { saveProjectBriefWithConflictRetry } from "../lib/projects/clientMutations";

describe("project conflict recovery", () => {
  it("refreshes the project version and retries an explicit brief save after a 409", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        error: { code: "PROJECT_VERSION_CONFLICT", message: "项目已更新。" }
      }, 409))
      .mockResolvedValueOnce(jsonResponse({
        data: { project: coldBrewDemo, version: 7 }
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { project: { ...coldBrewDemo, briefStatus: "saved" }, version: 8 }
      }));

    const saved = await saveProjectBriefWithConflictRetry(
      coldBrewDemo.id,
      6,
      {
        brief: coldBrewDemo.brief,
        shotCount: coldBrewDemo.shots.length,
        targetDurationSec: coldBrewDemo.targetDurationSec ?? coldBrewDemo.brief.durationSec
      },
      { fetchImpl }
    );

    expect(saved.version).toBe(8);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[1]?.[1]).toEqual({ cache: "no-store" });
    expect(JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body))).toMatchObject({ expectedVersion: 7 });
  });

  it("does not retry validation or infrastructure failures", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      error: { code: "INVALID_PROJECT_REQUEST", message: "项目请求参数无效。" }
    }, 400));

    await expect(saveProjectBriefWithConflictRetry(
      coldBrewDemo.id,
      1,
      {
        brief: coldBrewDemo.brief,
        shotCount: coldBrewDemo.shots.length,
        targetDurationSec: coldBrewDemo.targetDurationSec ?? coldBrewDemo.brief.durationSec
      },
      { fetchImpl }
    )).rejects.toThrow("项目请求参数无效");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
