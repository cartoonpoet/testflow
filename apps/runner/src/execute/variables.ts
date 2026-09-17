/**
 * `{{변수}}` 치환 엔진 (03-phases Task 6.3).
 *
 * ## 값은 **큐 페이로드에서만** 온다
 * `RunJobData.variables` 가 평문 계정·비밀번호가 존재하는 **유일한 장소**다
 * (02-context "★ 사용자 최종 결정" (c)). DB 조회는 없다 — `project_variables` 테이블 자체가
 * 존재하지 않는다.
 *
 * ## 지원 형태
 * ```
 * {{baseUrl}}/login          → https://staging.example.com/login
 * {{testUser.email}}         → qa@example.com      (점이 들어간 키는 그대로 한 덩어리로 찾는다)
 * {{ testUser.password }}    → 공백은 무시한다
 * ```
 * 점을 "객체 경로"로 해석하지 않는다. `variables` 는 **평평한 `Record<string,string>`** 이고
 * 키 자체가 `"testUser.email"` 이다(`CreateRunDtoSchema` 의 예시가 그 형태다).
 * 경로 해석을 넣으면 `{{a.b}}` 가 키 `"a.b"` 와 객체 `a` 의 `b` 중 무엇인지 모호해진다.
 *
 * ## 못 찾은 변수는 **던진다**
 * 그대로 남겨 두면 `{{password}}` 라는 문자열이 로그인 폼에 입력되고, 스텝은 "성공"한 뒤
 * 다음 단계에서 엉뚱한 이유로 실패한다. 실패 지점을 흐리는 쪽이 더 나쁘다.
 * ★ 에러 메시지에 **값은 넣지 않는다** — 키 이름만 넣는다.
 */

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

export class VariableResolutionError extends Error {
  constructor(readonly missingKeys: string[]) {
    super(
      `치환할 변수가 없습니다: ${missingKeys.map((key) => `{{${key}}}`).join(", ")}. ` +
        `실행 요청의 variables 에 해당 키를 넣어 주세요.`,
    );
    this.name = "VariableResolutionError";
  }
}

export interface VariableScope {
  /** 큐 페이로드의 `variables`. */
  variables: Record<string, string>;
  /** run 의 `baseUrl` 스냅샷. `{{baseUrl}}` 로 참조된다. */
  baseUrl: string;
  /** `{{envLabel}}` — 환경별 분기 문구를 스텝에 쓸 수 있게 열어 둔다. */
  envLabel: string;
}

/**
 * 치환 테이블.
 *
 * `baseUrl`/`envLabel` 을 **뒤에** 둔다 — run 단위 스냅샷이 사용자 변수보다 우선이다.
 * 실행 다이얼로그에서 입력한 `baseUrl` 이 실제로 실행된 주소여야 이력이 재현 가능하다.
 */
export function buildVariableTable(scope: VariableScope): Record<string, string> {
  return { ...scope.variables, baseUrl: scope.baseUrl, envLabel: scope.envLabel };
}

/** 문자열 1개를 치환한다. 못 찾은 키가 있으면 `VariableResolutionError`. */
export function substitute(template: string, table: Record<string, string>): string {
  const missing: string[] = [];
  const result = template.replace(PLACEHOLDER, (_match, rawKey: string) => {
    const key = rawKey.trim();
    const value = table[key];
    if (value === undefined) {
      missing.push(key);
      return "";
    }
    return value;
  });

  if (missing.length > 0) throw new VariableResolutionError([...new Set(missing)]);
  return result;
}

/** 치환 없이 "이 문자열에 어떤 변수가 들어 있나"만 본다(진단·로그용). */
export function referencedKeys(template: string): string[] {
  const keys = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    const key = match[1]?.trim();
    if (key !== undefined && key !== "") keys.add(key);
  }
  return [...keys];
}

/**
 * `goto` 대상 URL 을 만든다.
 *
 * 치환 후에도 상대 경로(`/login`)면 `baseUrl` 기준으로 절대화한다. 녹화 초안이
 * `{{baseUrl}}` 없이 경로만 남기는 경우가 흔해서 여기서 흡수한다.
 */
export function resolveGotoUrl(rawValue: string, scope: VariableScope): string {
  const substituted = substitute(rawValue, buildVariableTable(scope)).trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(substituted)) return substituted;
  return new URL(substituted, scope.baseUrl.endsWith("/") ? scope.baseUrl : `${scope.baseUrl}/`).toString();
}
