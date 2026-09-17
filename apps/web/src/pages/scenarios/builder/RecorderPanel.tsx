import { useState } from "react";
import { NoticeBox, NoticeLine } from "@/components";
import { Button, Input, Select } from "@/components/ui";
import {
  CANVAS_SCALES,
  CANVAS_SCALE_LABEL,
  StreamCanvas,
  type CanvasScale,
} from "@/features/recorder";
import type { RecordingController } from "@/hooks/useRecording";

/**
 * 녹화 화면 영역 (Task 10.8 의 조립 부분).
 *
 * 시안에는 **정적 "브라우저 목업"** 만 있고 실제 스트리밍 화면은 없다(01-clarify 화면 4).
 * 그래서 목업의 다크 크롬 톤(`--color-browser*`)을 그대로 쓰되, 내용은 진짜 캔버스다.
 *
 * ★ 배율 선택이 **기능이자 검증 수단**이다. 좌표 변환이 `rect.width` 를 쓰는지
 *   `canvas.width` 를 쓰는지는 **배율을 바꿔 보기 전에는 드러나지 않는다**
 *   (PoC-1 음성 대조군: 100% 만 통과, 70%·130% 전멸).
 */
export type RecorderPanelProps = {
  recording: RecordingController;
  /** Runner heartbeat 가 보이는지. 없으면 녹화를 시작할 수 없다. */
  runnerReady: boolean;
  runnerUnknown: boolean;
  /** 프로젝트 기본 URL — 시작 주소 입력의 기본값. */
  defaultStartUrl: string;
};

export function RecorderPanel({
  recording,
  runnerReady,
  runnerUnknown,
  defaultStartUrl,
}: RecorderPanelProps) {
  const [startUrl, setStartUrl] = useState(defaultStartUrl);
  const [scale, setScale] = useState<CanvasScale>("fit");

  const { phase, renderer, mouse, ime, stats, navUrl } = recording;
  const idle = phase === "idle";

  return (
    <section data-slot="recorder" className="border-b border-line px-[20px] py-[18px]">
      <div className="mb-[12px] flex flex-wrap items-center gap-[8px]">
        {idle ? (
          <>
            <Input
              value={startUrl}
              aria-label="녹화를 시작할 주소"
              data-testid="record-start-url"
              placeholder="https://"
              className="min-w-[220px] flex-1"
              onChange={(event) => {
                setStartUrl(event.target.value);
              }}
            />
            <Button
              variant="primary"
              data-testid="record-start"
              disabled={recording.isStarting || startUrl.trim() === "" || !runnerReady}
              onClick={() => {
                recording.start(startUrl.trim());
              }}
            >
              {recording.isStarting ? "브라우저 준비 중…" : "● 녹화 시작"}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="primary"
              data-testid="record-stop"
              disabled={recording.isStopping}
              onClick={recording.stop}
            >
              {recording.isStopping ? "정리하는 중…" : "■ 녹화 종료"}
            </Button>
            <Button
              variant="danger"
              data-testid="record-discard"
              disabled={recording.isStopping}
              onClick={recording.discard}
            >
              버리기
            </Button>
            <label className="ml-auto flex items-center gap-[7px] text-[10px] font-750 text-muted">
              화면 배율
              <Select
                variant="filter"
                value={scale}
                data-testid="canvas-scale"
                onChange={(event) => {
                  setScale(event.target.value as CanvasScale);
                }}
              >
                {CANVAS_SCALES.map((option) => (
                  <option key={option} value={option}>
                    {CANVAS_SCALE_LABEL[option]}
                  </option>
                ))}
              </Select>
            </label>
          </>
        )}
      </div>

      {idle ? null : (
        <>
          <StreamCanvas
            canvasRef={renderer.canvasRef}
            remote={renderer.remote}
            scale={scale}
            mouse={mouse}
            attachImeInput={ime.attachInput}
            imeHandlers={ime.handlers}
            live={phase === "live"}
            overlay={
              phase === "live" ? null : (
                <span className="rounded-btn bg-toast px-[13px] py-[9px] text-[11px] font-750 text-browser-url-ink">
                  원격 브라우저에 연결하는 중…
                </span>
              )
            }
          />
          <p
            data-testid="stream-hud"
            className="mt-[8px] flex flex-wrap items-center gap-[12px] font-mono text-[10px] text-muted"
          >
            <span>
              {String(renderer.remote.w)}×{String(renderer.remote.h)}
            </span>
            <span>{stats.fps.toFixed(1)} fps</span>
            <span>렌더 {String(stats.rendered)} · 드롭 {String(stats.droppedClient)}</span>
            {navUrl === null ? null : <span className="truncate">{navUrl}</span>}
          </p>
        </>
      )}

      {idle && !runnerReady ? (
        <NoticeBox title={runnerUnknown ? "Runner 상태를 확인하지 못했습니다" : "Runner 가 실행 중이 아닙니다"}>
          <NoticeLine>
            녹화 화면은 Runner 가 직접 보냅니다. Runner 가 떠 있지 않으면 녹화를 시작할 수
            없습니다. 서버에서 Runner 를 기동한 뒤 다시 시도해 주세요.
          </NoticeLine>
        </NoticeBox>
      ) : null}
    </section>
  );
}
