import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  ArtifactPathError,
  artifactFileName,
  isInsideRoot,
  resolveArtifactPath,
} from "./artifacts.path.js";

const ROOT = resolve("/tmp/testflow-artifacts");
const RUN_ID = "11111111-2222-4333-8444-555555555555";

describe("resolveArtifactPath — 경로 순회 방어", () => {
  it("정상 키는 ARTIFACT_ROOT 아래로 해석된다", () => {
    const key = `runs/${RUN_ID}/step-03.png`;
    expect(resolveArtifactPath(ROOT, key)).toBe(resolve(ROOT, key));
  });

  it("'..' 가 들어간 키를 거부한다", () => {
    expect(() => resolveArtifactPath(ROOT, `runs/${RUN_ID}/../../etc/passwd`)).toThrow(
      ArtifactPathError,
    );
  });

  it("상대 경로 탈출(../../etc/passwd)을 거부한다", () => {
    expect(() => resolveArtifactPath(ROOT, "../../etc/passwd")).toThrow(ArtifactPathError);
  });

  it("절대 경로(/etc/passwd)를 거부한다", () => {
    expect(() => resolveArtifactPath(ROOT, "/etc/passwd")).toThrow(ArtifactPathError);
  });

  it("윈도우 드라이브 표기를 거부한다", () => {
    expect(() => resolveArtifactPath(ROOT, "C:\\Windows\\win.ini")).toThrow(ArtifactPathError);
  });

  it("백슬래시 구분자를 거부한다", () => {
    expect(() => resolveArtifactPath(ROOT, `runs\\${RUN_ID}\\step-01.png`)).toThrow(
      ArtifactPathError,
    );
  });

  it("URL 인코딩된 '..'(%2e%2e)는 형식 검증에서 걸린다", () => {
    expect(() => resolveArtifactPath(ROOT, `runs/${RUN_ID}/%2e%2e%2fpasswd`)).toThrow(
      ArtifactPathError,
    );
  });

  it("runs/ 접두사가 없는 키를 거부한다", () => {
    expect(() => resolveArtifactPath(ROOT, "etc/passwd")).toThrow(ArtifactPathError);
  });

  it("널 바이트가 섞인 키를 거부한다", () => {
    expect(() => resolveArtifactPath(ROOT, `runs/${RUN_ID}/step\u0000.png`)).toThrow(
      ArtifactPathError,
    );
  });
});

describe("isInsideRoot", () => {
  it("루트 자신은 허용한다", () => {
    expect(isInsideRoot(ROOT, ROOT)).toBe(true);
  });

  it("접두사만 같은 형제 디렉토리는 거부한다 (문자열 startsWith 만 쓰면 뚫린다)", () => {
    expect(isInsideRoot(ROOT, `${ROOT}-evil/secret.png`)).toBe(false);
  });

  it("하위 경로는 허용한다", () => {
    expect(isInsideRoot(ROOT, resolve(ROOT, "runs/x/y.png"))).toBe(true);
  });
});

describe("artifactFileName", () => {
  it("마지막 토막을 파일명으로 쓴다", () => {
    expect(artifactFileName(`runs/${RUN_ID}/trace.zip`)).toBe("trace.zip");
  });
});
