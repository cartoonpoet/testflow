import type { ZodType } from "zod";

/**
 * API 베이스 경로.
 *
 * 기본값 `/api` — 사내 단일 서버 배포에서 nginx 가 같은 오리진으로 프록시한다.
 * 개발 중 별도 오리진(`http://127.0.0.1:4000/api`)을 쓰려면 `VITE_API_BASE_URL` 로 덮는다.
 * env 는 tsconfig `noPropertyAccessFromIndexSignature` 규약에 따라 bracket 접근한다.
 */
export const API_BASE_URL: string =
  (import.meta.env["VITE_API_BASE_URL"] as string | undefined)?.replace(/\/+$/, "") ??
  "/api";

/** Nest 기본 예외 응답 포맷. 커스텀 filter 를 두지 않았으므로 항상 이 형태다. */
export type NestErrorBody = {
  statusCode: number;
  message: string | string[];
  error?: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  /** ValidationPipe 가 배열로 주는 필드별 메시지. */
  readonly details: readonly string[];
  readonly body: unknown;

  constructor(status: number, message: string, options: {
    code?: string | undefined;
    details?: readonly string[];
    body?: unknown;
  } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = options.code;
    this.details = options.details ?? [];
    this.body = options.body;
  }
}

export type ApiRequestOptions = Omit<RequestInit, "body" | "method"> & {
  method?: string;
  /** JSON 으로 직렬화해 보낼 body. `FormData` 가 필요하면 `rawBody` 를 쓴다. */
  json?: unknown;
  rawBody?: BodyInit | null;
  /** 쿼리스트링. `undefined`·`null` 값은 생략된다. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** 주면 응답을 이 스키마로 파싱한다. contracts 스키마를 그대로 넘기면 된다. */
  schema?: ZodType<unknown>;
};

export function buildUrl(
  path: string,
  query?: ApiRequestOptions["query"],
): string {
  const base = path.startsWith("/") ? `${API_BASE_URL}${path}` : path;
  if (query === undefined) return base;

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs === "" ? base : `${base}?${qs}`;
}

/**
 * Nest 기본 필터가 **예상치 못한 예외**에 붙이는 고정 문구.
 *
 * 그 자체는 옳다 — 스택·SQL·비밀값을 응답에 싣지 않는다(실측 확인, artifact §5).
 * 다만 **영어**라서 화면의 유일한 영어 문장이 된다. DB 를 내려 보니 모든 화면 설명이
 * `Internal server error` 로 떴다. 서버를 고칠 일은 아니고(응답 포맷은 그대로 두는 것이 맞다)
 * **표시하는 쪽에서** 사람의 말로 바꾼다. 다른 5xx 메시지는 서버가 준 것을 그대로 쓴다 —
 * 우리가 지어낸 문구로 덮으면 진짜 원인이 화면에서 사라진다.
 */
const NEST_GENERIC_500 = "Internal server error";

export const UNEXPECTED_SERVER_ERROR_MESSAGE =
  "서버에서 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";

export function toApiError(status: number, body: unknown): ApiError {
  if (typeof body === "object" && body !== null && "message" in body) {
    const nest = body as NestErrorBody;
    const details = Array.isArray(nest.message) ? nest.message : [];
    const raw = details.length > 0 ? details.join(", ") : String(nest.message);
    const message =
      raw === NEST_GENERIC_500 ? UNEXPECTED_SERVER_ERROR_MESSAGE : raw;
    return new ApiError(status, message, {
      code: nest.error,
      details,
      body,
    });
  }
  return new ApiError(status, `요청이 실패했습니다 (HTTP ${status})`, { body });
}

/**
 * 공용 fetch 래퍼.
 *
 * - 성공: 204 는 `undefined`, 그 외는 JSON 을 반환한다.
 * - 실패: `ApiError` 를 throw 한다 (react-query 가 그대로 error 로 받는다).
 * - `schema` 를 주면 파싱까지 하고, 계약 위반이면 ApiError(0) 으로 승격한다.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { json, rawBody, query, schema, headers, method, ...rest } = options;

  const finalHeaders = new Headers(headers);
  finalHeaders.set("Accept", "application/json");
  let body: BodyInit | null | undefined = rawBody;
  if (json !== undefined) {
    finalHeaders.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      ...rest,
      method: method ?? (body === undefined || body === null ? "GET" : "POST"),
      headers: finalHeaders,
      ...(body === undefined ? {} : { body }),
    });
  } catch (error) {
    /*
     * ★ **연결 자체가 실패한 경우** — API 가 안 떠 있거나 망이 끊겼다. 가장 흔한 상황이다.
     *   그대로 두면 화면에 브라우저의 영어 원문(`Failed to fetch` · `NetworkError when
     *   attempting to fetch resource`)이 그대로 뜬다. 실측으로 확인했다(artifact §6).
     *   `ApiError` 로 감싸 **한국어 한 줄**로 바꾼다 — 화면들은 이미 `ApiError.message` 를
     *   `StateView` 설명으로 쓰고 있어 표시 코드를 한 줄도 바꾸지 않는다.
     */
    throw toNetworkError(error);
  }

  const text = await response.text();
  const parsed: unknown = text === "" ? undefined : safeJson(text);

  if (!response.ok) throw toApiError(response.status, parsed);
  if (schema === undefined) return parsed as T;

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new ApiError(0, "서버 응답이 계약과 다릅니다", {
      code: "ContractMismatch",
      details: result.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
      body: parsed,
    });
  }
  return result.data as T;
}

/**
 * fetch 자체가 거부한 이유를 사용자 문장으로 바꾼다.
 *
 * ★ **`AbortError` 는 그대로 던진다.** 취소는 고장이 아니고, 호출부(SSE·라이브 스트림)가
 *   `name === "AbortError"` 로 구분해 조용히 넘어간다 — 여기서 감싸면 그 구분이 깨져
 *   화면을 떠날 때마다 "서버에 연결하지 못했습니다" 가 뜬다.
 *
 * `status` 는 `0` 이다(HTTP 응답이 없었다는 뜻). `queryClient` 의 재시도 규칙이
 * `4xx` 만 걸러내므로 **네트워크 실패는 그대로 2회 재시도된다** — 잠깐 끊긴 경우 저절로 낫는다.
 */
export function toNetworkError(error: unknown): unknown {
  if (error instanceof DOMException && error.name === "AbortError") return error;
  if (error instanceof ApiError) return error;
  return new ApiError(0, "네트워크 또는 API 서버 연결이 끊겼습니다. 서버 상태를 확인한 뒤 다시 시도해 주세요.", {
    code: "NetworkError",
    body: error,
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export const api = {
  get: <T>(path: string, options?: ApiRequestOptions) =>
    apiFetch<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, json?: unknown, options?: ApiRequestOptions) =>
    apiFetch<T>(path, { ...options, method: "POST", json }),
  patch: <T>(path: string, json?: unknown, options?: ApiRequestOptions) =>
    apiFetch<T>(path, { ...options, method: "PATCH", json }),
  put: <T>(path: string, json?: unknown, options?: ApiRequestOptions) =>
    apiFetch<T>(path, { ...options, method: "PUT", json }),
  delete: <T>(path: string, options?: ApiRequestOptions) =>
    apiFetch<T>(path, { ...options, method: "DELETE" }),
} as const;
