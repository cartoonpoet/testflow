import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAttachmentStorageKey } from "@testflow/contracts";
import {
  AttachmentPathError,
  isInsideRoot,
  resolveAttachmentPath,
} from "./attachment.path.js";
import { resolveArtifactPath } from "../artifacts/artifacts.path.js";
import { ArtifactPathError } from "../artifacts/artifacts.path.js";

const ROOT = resolve("/tmp/testflow-artifacts");
const SCENARIO_ID = "11111111-2222-4333-8444-555555555555";
const ATTACHMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const RUN_ID = "0407001b-e36c-489a-baff-e51e54ffcb42";

describe("resolveAttachmentPath — 첨부 경로 순회 방어", () => {
  it("정상 키는 ARTIFACT_ROOT 아래로 해석된다", () => {
    const key = buildAttachmentStorageKey(SCENARIO_ID, ATTACHMENT_ID);
    expect(resolveAttachmentPath(ROOT, key)).toBe(resolve(ROOT, key));
  });

  const cases: [string, string][] = [
    ["'..' 상위 이동", `scenario-attachments/${SCENARIO_ID}/../../etc/passwd`],
    ["상대 경로 탈출", "../../etc/passwd"],
    ["절대 경로", "/etc/passwd"],
    ["윈도우 드라이브", "C:\\Windows\\win.ini"],
    ["백슬래시 구분자", `scenario-attachments\\${SCENARIO_ID}\\${ATTACHMENT_ID}.bin`],
    ["URL 인코딩 '..'", `scenario-attachments/${SCENARIO_ID}/%2e%2e%2fpasswd`],
    ["접두사 없음", `etc/passwd`],
    ["★ 접두사 형제 디렉토리", `scenario-attachments-evil/${SCENARIO_ID}/${ATTACHMENT_ID}.bin`],
    ["하위 디렉토리", `scenario-attachments/${SCENARIO_ID}/sub/${ATTACHMENT_ID}.bin`],
    ["널 바이트", `scenario-attachments/${SCENARIO_ID}/${ATTACHMENT_ID}\u0000.bin`],
    ["★ 한글 파일명(키에 쓸 수 없다)", `scenario-attachments/${SCENARIO_ID}/테스트용 파일-1.docx`],
  ];

  for (const [label, key] of cases) {
    it(`거부: ${label}`, () => {
      expect(() => resolveAttachmentPath(ROOT, key)).toThrow(AttachmentPathError);
    });
  }
});

/**
 * ★★ 라운드 3 의 핵심 안전 주장을 테스트로 고정한다.
 *
 * "첨부파일을 붙이면서 증적 다운로드의 traversal 방어가 넓어지지 않았다" —
 * 그것을 증명하는 방법은 **두 해석기가 서로의 키를 거부하는지** 보는 것이다.
 */
describe("★ 증적 방어와 첨부 방어는 서로를 거부한다 (표면이 넓어지지 않았다)", () => {
  it("증적 해석기(`GET /api/artifacts/:id`)는 첨부 키를 거부한다", () => {
    const key = buildAttachmentStorageKey(SCENARIO_ID, ATTACHMENT_ID);
    expect(() => resolveArtifactPath(ROOT, key)).toThrow(ArtifactPathError);
  });

  it("첨부 해석기는 증적 키를 거부한다", () => {
    expect(() => resolveAttachmentPath(ROOT, `runs/${RUN_ID}/video.webm`)).toThrow(
      AttachmentPathError,
    );
  });

  it("증적 해석기는 여전히 자기 키를 정상 해석한다(회귀 없음)", () => {
    const key = `runs/${RUN_ID}/step-03.png`;
    expect(resolveArtifactPath(ROOT, key)).toBe(resolve(ROOT, key));
  });
});

describe("isInsideRoot", () => {
  it("루트 자신은 허용한다", () => {
    expect(isInsideRoot(ROOT, ROOT)).toBe(true);
  });

  it("접두사만 같은 형제 디렉토리는 거부한다", () => {
    expect(isInsideRoot(ROOT, `${ROOT}-evil/secret.bin`)).toBe(false);
  });

  it("하위 경로는 허용한다", () => {
    expect(isInsideRoot(ROOT, resolve(ROOT, "scenario-attachments/x/y.bin"))).toBe(true);
  });
});

/**
 * `purgeScenarioFiles()` 가 쓰는 "더미 UUID 로 디렉토리 경로를 얻는" 기법이
 * 안전한지 고정한다 — scenarioId 가 오염돼도 검증기가 먼저 막아야 한다.
 */
describe("★ 시나리오 삭제 시 첨부 디렉토리 경로 계산", () => {
  const PROBE = "00000000-0000-4000-8000-000000000000";

  it("정상 scenarioId 는 ARTIFACT_ROOT 아래 디렉토리로 해석된다", () => {
    const key = buildAttachmentStorageKey(SCENARIO_ID, PROBE);
    const file = resolveAttachmentPath(ROOT, key);
    expect(file.startsWith(resolve(ROOT, "scenario-attachments", SCENARIO_ID))).toBe(true);
  });

  const poisoned = ["../../etc", "/etc", "..", "a/../../b"];
  for (const bad of poisoned) {
    it(`오염된 scenarioId(${bad})는 키 생성 단계에서 거부된다`, () => {
      expect(() => resolveAttachmentPath(ROOT, buildAttachmentStorageKey(bad, PROBE))).toThrow(
        AttachmentPathError,
      );
    });
  }
});
