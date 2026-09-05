import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("app/api/projects/[projectId]/events/route.ts", "utf8");
const workflow = readFileSync("components/GenerateWorkflow.tsx", "utf8");
const projectDetail = readFileSync("components/ProjectDetailView.tsx", "utf8");

describe("generation log reset lifecycle", () => {
  it("exposes an ownership-checked server deletion endpoint", () => {
    expect(route).toContain("export async function DELETE");
    expect(route).toContain("getAnonymousApiSession");
    expect(route).toContain("clearGenerationEvents(sessionResult.session.id, projectId)");
  });

  it("clears logs only at the start of explicit generation operations", () => {
    expect(workflow).toContain("resetGenerationLogForNewRun(activeProject.id)");
    expect(workflow).toContain("setCallTrace([])");
    expect(projectDetail).toContain("await resetGenerationLogForNewRun()");
    expect(projectDetail).not.toContain("useEffect(() => {\n    void resetGenerationLogForNewRun");
  });
});
