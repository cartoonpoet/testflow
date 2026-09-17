/**
 * `pw-event-mapper` 회귀 테스트 (03-phases Task 3.3 — ★ 이 Task 의 핵심 산출물).
 *
 * ## 왜 이 파일이 필요한가
 * Playwright step 제목은 **API 이름이 아니라 사람이 읽는 라벨**이고(`locator.click` 이 아니라
 * `Click`), **버전업에 조용히 바뀐다.** 바뀌면 `toActionType()` 이 전부 `wait` 로 떨어지는데
 * 실행은 계속 성공하므로 **아무도 모른다** (03-phases 리스크 4번). 그걸 막는 유일한 장치다.
 *
 * ## ★ 픽스처는 추측이 아니라 실측이다
 * 아래 NDJSON 은 **Playwright 1.63.0 이 실제로 보낸 출력 전문**이다
 * (`pw-reporter.ts` → loopback HTTP → 파일로 덤프). 손으로 지어내지 않았다.
 * Gen-Phase 1 의 `pw-step-title.spec.ts` 가 **문자열 표**를 고정했고, 이 파일은
 * **reporter 출력 전체 파이프라인**(필터 → 시퀀스 → 마스킹 → 액션)을 고정한다.
 *
 * 재현: `apps/runner` 를 빌드한 뒤 코드 시나리오를 실행하면 같은 모양의 NDJSON 이 나온다.
 */
import { describe, expect, it } from "vitest";
import {
  PW_RESULT_TO_RUN_STATUS,
  PwEventMapper,
  isEnvironmentErrorMessage,
  parseReporterNdjson,
  stripAnsi,
} from "./pw-event-mapper.js";
import type { MappedStepFinished, MappedStepStarted } from "./pw-event-mapper.js";

/**
 * 실측 ① — codegen 산출물 형태의 로그인 spec 1건 (전량 46건).
 * `variables` 의 비밀번호를 `page.fill()` 로 넣었다 →
 * **`Fill "PLAINTEXT-SECRET-GATE-7788"` 이 제목에 평문으로 실려 온다**(PoC 발견 ①의 실물 증거).
 */
const REAL_NDJSON_LOGIN = [
  "{\"kind\":\"run.begin\",\"seq\":1,\"atMs\":1789680411742,\"workers\":1,\"totalTests\":1}",
  "{\"kind\":\"test.begin\",\"seq\":2,\"atMs\":1789680413840,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"title\":\" › login.spec.ts › 로그인 후 확인 버튼을 누른다\",\"workerIndex\":0,\"retry\":0}",
  "{\"kind\":\"step.begin\",\"seq\":3,\"atMs\":1789680413904,\"stepId\":1,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"workerIndex\":0,\"category\":\"hook\",\"title\":\"Before Hooks\",\"depth\":0}",
  "{\"kind\":\"step.begin\",\"seq\":4,\"atMs\":1789680413920,\"stepId\":2,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"workerIndex\":0,\"category\":\"fixture\",\"title\":\"Fixture \\\"browser\\\"\",\"depth\":1}",
  "{\"kind\":\"step.begin\",\"seq\":5,\"atMs\":1789680413922,\"stepId\":3,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Launch browser\",\"depth\":2}",
  "{\"kind\":\"step.end\",\"seq\":6,\"atMs\":1789680413981,\"stepId\":3,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"category\":\"pw:api\",\"title\":\"Launch browser\",\"depth\":2,\"durationMs\":58,\"error\":null}",
  "{\"kind\":\"step.end\",\"seq\":7,\"atMs\":1789680413982,\"stepId\":2,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"category\":\"fixture\",\"title\":\"Fixture \\\"browser\\\"\",\"depth\":1,\"durationMs\":62,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":8,\"atMs\":1789680413985,\"stepId\":4,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"workerIndex\":0,\"category\":\"fixture\",\"title\":\"Fixture \\\"context\\\"\",\"depth\":1}",
  "{\"kind\":\"step.begin\",\"seq\":9,\"atMs\":1789680413986,\"stepId\":5,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Create context\",\"depth\":2}",
  "{\"kind\":\"step.end\",\"seq\":10,\"atMs\":1789680413993,\"stepId\":5,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"category\":\"pw:api\",\"title\":\"Create context\",\"depth\":2,\"durationMs\":7,\"error\":null}",
  "{\"kind\":\"step.end\",\"seq\":11,\"atMs\":1789680413997,\"stepId\":4,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"category\":\"fixture\",\"title\":\"Fixture \\\"context\\\"\",\"depth\":1,\"durationMs\":14,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":12,\"atMs\":1789680413998,\"stepId\":6,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"workerIndex\":0,\"category\":\"fixture\",\"title\":\"Fixture \\\"page\\\"\",\"depth\":1}",
  "{\"kind\":\"step.begin\",\"seq\":13,\"atMs\":1789680413998,\"stepId\":7,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Create page\",\"depth\":2}",
  "{\"kind\":\"step.end\",\"seq\":14,\"atMs\":1789680414044,\"stepId\":7,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"category\":\"pw:api\",\"title\":\"Create page\",\"depth\":2,\"durationMs\":46,\"error\":null}",
  "{\"kind\":\"step.end\",\"seq\":15,\"atMs\":1789680414044,\"stepId\":6,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"category\":\"fixture\",\"title\":\"Fixture \\\"page\\\"\",\"depth\":1,\"durationMs\":47,\"error\":null}",
  "{\"kind\":\"step.end\",\"seq\":16,\"atMs\":1789680414045,\"stepId\":1,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"category\":\"hook\",\"title\":\"Before Hooks\",\"depth\":0,\"durationMs\":140,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":17,\"atMs\":1789680414046,\"stepId\":8,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Navigate\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":18,\"atMs\":1789680414125,\"stepId\":8,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"category\":\"pw:api\",\"title\":\"Navigate\",\"depth\":0,\"durationMs\":80,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":19,\"atMs\":1789680414130,\"stepId\":9,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Click\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":20,\"atMs\":1789680414218,\"stepId\":9,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"category\":\"pw:api\",\"title\":\"Click\",\"depth\":0,\"durationMs\":88,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":21,\"atMs\":1789680414219,\"stepId\":10,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Fill \\\"hong.gildong\\\"\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":22,\"atMs\":1789680414230,\"stepId\":10,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"category\":\"pw:api\",\"title\":\"Fill \\\"hong.gildong\\\"\",\"depth\":0,\"durationMs\":11,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":23,\"atMs\":1789680414231,\"stepId\":11,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Fill \\\"PLAINTEXT-SECRET-GATE-7788\\\"\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":24,\"atMs\":1789680414247,\"stepId\":11,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"category\":\"pw:api\",\"title\":\"Fill \\\"PLAINTEXT-SECRET-GATE-7788\\\"\",\"depth\":0,\"durationMs\":16,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":25,\"atMs\":1789680414248,\"stepId\":12,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Select option\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":26,\"atMs\":1789680414261,\"stepId\":12,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"category\":\"pw:api\",\"title\":\"Select option\",\"depth\":0,\"durationMs\":13,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":27,\"atMs\":1789680414262,\"stepId\":13,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Check\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":28,\"atMs\":1789680414300,\"stepId\":13,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"category\":\"pw:api\",\"title\":\"Check\",\"depth\":0,\"durationMs\":38,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":29,\"atMs\":1789680414301,\"stepId\":14,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Click\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":30,\"atMs\":1789680414356,\"stepId\":14,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"category\":\"pw:api\",\"title\":\"Click\",\"depth\":0,\"durationMs\":55,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":31,\"atMs\":1789680414369,\"stepId\":15,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"workerIndex\":0,\"category\":\"expect\",\"title\":\"Expect \\\"toHaveText\\\"\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":32,\"atMs\":1789680414380,\"stepId\":15,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"category\":\"expect\",\"title\":\"Expect \\\"toHaveText\\\"\",\"depth\":0,\"durationMs\":11,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":33,\"atMs\":1789680414382,\"stepId\":16,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Click\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":34,\"atMs\":1789680414422,\"stepId\":16,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"category\":\"pw:api\",\"title\":\"Click\",\"depth\":0,\"durationMs\":41,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":35,\"atMs\":1789680414423,\"stepId\":17,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"workerIndex\":0,\"category\":\"expect\",\"title\":\"Expect \\\"toContainText\\\"\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":36,\"atMs\":1789680414429,\"stepId\":17,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"category\":\"expect\",\"title\":\"Expect \\\"toContainText\\\"\",\"depth\":0,\"durationMs\":6,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":37,\"atMs\":1789680414430,\"stepId\":18,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"workerIndex\":0,\"category\":\"hook\",\"title\":\"After Hooks\",\"depth\":0}",
  "{\"kind\":\"step.begin\",\"seq\":38,\"atMs\":1789680414431,\"stepId\":19,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"workerIndex\":0,\"category\":\"fixture\",\"title\":\"Fixture \\\"page\\\"\",\"depth\":1}",
  "{\"kind\":\"step.end\",\"seq\":39,\"atMs\":1789680414431,\"stepId\":19,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"category\":\"fixture\",\"title\":\"Fixture \\\"page\\\"\",\"depth\":1,\"durationMs\":1,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":40,\"atMs\":1789680414431,\"stepId\":20,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"workerIndex\":0,\"category\":\"fixture\",\"title\":\"Fixture \\\"context\\\"\",\"depth\":1}",
  "{\"kind\":\"step.begin\",\"seq\":41,\"atMs\":1789680414503,\"stepId\":21,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Close context\",\"depth\":2}",
  "{\"kind\":\"step.end\",\"seq\":42,\"atMs\":1789680414591,\"stepId\":21,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"category\":\"pw:api\",\"title\":\"Close context\",\"depth\":2,\"durationMs\":87,\"error\":null}",
  "{\"kind\":\"step.end\",\"seq\":43,\"atMs\":1789680414591,\"stepId\":20,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"category\":\"fixture\",\"title\":\"Fixture \\\"context\\\"\",\"depth\":1,\"durationMs\":159,\"error\":null}",
  "{\"kind\":\"step.end\",\"seq\":44,\"atMs\":1789680414595,\"stepId\":18,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"category\":\"hook\",\"title\":\"After Hooks\",\"depth\":0,\"durationMs\":165,\"error\":null}",
  "{\"kind\":\"test.end\",\"seq\":45,\"atMs\":1789680414596,\"testId\":\"41d3fd2474a19feb00a1-72ed36158614df1eaf03\",\"status\":\"passed\",\"expectedStatus\":\"passed\",\"durationMs\":608,\"error\":null}",
  "{\"kind\":\"run.end\",\"seq\":46,\"atMs\":1789680414647,\"status\":\"passed\",\"durationMs\":3230.045}",
].join("\n");

/** 실측 ② — 모든 동작을 한 번씩 쓴 spec (전량 54건). 제목 14종이 여기서 나온다. */
const REAL_NDJSON_RICH = [
  "{\"kind\":\"run.begin\",\"seq\":1,\"atMs\":1789680703934,\"workers\":1,\"totalTests\":1}",
  "{\"kind\":\"test.begin\",\"seq\":2,\"atMs\":1789680706096,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"title\":\" › rich.spec.ts › 다양한 동작을 모두 한 번씩 쓴다\",\"workerIndex\":0,\"retry\":0}",
  "{\"kind\":\"step.begin\",\"seq\":3,\"atMs\":1789680706162,\"stepId\":1,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"hook\",\"title\":\"Before Hooks\",\"depth\":0}",
  "{\"kind\":\"step.begin\",\"seq\":4,\"atMs\":1789680706174,\"stepId\":2,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"fixture\",\"title\":\"Fixture \\\"browser\\\"\",\"depth\":1}",
  "{\"kind\":\"step.begin\",\"seq\":5,\"atMs\":1789680706176,\"stepId\":3,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Launch browser\",\"depth\":2}",
  "{\"kind\":\"step.end\",\"seq\":6,\"atMs\":1789680706244,\"stepId\":3,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"pw:api\",\"title\":\"Launch browser\",\"depth\":2,\"durationMs\":68,\"error\":null}",
  "{\"kind\":\"step.end\",\"seq\":7,\"atMs\":1789680706246,\"stepId\":2,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"fixture\",\"title\":\"Fixture \\\"browser\\\"\",\"depth\":1,\"durationMs\":71,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":8,\"atMs\":1789680706246,\"stepId\":4,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"fixture\",\"title\":\"Fixture \\\"context\\\"\",\"depth\":1}",
  "{\"kind\":\"step.begin\",\"seq\":9,\"atMs\":1789680706247,\"stepId\":5,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Create context\",\"depth\":2}",
  "{\"kind\":\"step.end\",\"seq\":10,\"atMs\":1789680706259,\"stepId\":5,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"pw:api\",\"title\":\"Create context\",\"depth\":2,\"durationMs\":12,\"error\":null}",
  "{\"kind\":\"step.end\",\"seq\":11,\"atMs\":1789680706264,\"stepId\":4,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"fixture\",\"title\":\"Fixture \\\"context\\\"\",\"depth\":1,\"durationMs\":19,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":12,\"atMs\":1789680706265,\"stepId\":6,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"fixture\",\"title\":\"Fixture \\\"page\\\"\",\"depth\":1}",
  "{\"kind\":\"step.begin\",\"seq\":13,\"atMs\":1789680706265,\"stepId\":7,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Create page\",\"depth\":2}",
  "{\"kind\":\"step.end\",\"seq\":14,\"atMs\":1789680706492,\"stepId\":7,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"pw:api\",\"title\":\"Create page\",\"depth\":2,\"durationMs\":227,\"error\":null}",
  "{\"kind\":\"step.end\",\"seq\":15,\"atMs\":1789680706493,\"stepId\":6,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"fixture\",\"title\":\"Fixture \\\"page\\\"\",\"depth\":1,\"durationMs\":228,\"error\":null}",
  "{\"kind\":\"step.end\",\"seq\":16,\"atMs\":1789680706493,\"stepId\":1,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"hook\",\"title\":\"Before Hooks\",\"depth\":0,\"durationMs\":330,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":17,\"atMs\":1789680706494,\"stepId\":8,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Navigate\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":18,\"atMs\":1789680706595,\"stepId\":8,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"pw:api\",\"title\":\"Navigate\",\"depth\":0,\"durationMs\":102,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":19,\"atMs\":1789680706632,\"stepId\":9,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"expect\",\"title\":\"Expect \\\"toHaveURL\\\"\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":20,\"atMs\":1789680706703,\"stepId\":9,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"expect\",\"title\":\"Expect \\\"toHaveURL\\\"\",\"depth\":0,\"durationMs\":71,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":21,\"atMs\":1789680706705,\"stepId\":10,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"expect\",\"title\":\"Expect \\\"toBeVisible\\\"\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":22,\"atMs\":1789680706730,\"stepId\":10,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"expect\",\"title\":\"Expect \\\"toBeVisible\\\"\",\"depth\":0,\"durationMs\":26,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":23,\"atMs\":1789680706735,\"stepId\":11,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Fill \\\"hong.gildong\\\"\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":24,\"atMs\":1789680706794,\"stepId\":11,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"pw:api\",\"title\":\"Fill \\\"hong.gildong\\\"\",\"depth\":0,\"durationMs\":59,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":25,\"atMs\":1789680706795,\"stepId\":12,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Press \\\"Tab\\\"\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":26,\"atMs\":1789680706862,\"stepId\":12,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"pw:api\",\"title\":\"Press \\\"Tab\\\"\",\"depth\":0,\"durationMs\":67,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":27,\"atMs\":1789680706869,\"stepId\":13,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Type \\\"s3cr3t-pw\\\"\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":28,\"atMs\":1789680706913,\"stepId\":13,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"pw:api\",\"title\":\"Type \\\"s3cr3t-pw\\\"\",\"depth\":0,\"durationMs\":45,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":29,\"atMs\":1789680706915,\"stepId\":14,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Select option\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":30,\"atMs\":1789680706939,\"stepId\":14,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"pw:api\",\"title\":\"Select option\",\"depth\":0,\"durationMs\":25,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":31,\"atMs\":1789680706940,\"stepId\":15,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Check\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":32,\"atMs\":1789680706993,\"stepId\":15,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"pw:api\",\"title\":\"Check\",\"depth\":0,\"durationMs\":53,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":33,\"atMs\":1789680706994,\"stepId\":16,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Uncheck\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":34,\"atMs\":1789680707040,\"stepId\":16,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"pw:api\",\"title\":\"Uncheck\",\"depth\":0,\"durationMs\":45,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":35,\"atMs\":1789680707040,\"stepId\":17,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Hover\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":36,\"atMs\":1789680707083,\"stepId\":17,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"pw:api\",\"title\":\"Hover\",\"depth\":0,\"durationMs\":43,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":37,\"atMs\":1789680707084,\"stepId\":18,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Double click\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":38,\"atMs\":1789680707125,\"stepId\":18,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"pw:api\",\"title\":\"Double click\",\"depth\":0,\"durationMs\":40,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":39,\"atMs\":1789680707125,\"stepId\":19,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Wait for timeout\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":40,\"atMs\":1789680707429,\"stepId\":19,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"pw:api\",\"title\":\"Wait for timeout\",\"depth\":0,\"durationMs\":303,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":41,\"atMs\":1789680707429,\"stepId\":20,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"expect\",\"title\":\"Expect \\\"toHaveValue\\\"\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":42,\"atMs\":1789680707437,\"stepId\":20,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"expect\",\"title\":\"Expect \\\"toHaveValue\\\"\",\"depth\":0,\"durationMs\":7,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":43,\"atMs\":1789680707437,\"stepId\":21,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"expect\",\"title\":\"Expect \\\"toContainText\\\"\",\"depth\":0}",
  "{\"kind\":\"step.end\",\"seq\":44,\"atMs\":1789680707443,\"stepId\":21,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"expect\",\"title\":\"Expect \\\"toContainText\\\"\",\"depth\":0,\"durationMs\":6,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":45,\"atMs\":1789680707445,\"stepId\":22,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"hook\",\"title\":\"After Hooks\",\"depth\":0}",
  "{\"kind\":\"step.begin\",\"seq\":46,\"atMs\":1789680707445,\"stepId\":23,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"fixture\",\"title\":\"Fixture \\\"page\\\"\",\"depth\":1}",
  "{\"kind\":\"step.end\",\"seq\":47,\"atMs\":1789680707448,\"stepId\":23,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"fixture\",\"title\":\"Fixture \\\"page\\\"\",\"depth\":1,\"durationMs\":0,\"error\":null}",
  "{\"kind\":\"step.begin\",\"seq\":48,\"atMs\":1789680707448,\"stepId\":24,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"fixture\",\"title\":\"Fixture \\\"context\\\"\",\"depth\":1}",
  "{\"kind\":\"step.begin\",\"seq\":49,\"atMs\":1789680707503,\"stepId\":25,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"workerIndex\":0,\"category\":\"pw:api\",\"title\":\"Close context\",\"depth\":2}",
  "{\"kind\":\"step.end\",\"seq\":50,\"atMs\":1789680707547,\"stepId\":25,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"pw:api\",\"title\":\"Close context\",\"depth\":2,\"durationMs\":44,\"error\":null}",
  "{\"kind\":\"step.end\",\"seq\":51,\"atMs\":1789680707548,\"stepId\":24,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"fixture\",\"title\":\"Fixture \\\"context\\\"\",\"depth\":1,\"durationMs\":102,\"error\":null}",
  "{\"kind\":\"step.end\",\"seq\":52,\"atMs\":1789680707553,\"stepId\":22,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"category\":\"hook\",\"title\":\"After Hooks\",\"depth\":0,\"durationMs\":109,\"error\":null}",
  "{\"kind\":\"test.end\",\"seq\":53,\"atMs\":1789680707554,\"testId\":\"0b629c3c32dbc18a7cac-7597a40af1f0c4bba237\",\"status\":\"passed\",\"expectedStatus\":\"passed\",\"durationMs\":1303,\"error\":null}",
  "{\"kind\":\"run.end\",\"seq\":54,\"atMs\":1789680707589,\"status\":\"passed\",\"durationMs\":3953.3120000000004}",
].join("\n");

/** 픽스처 ①에 박혀 있는 평문 비밀번호. 이 문자열이 결과에 남으면 테스트가 깨진다. */
const PLAINTEXT_SECRET = "PLAINTEXT-SECRET-GATE-7788";

function runMapper(ndjson: string): {
  mapper: PwEventMapper;
  started: MappedStepStarted[];
  finished: MappedStepFinished[];
  endStatus: string | null;
} {
  const mapper = new PwEventMapper();
  const started: MappedStepStarted[] = [];
  const finished: MappedStepFinished[] = [];
  let endStatus: string | null = null;
  for (const event of parseReporterNdjson(ndjson)) {
    const action = mapper.accept(event);
    if (action === null) continue;
    if (action.kind === "step-started") started.push(action);
    if (action.kind === "step-finished") finished.push(action);
    if (action.kind === "run-end") endStatus = action.status;
  }
  return { mapper, started, finished, endStatus };
}

describe("parseReporterNdjson", () => {
  it("깨진 줄을 버리고 나머지를 살린다", () => {
    const events = parseReporterNdjson(
      '{"kind":"run.begin","atMs":1}\n{깨진 줄\n\n{"kind":"run.end","atMs":2,"status":"passed"}\n',
    );
    expect(events.map((e) => e.kind)).toEqual(["run.begin", "run.end"]);
  });

  it("kind 가 없는 객체는 이벤트가 아니다", () => {
    expect(parseReporterNdjson('{"hello":"world"}\n')).toHaveLength(0);
  });
});

describe("★ 필터 — hook/fixture/depth>0 을 흘리지 않는다", () => {
  it("실측 ①: step.begin 21건 → 사용자 스텝 10건, 걸러낸 11건", () => {
    const events = parseReporterNdjson(REAL_NDJSON_LOGIN);
    const stepBegins = events.filter((e) => e.kind === "step.begin");
    expect(stepBegins).toHaveLength(21);

    const { mapper, started } = runMapper(REAL_NDJSON_LOGIN);
    expect(started).toHaveLength(10);
    expect(mapper.totalSteps).toBe(10);
    expect(mapper.filteredStepCount).toBe(11);
  });

  it("실측 ②: step.begin 25건 → 사용자 스텝 14건, 걸러낸 11건", () => {
    const { mapper, started } = runMapper(REAL_NDJSON_RICH);
    expect(started).toHaveLength(14);
    expect(mapper.filteredStepCount).toBe(11);
  });

  it("걸러진 제목에 내부 구현이 하나도 새지 않는다", () => {
    const { started } = runMapper(REAL_NDJSON_LOGIN);
    const names = started.map((s) => s.name);
    // 실측에 있던 hook/fixture 제목 전량 — 하나라도 통과하면 사용자 화면이 도배된다.
    for (const leak of [
      "Before Hooks",
      "After Hooks",
      'Fixture "browser"',
      'Fixture "context"',
      'Fixture "page"',
      "Launch browser",
      "Create context",
      "Create page",
      "Close context",
    ]) {
      expect(names).not.toContain(leak);
    }
  });

  it("depth > 0 은 카테고리가 pw:api 여도 걸러진다", () => {
    const mapper = new PwEventMapper();
    expect(
      mapper.accept({ kind: "step.begin", atMs: 1, stepId: 1, category: "pw:api", depth: 2, title: "Click" }),
    ).toBeNull();
    expect(mapper.totalSteps).toBe(0);
  });
});

describe("★ 매핑 회귀표 — 실측 제목 → ActionType", () => {
  /**
   * 실측 ②가 만든 14건이 **순서대로** 이 표와 같아야 한다.
   * Playwright 가 라벨을 바꾸면 여기서 깨진다 — 그것이 이 표의 존재 이유다.
   */
  const EXPECTED: readonly (readonly [string, string])[] = [
    ["Navigate", "goto"],
    ['Expect "toHaveURL"', "assert_url"],
    ['Expect "toBeVisible"', "assert_visible"],
    ['Fill "***"', "fill"],
    ['Press "Tab"', "press"],
    ['Type "***"', "fill"],
    ["Select option", "select"],
    ["Check", "check"],
    ["Uncheck", "uncheck"],
    ["Hover", "hover"],
    ["Double click", "click"],
    ["Wait for timeout", "wait"],
    ['Expect "toHaveValue"', "assert_text"],
    ['Expect "toContainText"', "assert_text"],
  ];

  it("14종이 순서·제목·actionType 까지 그대로 나온다", () => {
    const { started } = runMapper(REAL_NDJSON_RICH);
    expect(started.map((s) => [s.name, s.actionType] as const)).toEqual(EXPECTED);
  });

  it("sequence 는 사용자 스텝에만 1부터 빈틈없이 붙는다", () => {
    const { started } = runMapper(REAL_NDJSON_RICH);
    expect(started.map((s) => s.sequence)).toEqual([...Array(14).keys()].map((i) => i + 1));
  });

  it("★ totalSteps 가 실행 중에 1,2,3… 으로 증가한다 (쟁점 2)", () => {
    const { started } = runMapper(REAL_NDJSON_RICH);
    expect(started.map((s) => s.totalSteps)).toEqual([...Array(14).keys()].map((i) => i + 1));
  });

  /**
   * ★ 미분류 가드 — Playwright 가 라벨 체계를 바꾸면 전부 `wait` 로 떨어진다.
   *   실측 14건 중 `wait` 는 `Wait for timeout` **1건뿐**이다. 2건을 넘으면 실패시킨다.
   */
  it("미분류(wait) 비율이 기준을 넘으면 실패한다", () => {
    const { started } = runMapper(REAL_NDJSON_RICH);
    const waits = started.filter((s) => s.actionType === "wait");
    expect(waits.map((w) => w.name)).toEqual(["Wait for timeout"]);
    expect(waits.length / started.length).toBeLessThan(0.2);
  });
});

describe("★ 마스킹 — DB/SSE 로 나가기 전에 벗긴다", () => {
  it("실측 ①의 제목에 평문 비밀번호가 실제로 들어 있다 (대조군)", () => {
    // 이 단정문이 깨지면 픽스처가 오염된 것이고, 아래 마스킹 검사가 무의미해진다.
    expect(REAL_NDJSON_LOGIN).toContain(PLAINTEXT_SECRET);
    const raw = parseReporterNdjson(REAL_NDJSON_LOGIN).filter(
      (e) => e.kind === "step.begin" && String(e["title"]).includes(PLAINTEXT_SECRET),
    );
    expect(raw).toHaveLength(1);
  });

  it("변환 결과의 어디에도 평문이 남지 않는다", () => {
    const { started, finished } = runMapper(REAL_NDJSON_LOGIN);
    expect(JSON.stringify([...started, ...finished])).not.toContain(PLAINTEXT_SECRET);
    expect(started.filter((s) => s.name === 'Fill "***"')).toHaveLength(2);
  });

  it('Expect "toHaveText" 의 인용부호는 matcher 이름이라 지우지 않는다', () => {
    const { started } = runMapper(REAL_NDJSON_LOGIN);
    expect(started.map((s) => s.name)).toContain('Expect "toHaveText"');
    expect(started.map((s) => s.name)).toContain('Expect "toContainText"');
  });
});

describe("step begin ↔ end 짝짓기", () => {
  it("제목이 겹쳐도 (Fill 두 번) 짝이 어긋나지 않는다", () => {
    const { started, finished } = runMapper(REAL_NDJSON_LOGIN);
    expect(finished).toHaveLength(started.length);
    expect(finished.map((f) => f.sequence)).toEqual(started.map((s) => s.sequence));
    expect(finished.every((f) => f.durationMs >= 0)).toBe(true);
  });

  it("begin 을 못 본 end 는 버린다", () => {
    const mapper = new PwEventMapper();
    const action = mapper.accept({
      kind: "step.end",
      atMs: 1,
      stepId: 999,
      category: "pw:api",
      depth: 0,
      title: "Click",
      durationMs: 5,
    });
    expect(action).toBeNull();
  });

  it("실측 ① 전량이 passed 이고 run-end 가 passed 다", () => {
    const { finished, endStatus } = runMapper(REAL_NDJSON_LOGIN);
    expect(finished.every((f) => f.status === "passed")).toBe(true);
    expect(endStatus).toBe("passed");
  });
});

describe("status 매핑", () => {
  it("Playwright 결과 → runs.status", () => {
    expect(PW_RESULT_TO_RUN_STATUS["passed"]).toBe("passed");
    expect(PW_RESULT_TO_RUN_STATUS["failed"]).toBe("failed");
    expect(PW_RESULT_TO_RUN_STATUS["timedout"]).toBe("timeout");
    // interrupted·skipped 는 "시나리오가 틀렸다"가 아니다 → cancelled
    expect(PW_RESULT_TO_RUN_STATUS["interrupted"]).toBe("cancelled");
    expect(PW_RESULT_TO_RUN_STATUS["skipped"]).toBe("cancelled");
  });

  it("모르는 status 는 error 다 — 지어내지 않는다", () => {
    const mapper = new PwEventMapper();
    const action = mapper.accept({ kind: "run.end", atMs: 1, status: "여름", durationMs: 1 });
    expect(action).toEqual({ kind: "run-end", status: "error", durationMs: 1, atMs: 1 });
  });
});

describe("★ 실행 환경 오류 ↔ 시나리오 실패 구분 (04-gen-6 결정 6번)", () => {
  it("모듈 해석 실패는 환경 오류다", () => {
    for (const message of [
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'lodash' imported from /tmp/x/specs/a.spec.ts",
      "Cannot find module './helper'",
      "Error: No tests found",
    ]) {
      expect(isEnvironmentErrorMessage(message)).toBe(true);
    }
  });

  it("단정문 실패는 환경 오류가 아니다", () => {
    for (const message of [
      'expect(locator).toHaveText() failed\nExpected: "로그인 성공"\nReceived: "실패"',
      "Test timeout of 30000ms exceeded.",
      "locator.click: Target closed",
    ]) {
      expect(isEnvironmentErrorMessage(message)).toBe(false);
    }
  });

  it("run.error 는 환경 오류 여부를 판정해 돌려준다", () => {
    const mapper = new PwEventMapper();
    expect(
      mapper.accept({ kind: "run.error", atMs: 1, message: "ERR_MODULE_NOT_FOUND" }),
    ).toMatchObject({ kind: "run-error", environmental: true });
    expect(
      mapper.accept({ kind: "run.error", atMs: 2, message: "무언가 다른 문제" }),
    ).toMatchObject({ kind: "run-error", environmental: false });
  });
});

describe("★ ANSI escape 제거 — 웹 화면에 [2m 이 글자로 보이지 않게", () => {
  it("실측한 Playwright expect 실패 메시지의 색상 코드를 벗긴다", () => {
    // 실측: FORCE_COLOR=0 · CI=1 을 줘도 이 형태로 온다.
    const real =
      "Error: \u001b[2mexpect(\u001b[22m\u001b[31mlocator\u001b[39m\u001b[2m).\u001b[22mtoHaveText" +
      "\u001b[2m(\u001b[22m\u001b[32mexpected\u001b[39m\u001b[2m)\u001b[22m failed";
    expect(stripAnsi(real)).toBe("Error: expect(locator).toHaveText(expected) failed");
  });

  it("색상이 없는 문자열은 그대로 둔다", () => {
    expect(stripAnsi("평범한 에러 메시지 [brackets] 포함")).toBe("평범한 에러 메시지 [brackets] 포함");
  });

  it("★ ESC 가 없는 대괄호 표현은 지우지 않는다 (정규식이 너무 넓으면 여기서 깨진다)", () => {
    // 사용자 코드의 에러 메시지에 흔히 나오는 형태들.
    expect(stripAnsi("locator('#a[0]m') 를 찾지 못했습니다")).toBe("locator('#a[0]m') 를 찾지 못했습니다");
    expect(stripAnsi("items[12]meta 가 없습니다")).toBe("items[12]meta 가 없습니다");
  });

  it("step.end 의 error 가 ANSI 없이 나온다", () => {
    const mapper = new PwEventMapper();
    mapper.accept({ kind: "step.begin", atMs: 1, stepId: 1, category: "expect", depth: 0, title: 'Expect "toHaveText"' });
    const action = mapper.accept({
      kind: "step.end", atMs: 2, stepId: 1, category: "expect", depth: 0,
      title: 'Expect "toHaveText"', durationMs: 5,
      error: "Error: \u001b[2mexpect(\u001b[22m failed",
    });
    expect(action).toMatchObject({ errorMessage: "Error: expect( failed" });
  });
});

describe("발행하지 않는 이벤트", () => {
  it("test.begin / test.end 는 액션을 만들지 않는다 (변환표)", () => {
    const mapper = new PwEventMapper();
    expect(mapper.accept({ kind: "test.begin", atMs: 1, testId: "a", title: "t" })).toBeNull();
    expect(mapper.accept({ kind: "test.end", atMs: 2, testId: "a", status: "passed" })).toBeNull();
  });

  it("실측 ①에 test.begin·test.end 가 있는데도 액션 수는 22건이다", () => {
    const events = parseReporterNdjson(REAL_NDJSON_LOGIN);
    expect(events.filter((e) => e.kind === "test.begin")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "test.end")).toHaveLength(1);

    const mapper = new PwEventMapper();
    const actions = events.map((e) => mapper.accept(e)).filter((a) => a !== null);
    // run-begin 1 + step-started 10 + step-finished 10 + run-end 1 = 22
    expect(actions).toHaveLength(22);
  });
});

describe("중단 처리", () => {
  it("끝나지 않은 스텝의 sequence 를 알려준다 (skipped 로 접기 위해)", () => {
    const mapper = new PwEventMapper();
    mapper.accept({ kind: "step.begin", atMs: 1, stepId: 1, category: "pw:api", depth: 0, title: "Click" });
    mapper.accept({ kind: "step.begin", atMs: 2, stepId: 2, category: "pw:api", depth: 0, title: "Navigate" });
    mapper.accept({
      kind: "step.end", atMs: 3, stepId: 1, category: "pw:api", depth: 0, title: "Click", durationMs: 4,
    });
    expect(mapper.openSequences).toEqual([2]);
  });
});
