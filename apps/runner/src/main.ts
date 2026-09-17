/**
 * Runner 진입점 자리 — BullMQ Worker + 녹화 WS 서버.
 * 실제 구현은 Gen-Phase 6 Task 6.7 / Gen-Phase 7 Task 7.2 에서 채운다.
 */
export const RUNNER_WS_PORT = Number(process.env["RUNNER_WS_PORT"] ?? 4100);
