import type * as React from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BROWSERS,
  CreateRunRequestSchema,
  type CreateRunResponse,
} from "@testflow/contracts";
import { NoticeBox, NoticeLine } from "@/components";
import { Button, Input, Modal, Select } from "@/components/ui";
import { browserLabel, maskRecord } from "@/lib";
import { useCreateRun, useRunQueue } from "@/hooks/useRuns";
import { useHealth } from "@/hooks/useHealth";
import { useCurrentProject } from "@/hooks/useProject";
import { toast } from "@/hooks/useToast";

/**
 * 실행 요청 다이얼로그 — ★ 이 MVP 의 **핵심 경로**.
 *
 * ## 왜 여기서 값을 직접 받나 (02-context "★ 사용자 최종 결정" (a)(c))
 * 실행 환경 관리 화면과 테스트 데이터 관리 화면이 MVP 에서 빠졌다. 그래서
 *  - **`baseUrl` 은 이 폼이 주 경로다.** `projects.base_url` 은 **기본값**으로 채워 두되
 *    그대로 고칠 수 있다(스테이징·개발 주소를 매번 바꿔 가며 돌리는 것이 실제 사용 방식이다).
 *  - **계정·비밀번호도 이 폼에서 직접 받는다.** DB 에는 저장할 컬럼 자체가 없고
 *    (`project_variables` 테이블을 만들지 않았다), 값은 `POST /api/runs` 의 `variables` 로만
 *    전달돼 BullMQ 큐 페이로드에 머물다 job 과 함께 만료된다.
 *
 * ## 비밀번호를 어떻게 다루나
 *  - `type="password"` · `autoComplete="new-password"` — 브라우저 자동완성 저장을 유도하지 않는다.
 *  - **전송 후 폼에서 즉시 지운다**(성공·실패 모두). 실패했다고 평문을 남겨 두면
 *    다이얼로그를 닫을 때까지 DOM 에 살아 있다.
 *  - localStorage · sessionStorage · react-query 캐시 어디에도 넣지 않는다.
 *    실행 화면으로 넘길 때도 **`maskRecord()` 를 통과한 사본**만 라우터 state 로 넘긴다.
 *
 * ## 폼 검증
 * react-hook-form 을 새로 넣지 않았다(Gen-Phase 10 과 같은 판단). 전송 직전에
 * **계약 스키마(`CreateRunRequestSchema`)로 `safeParse`** 한다 — 서버가 실제로 검증하는 그 규칙이다.
 */
export type RunTarget =
  | { scenarioId: string }
  /** ★ 라운드 7 — 시나리오 목록의 다중 선택. `batch_id` 로 묶인 run N건이 생긴다. */
  | { scenarioIds: readonly string[] }
  | { suiteId: string };

/**
 * ★ 라운드 7 — 폼의 **기본값을 바깥에서 밀어 넣는 통로**.
 *
 * 재실행(`RunDetail`)이 쓴다. 프로젝트 기본값 대신 **그 run 이 실제로 쓴 값**을 채운다.
 * 넘기지 않은 필드는 지금까지처럼 프로젝트 기본값으로 떨어진다.
 */
export type RunDialogDefaults = {
  baseUrl?: string;
  envLabel?: string;
  browser?: (typeof BROWSERS)[number];
};

export type RunDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: RunTarget;
  /** 다이얼로그 제목 아래에 보여 줄 대상 이름. */
  targetName: string;
  /** 스위트·다중 선택 실행이면 몇 건이 생기는지 미리 알려 준다. */
  scenarioCount?: number;
  defaults?: RunDialogDefaults;
  /** 재실행이면 원본 run. 안내 문구와 결과 화면의 계보 배너에 쓴다. */
  rerunOf?: { runId: string; runCode: string };
};

export function RunDialog(props: RunDialogProps) {
  const { open, onOpenChange, target, targetName, scenarioCount, defaults, rerunOf } = props;
  const { project } = useCurrentProject();

  const baseUrl = defaults?.baseUrl ?? project?.baseUrl ?? "";
  const envLabel = defaults?.envLabel ?? project?.defaultEnvLabel ?? "스테이징";

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={rerunOf === undefined ? "실행 요청" : `재실행 · ${rerunOf.runCode}`}
      description={
        scenarioCount === undefined
          ? targetName
          : `${targetName} · 시나리오 ${String(scenarioCount)}건이 한 묶음으로 실행됩니다`
      }
    >
      {/*
       * ★ `key` 로 초기화한다 — `useEffect` 로 "열릴 때 기본값 채우기" 를 하지 않는다.
       *   프로젝트 조회가 늦게 끝나도 값이 도착하는 순간 폼이 새 기본값으로 다시 마운트된다.
       *   ★ 라운드 7 — `key` 에 **실제로 쓰는 기본값**을 넣는다. 재실행은 프로젝트가 아니라
       *     원본 run 의 값으로 채우므로, 키가 프로젝트에만 걸려 있으면 다른 run 의
       *     재실행 다이얼로그를 연속으로 열었을 때 앞 run 의 값이 남는다.
       */}
      {open ? (
        <RunDialogForm
          key={`${project?.id ?? "no-project"}:${baseUrl}:${envLabel}:${rerunOf?.runId ?? ""}`}
          target={target}
          defaultBaseUrl={baseUrl}
          defaultEnvLabel={envLabel}
          defaultBrowser={defaults?.browser ?? "chromium"}
          rerunOf={rerunOf}
          onClose={() => {
            onOpenChange(false);
          }}
        />
      ) : null}
    </Modal>
  );
}

/** 계정·비밀번호가 들어가는 변수 이름. 녹화가 만드는 `{{password}}` 와 같아야 한다. */
export const ACCOUNT_VARIABLE = "username";
export const PASSWORD_VARIABLE = "password";

function RunDialogForm({
  target,
  defaultBaseUrl,
  defaultEnvLabel,
  defaultBrowser,
  rerunOf,
  onClose,
}: {
  target: RunTarget;
  defaultBaseUrl: string;
  defaultEnvLabel: string;
  defaultBrowser: (typeof BROWSERS)[number];
  rerunOf?: { runId: string; runCode: string };
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const health = useHealth();
  const createRun = useCreateRun();

  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const [envLabel, setEnvLabel] = useState(defaultEnvLabel);
  const [browser, setBrowser] = useState<(typeof BROWSERS)[number]>(defaultBrowser);
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<readonly string[]>([]);

  const runnerDown = health.data?.runner === "down";

  /*
   * 묶음 크기는 **여기서 셀 수 있는 것만** 센다. 스위트는 담긴 시나리오 수를 이 폼이
   * 모르므로(서버가 편다) 0 으로 두고 안내를 띄우지 않는다 — 모르는 숫자를 쓰지 않는다.
   */
  const batchSize = "scenarioIds" in target ? target.scenarioIds.length : 1;
  const queue = useRunQueue({ enabled: batchSize > 1 });
  const concurrency = queue.data?.concurrency ?? null;

  const submit = () => {
    const variables: Record<string, string> = {};
    if (account !== "") variables[ACCOUNT_VARIABLE] = account;
    if (password !== "") variables[PASSWORD_VARIABLE] = password;

    const candidate = {
      ...target,
      baseUrl: baseUrl.trim(),
      envLabel: envLabel.trim(),
      browser,
      variables,
      secretKeys: [],
    };

    const parsed = CreateRunRequestSchema.safeParse(candidate);
    if (!parsed.success) {
      setFormError(
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      );
      return;
    }
    setFormError([]);

    // 화면으로 넘어가는 것은 **마스킹된 사본**뿐이다. 평문은 이 함수 밖으로 나가지 않는다.
    const maskedVariables = maskRecord(variables);

    createRun.mutate(parsed.data, {
      onSuccess: (response) => {
        toast("실행을 요청했습니다", { label: "실행" });
        onClose();
        goToResult(response, maskedVariables);
      },
      onSettled: () => {
        // ★ 성공·실패 무관하게 비밀번호를 폼에서 지운다.
        setPassword("");
      },
    });
  };

  const goToResult = (
    response: CreateRunResponse,
    maskedVariables: Record<string, string>,
  ) => {
    if (response.runIds.length > 1 && response.batchId !== null) {
      /*
       * 스위트·다중 선택 실행은 run 이 N 건 생긴다(같은 `batch_id`). 목록 응답
       * (`RunListItem`)에는 `batchId` 가 없어 서버에 "이 묶음만" 을 물어볼 수 없으므로,
       * 방금 받은 id 들을 쿼리로 들고 간다. 묶음 화면이 그 id 로 각각 상세를 읽는다.
       */
      void navigate(
        `/runs?batch=${response.batchId}&ids=${response.runIds.join(",")}`,
        { state: { maskedVariables } },
      );
      return;
    }
    // ★ 재실행이면 원본을 같이 넘긴다 — 결과 화면이 "무엇을 다시 돌린 것인지" 말한다.
    void navigate(`/runs/${response.runId}`, { state: { maskedVariables, rerunOf } });
  };

  const errors = formError.length > 0 ? formError : apiErrorLines(createRun.error);

  return (
    <form
      data-slot="run-dialog-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field
        label="대상 주소 (baseUrl)"
        hint="스텝의 {{baseUrl}} 자리에 들어갑니다. 프로젝트 기본값을 그대로 고칠 수 있습니다."
      >
        <Input
          name="baseUrl"
          data-slot="field-base-url"
          value={baseUrl}
          placeholder={defaultBaseUrl === "" ? "https://staging.example.com" : defaultBaseUrl}
          inputMode="url"
          onChange={(event) => {
            setBaseUrl(event.target.value);
          }}
        />
      </Field>

      <div className="grid grid-cols-2 gap-[12px] max-mobile:grid-cols-1">
        <Field label="환경 라벨">
          <Input
            name="envLabel"
            data-slot="field-env-label"
            value={envLabel}
            placeholder="스테이징"
            onChange={(event) => {
              setEnvLabel(event.target.value);
            }}
          />
        </Field>

        <Field label="브라우저">
          <Select
            name="browser"
            data-slot="field-browser"
            value={browser}
            onChange={(event) => {
              setBrowser(event.target.value as (typeof BROWSERS)[number]);
            }}
          >
            {BROWSERS.map((value) => (
              <option key={value} value={value}>
                {browserLabel(value)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="mt-[6px] mb-[10px] border-t border-line pt-[14px]">
        <strong className="text-[12px]">테스트 데이터</strong>
        <p className="m-0 mt-[4px] text-[10px] leading-[1.6] text-muted">
          입력한 값은 이번 실행에만 쓰이고 <strong>서버에 저장되지 않습니다.</strong>
          {" 스텝의 "}
          {`{{${ACCOUNT_VARIABLE}}}`} · {`{{${PASSWORD_VARIABLE}}}`} 자리에 들어갑니다.
        </p>
        {/*
          ★ 라운드 7 — 재실행에서 **왜 계정 칸만 비어 있는지**를 그 자리에서 말한다.
            주소·환경·브라우저는 채워 주면서 계정만 비워 두면, 설명이 없을 때
            사용자는 "채우는 걸 깜빡한 버그"로 읽는다. 실제로는 DB 에 컬럼 자체가
            없어서(설계) 채울 값이 존재하지 않는다.
        */}
        {rerunOf === undefined ? null : (
          <p
            data-slot="rerun-secret-notice"
            className="m-0 mt-[6px] text-[10px] leading-[1.6] text-muted"
          >
            <strong>보안상 계정·비밀번호는 저장하지 않습니다.</strong> {rerunOf.runCode} 의 대상
            주소·환경·브라우저는 그대로 채웠고, 계정 칸만 직접 입력해 주세요(값이 필요 없는
            시나리오면 비워 둔 채로 실행하면 됩니다).
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-[12px] max-mobile:grid-cols-1">
        <Field label="계정">
          <Input
            name={ACCOUNT_VARIABLE}
            data-slot="field-account"
            value={account}
            autoComplete="off"
            placeholder="qa-tester"
            onChange={(event) => {
              setAccount(event.target.value);
            }}
          />
        </Field>

        <Field label="비밀번호">
          <Input
            name={PASSWORD_VARIABLE}
            data-slot="field-password"
            type="password"
            value={password}
            autoComplete="new-password"
            spellCheck={false}
            placeholder="••••••••"
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </Field>
      </div>

      {/*
        ★ 라운드 7 — **"병렬"이 실제로 몇 개인지 숨기지 않는다.**
          여러 건을 걸면 run 은 N 건 생기지만 동시에 도는 것은 Runner 의 한도까지다.
          한도를 모르면(Runner 미기동·구버전) 숫자를 지어내지 않고 그렇게 적는다.
      */}
      {batchSize <= 1 ? null : (
        <NoticeBox title={`${String(batchSize)}건이 한 묶음으로 큐에 올라갑니다`}>
          <NoticeLine data-slot="batch-concurrency-notice">
            {concurrency === null
              ? "동시에 몇 건이 실행되는지는 Runner 가 알려 주지 않았습니다(Runner 미기동일 수 있습니다). 나머지는 큐에서 차례를 기다립니다."
              : `Runner 는 한 번에 최대 ${String(concurrency)}건을 동시에 실행합니다. ` +
                (batchSize > concurrency
                  ? `나머지 ${String(batchSize - concurrency)}건은 큐에서 차례를 기다리며, 앞 실행이 끝나는 대로 순서대로 시작합니다.`
                  : "선택한 건수가 한도 안이라 모두 곧바로 시작됩니다.")}
          </NoticeLine>
        </NoticeBox>
      )}

      {runnerDown ? (
        <NoticeBox title="Runner 가 실행 중이 아닙니다">
          <NoticeLine>
            실행 요청은 접수되지만 <strong>큐에 쌓인 채 진행되지 않습니다.</strong> 서버에서
            Runner 를 기동한 뒤 요청하면 대기 중인 실행부터 순서대로 처리됩니다.
          </NoticeLine>
        </NoticeBox>
      ) : null}

      {errors.length === 0 ? null : (
        <div
          role="alert"
          data-slot="run-dialog-error"
          className="mt-[14px] rounded-metric border border-danger bg-danger-soft px-[14px] py-[12px] text-[11px] leading-[1.6] text-danger"
        >
          {errors.map((line) => (
            <p key={line} className="m-0">
              {line}
            </p>
          ))}
        </div>
      )}

      <div className="mt-[18px] flex items-center justify-end gap-[9px]">
        <Button onClick={onClose}>취소</Button>
        <Button
          type="submit"
          variant="primary"
          data-slot="run-dialog-submit"
          disabled={createRun.isPending}
        >
          {createRun.isPending ? "요청 중…" : "▶ 실행 시작"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-[12px] block">
      <span className="mb-[6px] block text-label text-muted">{label}</span>
      {children}
      {hint === undefined ? null : (
        <span className="mt-[5px] block text-[10px] leading-[1.5] text-muted">{hint}</span>
      )}
    </label>
  );
}

function apiErrorLines(error: unknown): readonly string[] {
  if (error === null || error === undefined) return [];
  if (error instanceof Error) {
    const details = (error as { details?: readonly string[] }).details;
    return details !== undefined && details.length > 0 ? details : [error.message];
  }
  return ["실행 요청에 실패했습니다"];
}
