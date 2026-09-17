/**
 * UI 레벨 Secret 마스킹.
 *
 * 서버(`apps/api/src/common/utils/mask.ts`)의 마스킹과 **별개의 층**이다.
 * 서버는 "밖으로 나가는 값"을 막고, 여기는 "화면에 그리는 값"을 막는다.
 * 녹화 중 로컬 편집 상태처럼 아직 서버를 거치지 않은 값이 화면에 찍히는 경로가 있어
 * 두 겹이 다 필요하다.
 *
 * 마스킹 문자열은 시안 표기(`••••••••`)와 같아야 한다.
 */
export const MASK = "••••••••";

/** 서버 `maskByKey` 와 같은 키 규칙. 양쪽이 어긋나면 화면만 평문이 된다. */
const SECRET_KEY_PATTERN = /(password|passwd|pwd|secret|token|credential|apikey|api_key)/i;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

/** 스텝 입력값 표시용. `isSecret` 은 contracts `TestStepInput.isSecret` 을 그대로 넘긴다. */
export function maskValue(value: string, isSecret: boolean): string {
  return isSecret ? MASK : value;
}

/**
 * 실행 요청 다이얼로그의 `variables` 처럼 키/값 쌍을 통째로 표시할 때.
 * 키 이름만 보고 판정하므로 `isSecret` 플래그가 있으면 그쪽을 우선 쓸 것.
 */
export function maskRecord(
  record: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = isSecretKey(key) ? MASK : value;
  }
  return out;
}

/**
 * 자유 텍스트(에러 메시지 등)에서 알려진 Secret 값을 지운다.
 * 서버가 이미 한 번 지우지만, 클라이언트가 방금 입력받아 아직 서버를 거치지 않은
 * 값이 섞이는 경로가 있어 같은 방어를 화면에서도 한다.
 */
export function maskSecretValues(
  text: string,
  secretValues: readonly string[],
): string {
  let out = text;
  for (const secret of secretValues) {
    if (secret.length < 3) continue; // 너무 짧으면 오탐이 더 크다
    out = out.split(secret).join(MASK);
  }
  return out;
}
