import { describe, expect, it } from "vitest";
import { deriveCreativeStageState } from "../lib/creative/creativeStageState";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import type { GenerationProject } from "../lib/schemas/project";

describe("creative stage selector", () => {
  const candidateId = "candidate-2";
  const setId = "11111111-1111-4111-8111-111111111111";
  function project(selected = false, confirmed = false): GenerationProject {
    return {
      ...coldBrewDemo,
      creativeWorkspace: {
        currentSetId: setId,
        updatedAt: new Date().toISOString(),
        sets: [{
          id: setId, version: 1, createdAt: new Date().toISOString(),
          candidates: [], recommendedCandidateId: "candidate-1",
          ...(selected ? { selectedCandidateId: candidateId } : {}),
          ...(confirmed ? { confirmedCandidateId: candidateId } : {})
        }]
      },
      stageStates: {
        brief: { status: "locked", updatedAt: 1 },
        creative: { status: confirmed ? "locked" : "ready", updatedAt: 1 },
        anchors: { status: "draft", updatedAt: 1 },
        storyboard: { status: "blocked", updatedAt: 1 },
        keyframes: { status: "blocked", updatedAt: 1 },
        video: { status: "blocked", updatedAt: 1 },
        final: { status: "blocked", updatedAt: 1 }
      }
    };
  }

  it("does not treat the recommended candidate as selected", () => {
    expect(deriveCreativeStageState(project()).status).toBe("generated");
    expect(deriveCreativeStageState(project()).selectedCandidateId).toBeUndefined();
  });
  it("distinguishes selection from confirmation", () => {
    expect(deriveCreativeStageState(project(true)).status).toBe("selected");
    expect(deriveCreativeStageState(project(true, true)).status).toBe("confirmed");
  });
});
