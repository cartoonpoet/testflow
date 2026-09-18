/**
 * 코드 시나리오 본문(`.spec.ts`) 검증 — **순수 함수**.
 *
 * ════════════════════════════════════════════════════════════════════
 * ★★ 이 검사는 **보안 경계가 아니다.** ★★
 *
 * 여기 쓰인 것은 정규식 스캐너이고, 정규식은 **우회된다**:
 *
 * ```ts
 * require(["f", "s"].join(""));        // ← 잡히지 않는다
 * const m = "node:" + "fs"; await import(m);  // ← 잡히지 않는다
 * ```
 *
 * 그 한계는 `code-validation.spec.ts` 에 **통과하는 테스트로 명시해 고정**돼 있다.
 * 이것을 보안 장치로 착각하면 위험하다.
 *
 * **보안은 실행 격리(03-phases 쟁점 4 — `RUNNER_CODE_EXECUTION_MODE`)가 담당하고,
 * 이 검사는 "왜 안 돌아가는지"를 사용자에게 미리 알려 주는 UX 장치다.**
 * 실행 시점에 뚫고 들어간 import 는 `ERR_MODULE_NOT_FOUND` 로 죽고,
 * 그때는 `run.status = error`(실행 환경 오류)로 확정한다 — `failed`(시나리오 실패)가 아니다.
 * ════════════════════════════════════════════════════════════════════
 *
 * ## 왜 AST 파서를 쓰지 않는가
 * TS 파서를 API 에 끌어들이면 런타임 의존성이 늘고 `.npmrc` 의 `minimum-release-age=1440`
 * 게이트를 또 통과해야 한다. 그리고 위에서 밝혔듯 **정확도를 올려도 보안 경계가 되지는 않는다** —
 * 정확한 파서도 `require(변수)` 는 못 막는다. 얻는 것이 비용을 넘지 않는다.
 *
 * ## 왜 contracts 에 두는가
 * web(저장 전 즉시 표시)과 api(`PUT /code` 에서 400)가 **같은 함수**를 쓴다.
 * 두 벌이면 규칙이 어긋나는 순간 한쪽이 조용히 뚫린다 (03-phases 쟁점 5).
 * 그래서 `Buffer`·`node:*` 등 Node 전용 API 를 쓰지 않는다 — 브라우저에서도 돌아야 한다.
 */
import { z } from "zod";
import { MAX_SCENARIO_CODE_BYTES, scenarioCodeByteLength } from "./scenario.js";

/**
 * 허용하는 import 는 **`@playwright/test` 하나뿐**이다.
 *
 * - Node 내장 모듈은 **불허** — 파일 접근의 직접 경로다.
 * - 상대 경로도 **불허** — 이번 범위는 단일 파일이라 가리킬 대상이 아예 없다.
 * - `playwright`(테스트 러너가 아닌 라이브러리)도 목록에 없다 → 거부된다.
 */
export const ALLOWED_IMPORTS = ["@playwright/test"] as const;

export const CODE_VALIDATION_SEVERITIES = ["error", "warning"] as const;
export const CodeValidationSeveritySchema = z.enum(CODE_VALIDATION_SEVERITIES);
export type CodeValidationSeverity = z.infer<typeof CodeValidationSeveritySchema>;

export const CODE_VALIDATION_CODES = [
  /** 본문이 비었다. */
  "empty",
  /** `MAX_SCENARIO_CODE_BYTES` 초과. */
  "too_large",
  /** 허용 목록 밖 패키지 import. */
  "import_not_allowed",
  /** 상대 경로 import. */
  "relative_import",
  /** Node 내장 모듈 import. */
  "node_builtin",
  /** `test(` 도 `test.describe(` 도 없다 — 실행해도 아무 일이 일어나지 않는다(경고). */
  "no_test",
  /**
   * ★ 라운드 3 **추가** — `setInputFiles('X')` 의 `X` 가 첨부파일 목록에 없다(경고).
   *
   * `validateScenarioCode()` 는 이 코드를 **절대 만들지 않는다.** 그 함수는 본문만 보는
   * 순수 함수이고, 이 판정에는 **첨부 목록이라는 바깥 상태**가 필요하기 때문이다.
   * 만드는 곳은 `attachment.ts` 의 `checkAttachmentReferences(content, names)` 하나다.
   * 항상 `severity:"warning"` 이다 — 파일명을 코드가 동적으로 만드는 정상 코드를 막지 않는다.
   */
  "missing_attachment",
] as const;
export const CodeValidationCodeSchema = z.enum(CODE_VALIDATION_CODES);
export type CodeValidationCode = z.infer<typeof CodeValidationCodeSchema>;

/**
 * 400 응답의 `details` 에 그대로 실리는 형태.
 * `line`·`column` 은 **1부터** 센다(에디터 표기와 맞춘다).
 */
export const CodeValidationIssueSchema = z.object({
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  severity: CodeValidationSeveritySchema,
  code: CodeValidationCodeSchema,
  message: z.string(),
  /** import 계열 issue 에만 있다. */
  moduleName: z.string().optional(),
});
export type CodeValidationIssue = z.infer<typeof CodeValidationIssueSchema>;

/**
 * Node 내장 모듈 목록. `node:` 접두사가 붙은 것은 목록과 무관하게 전부 내장으로 본다.
 * 하위 경로(`fs/promises`)는 첫 토막으로 판정한다.
 */
const NODE_BUILTINS: ReadonlySet<string> = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);

/**
 * 스캔하는 형태 **3종**.
 *
 * | # | 형태 | 예 |
 * |---|---|---|
 * | 1 | `import … from "x"` / `export … from "x"` | `import { test } from "@playwright/test"` |
 * | 2 | 부수효과 import `import "x"` / 동적 `import("x")` | `import("node:fs")` |
 * | 3 | `require("x")` | `require("fs")` |
 *
 * 각 정규식의 두 번째 캡처 그룹이 모듈명이다. 문자열 리터럴이 **직접** 있을 때만 잡힌다 —
 * 그것이 파일 상단에 적힌 한계다.
 */
const IMPORT_PATTERNS: readonly RegExp[] = [
  // 1. `import …/export … from "x"` — 중괄호가 여러 줄에 걸쳐도 잡는다.
  //    `[^;'"]*?` 가 세미콜론과 따옴표를 넘지 않아 다른 구문으로 새지 않는다.
  /\b(?:import|export)\b[^;'"]*?\bfrom\s*(['"])([^'"\n]+)\1/g,
  // 2. 부수효과 import + 동적 import. `import` 뒤에 바로 (괄호와) 리터럴이 오는 형태.
  /\bimport\s*\(?\s*(['"])([^'"\n]+)\1/g,
  // 3. CJS require.
  /\brequire\s*\(\s*(['"])([^'"\n]+)\1/g,
];

/**
 * 주석 안의 내용을 **공백으로 치환**한다(길이·줄바꿈은 그대로 유지 → 인덱스가 어긋나지 않는다).
 *
 * 이유: 주석 처리해 둔 `// import fs from "fs"` 가 오류로 잡히면 저장이 막힌다.
 * 오탐으로 사용자를 막는 것은 이 함수의 목적(UX 안내)과 정반대다.
 * 문자열 리터럴 안의 `//` 를 주석으로 오인하지 않도록 따옴표·템플릿 리터럴 상태도 같이 따라간다.
 */
function blankComments(content: string): string {
  const out = content.split("");
  let state: "code" | "line" | "block" | "single" | "double" | "template" = "code";
  for (let i = 0; i < content.length; i += 1) {
    const c = content[i] ?? "";
    const next = content[i + 1] ?? "";
    switch (state) {
      case "code":
        if (c === "/" && next === "/") {
          state = "line";
          out[i] = " ";
          out[i + 1] = " ";
          i += 1;
        } else if (c === "/" && next === "*") {
          state = "block";
          out[i] = " ";
          out[i + 1] = " ";
          i += 1;
        } else if (c === "'") state = "single";
        else if (c === '"') state = "double";
        else if (c === "`") state = "template";
        break;
      case "line":
        if (c === "\n") state = "code";
        else out[i] = " ";
        break;
      case "block":
        if (c === "*" && next === "/") {
          out[i] = " ";
          out[i + 1] = " ";
          i += 1;
          state = "code";
        } else if (c !== "\n") out[i] = " ";
        break;
      case "single":
      case "double":
      case "template": {
        const quote = state === "single" ? "'" : state === "double" ? '"' : "`";
        if (c === "\\") i += 1;
        else if (c === quote) state = "code";
        break;
      }
    }
  }
  return out.join("");
}

/** 0-based 인덱스 → 1-based {line, column}. */
function positionAt(content: string, index: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < index; i += 1) {
    if (content.charCodeAt(i) === 10 /* \n */) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: index - lineStart + 1 };
}

function isRelative(moduleName: string): boolean {
  return moduleName.startsWith("./") || moduleName.startsWith("../") || moduleName === "." || moduleName === "..";
}

function isNodeBuiltin(moduleName: string): boolean {
  if (moduleName.startsWith("node:")) return true;
  const head = moduleName.split("/")[0] ?? "";
  return NODE_BUILTINS.has(head);
}

function isAllowed(moduleName: string): boolean {
  return (ALLOWED_IMPORTS as readonly string[]).includes(moduleName);
}

/** `test(` 또는 `test.describe(` 가 하나라도 있는가. */
function hasTestCall(content: string): boolean {
  return /\btest\s*\(/.test(content) || /\btest\s*\.\s*describe\s*\(/.test(content);
}

/**
 * 코드 본문을 검증해 issue 목록을 돌려준다. **부작용 없음 · 예외 없음.**
 *
 * ★ 다시 강조 — **보안 경계가 아니다.** 파일 상단 주석을 읽어라.
 *   정규식은 `require(["f","s"].join(""))` 로 우회된다. 보안은 실행 격리가 담당한다.
 *   이 함수의 목적은 사용자가 저장 버튼을 누르기 전에 "이건 여기서 안 돌아간다"를
 *   **줄 번호와 함께** 보여 주는 것이다.
 *
 * @returns 발견 순서(본문 위치 순)의 issue 배열. 빈 배열이면 저장 가능하다.
 */
export function validateScenarioCode(content: string): CodeValidationIssue[] {
  const issues: CodeValidationIssue[] = [];

  if (content.trim() === "") {
    return [
      {
        line: 1,
        column: 1,
        severity: "error",
        code: "empty",
        message: "코드 본문이 비어 있습니다.",
      },
    ];
  }

  const sizeBytes = scenarioCodeByteLength(content);
  if (sizeBytes > MAX_SCENARIO_CODE_BYTES) {
    issues.push({
      line: 1,
      column: 1,
      severity: "error",
      code: "too_large",
      message: `코드 본문이 너무 큽니다. ${String(sizeBytes)}바이트 / 허용 ${String(MAX_SCENARIO_CODE_BYTES)}바이트.`,
    });
  }

  // 같은 위치를 두 패턴이 함께 잡을 수 있으므로(예: `import x from "y"` 가 1번·2번에 모두 걸릴 여지)
  // 모듈 리터럴의 시작 인덱스로 중복을 제거한다.
  const seen = new Set<number>();
  const found: { index: number; moduleName: string }[] = [];
  // 주석을 공백으로 지운 사본을 스캔한다. 인덱스가 원본과 1:1 이므로 줄·열은 그대로 쓸 수 있다.
  const scanned = blankComments(content);

  for (const pattern of IMPORT_PATTERNS) {
    // `lastIndex` 를 공유하지 않도록 매번 초기화한다(모듈 스코프 정규식이라 상태가 남는다).
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null = pattern.exec(scanned);
    while (match !== null) {
      const quote = match[1] ?? '"';
      const moduleName = match[2] ?? "";
      const literalOffset = match[0].lastIndexOf(`${quote}${moduleName}${quote}`);
      const index = match.index + (literalOffset < 0 ? 0 : literalOffset);
      if (!seen.has(index)) {
        seen.add(index);
        found.push({ index, moduleName });
      }
      match = pattern.exec(scanned);
    }
  }

  found.sort((a, b) => a.index - b.index);

  for (const { index, moduleName } of found) {
    if (isAllowed(moduleName)) continue;
    const { line, column } = positionAt(content, index);

    if (isRelative(moduleName)) {
      issues.push({
        line,
        column,
        severity: "error",
        code: "relative_import",
        message: `상대 경로 import 는 지원하지 않습니다(단일 파일 실행). '${moduleName}'`,
        moduleName,
      });
      continue;
    }
    if (isNodeBuiltin(moduleName)) {
      issues.push({
        line,
        column,
        severity: "error",
        code: "node_builtin",
        message: `Node 내장 모듈은 사용할 수 없습니다. '${moduleName}'`,
        moduleName,
      });
      continue;
    }
    issues.push({
      line,
      column,
      severity: "error",
      code: "import_not_allowed",
      message: `허용되지 않은 패키지입니다. 사용 가능한 import 는 ${ALLOWED_IMPORTS.join(", ")} 뿐입니다. '${moduleName}'`,
      moduleName,
    });
  }

  // 주석 처리된 `// test(...)` 는 세지 않는다.
  if (!hasTestCall(scanned)) {
    issues.push({
      line: 1,
      column: 1,
      severity: "warning",
      code: "no_test",
      message: "test( 또는 test.describe( 가 없습니다. 실행해도 아무 스텝도 생기지 않습니다.",
    });
  }

  return issues;
}

/**
 * 저장을 막아야 하는가. API 는 이것이 `true` 면 400 + `details: CodeValidationIssue[]` 를 돌려준다.
 * **경고(`warning`)는 막지 않는다** — 스텝이 없는 spec 도 사용자의 자유다.
 */
export function hasBlockingIssues(issues: readonly CodeValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}
