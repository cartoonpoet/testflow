import { Controller, Get, Inject, NotFoundException, Param } from "@nestjs/common";
import { Redis } from "ioredis";
import { isTerminalRunStatus } from "@testflow/contracts";
import type { LiveStreamInfo } from "@testflow/contracts";
import { REDIS_CLIENT } from "../../common/redis/redis.module.js";
import { issueStreamToken } from "../../common/utils/stream-token.js";
import { RunsService } from "./runs.service.js";

/**
 * 실행 라이브 스트림 접속 정보.
 *
 * ## 녹화(`POST …/recordings`)와 같은 구조다 — 의도적으로
 * WS 는 **Runner 직결**이다(`wsUrl` 이 `RUNNER_WS_PORT` 를 가리킨다). API 를 중계로 끼우면
 * 프레임마다 홉이 하나 더 늘어 지연이 배가되고, 프레임 왕복 지연이 이 기능의 유일한 성패 요인이다.
 *
 * 같은 WS 서버의 **다른 경로**(`/live/:runId`)를 쓴다(03-phases 쟁점 3) — 포트 1개,
 * nginx 규칙 1개, 프레임 봉투 25바이트·백프레셔 드롭 정책·`bufferedAmount` 상한이 전부 공유된다.
 * 분리되는 것은 세션 레지스트리와 **Redis 토큰 키 공간**뿐이다.
 *
 * ## Gen-Phase 4 의 Runner 가 검증해야 하는 것 (규약)
 * `/live/:runId?token=<평문>` 접속 시 —
 *  1. `GET testflow:run:token:<runId>` 로 sha256 hex 를 읽는다.
 *  2. `sha256(제시된 토큰)` 과 **타이밍 안전 비교**. 불일치·부재 → close **4401**.
 *  3. 그 runId 의 스트림 세션이 없으면 close **4404**.
 *
 * ★ **녹화 토큰(`testflow:rec:token:`)을 여기서 읽으면 안 된다.** 읽는 순간 녹화 토큰으로
 *   실행 화면을 볼 수 있게 된다. 검증은 `common/utils/stream-token.ts` 의
 *   `verifyStreamToken(store, "live", runId, token)` 을 쓰면 키 공간이 자동으로 지켜진다.
 */
@Controller()
export class LiveStreamController {
  constructor(
    private readonly runs: RunsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * `GET /api/runs/:id/live` → `{wsUrl, expiresAt}`.
   *
   * **종료된 run 은 404 다** — 끝난 실행에 스트림을 열어 주지 않는다(붙어도 프레임이 없고,
   * 사용자는 "멈췄다"로 읽는다). 끝난 실행은 영상 증적(`video.webm`)으로 본다.
   *
   * 호출할 때마다 새 토큰이 발급되고 **이전 토큰은 덮어써져 즉시 무효**가 된다
   * (키가 하나라 SET 이 곧 회전이다). TTL 은 `LIVE_STREAM_TOKEN_TTL_SEC`(120초).
   */
  @Get("runs/:id/live")
  async findOne(@Param("id") id: string): Promise<LiveStreamInfo> {
    const run = await this.runs.mustFind(id);
    if (isTerminalRunStatus(run.status)) {
      throw new NotFoundException(
        `이미 종료된 실행에는 라이브 스트림을 열 수 없습니다 (status: ${run.status}).`,
      );
    }

    // ★ 평문 토큰은 이 응답으로만 나간다. Redis 에는 sha256 hex 만 TTL 과 함께 남는다.
    const { token, expiresAt } = await issueStreamToken(this.redis, "live", run.id);

    return { wsUrl: buildLiveStreamWsUrl(run.id, token), expiresAt };
  }
}

/**
 * `wsUrl` 은 **API 포트(4000)가 아니라 `RUNNER_WS_PORT`(4100)** 를 가리켜야 한다.
 *
 * nginx 뒤에 둘 때는 `RUNNER_WS_LIVE_PUBLIC_URL`(예: `wss://testflow.internal/live`)을 설정한다.
 * 녹화의 `RUNNER_WS_PUBLIC_URL` 을 **재사용하지 않는 이유**: 그 값은 `/rec` 경로까지 포함한
 * 베이스라 (`wss://…/rec`) 여기에 그대로 쓰면 실행 스트림이 녹화 경로로 간다.
 * 두 경로는 nginx location 도 따로 잡아야 하므로 값도 따로 둔다.
 */
export function buildLiveStreamWsUrl(runId: string, token: string): string {
  const publicBase = (process.env["RUNNER_WS_LIVE_PUBLIC_URL"] ?? "").trim();
  const query = `?token=${encodeURIComponent(token)}`;
  if (publicBase !== "") {
    return `${publicBase.replace(/\/+$/, "")}/${runId}${query}`;
  }

  const host = process.env["RUNNER_WS_HOST"] ?? "127.0.0.1";
  const port = process.env["RUNNER_WS_PORT"] ?? "4100";
  return `ws://${host}:${port}/live/${runId}${query}`;
}
