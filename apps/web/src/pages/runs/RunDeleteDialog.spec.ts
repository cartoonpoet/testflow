import { describe, expect, it } from "vitest";
import type { Artifact } from "@testflow/contracts";
import { artifactLabel, totalArtifacts, type RunDeleteTarget } from "./RunDeleteDialog";

function artifact(sizeBytes: number | null): Artifact {
  return {
    id: "0407001b-e36c-489a-baff-e51e54ffcb42",
    runId: "11111111-2222-4333-8444-555555555555",
    stepResultId: null,
    type: "video",
    storageKey: "runs/11111111-2222-4333-8444-555555555555/video.webm",
    contentType: "video/webm",
    sizeBytes,
    stepSequence: null,
    url: "/api/artifacts/x",
    createdAt: new Date(0).toISOString(),
  };
}

function target(artifacts: readonly Artifact[] | undefined): RunDeleteTarget {
  return { id: "a", runCode: "RUN-0001", scenarioName: "로그인", artifacts };
}

describe("artifactLabel", () => {
  it("★ 아직 못 읽었으면 개수를 지어내지 않는다", () => {
    expect(artifactLabel(undefined)).toBe("증적 확인 중…");
  });

  it("증적이 없으면 없다고 적는다(0개가 아니라)", () => {
    expect(artifactLabel([])).toBe("증적 없음");
  });

  it("개수와 합계를 사람이 읽는 단위로 적는다", () => {
    expect(artifactLabel([artifact(1024), artifact(1024)])).toBe("증적 2개 · 2.0KB");
  });

  it("크기를 모르는 증적(sizeBytes: null)은 0 으로 센다 — 개수는 정확히 센다", () => {
    expect(artifactLabel([artifact(null)])).toBe("증적 1개 · 0B");
  });
});

describe("totalArtifacts", () => {
  it("전부 읽혔으면 합계를 낸다", () => {
    expect(totalArtifacts([target([artifact(100)]), target([artifact(200)])])).toEqual({
      count: 2,
      bytes: 300,
    });
  });

  it("★ 한 건이라도 못 읽었으면 null 이다 — 일부 합계를 '합계'라 부르지 않는다", () => {
    expect(totalArtifacts([target([artifact(100)]), target(undefined)])).toBeNull();
  });

  it("증적이 하나도 없는 선택은 0 이다(null 이 아니다)", () => {
    expect(totalArtifacts([target([])])).toEqual({ count: 0, bytes: 0 });
  });
});
