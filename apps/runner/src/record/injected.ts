/**
 * 원격 페이지 주입 스크립트 — 행동 감지 + Locator 후보 생성 (03-phases Task 7.3 · 7.4)
 *
 * ★ 이 파일은 **원격 브라우저 페이지 컨텍스트**에서 도는 유일한 코드다. Node API 가 없다.
 *   `context.addInitScript({ path: dist/record/injected.js })` 로 주입되며,
 *   `addInitScript` 는 **새 문서마다 자동 재주입**되므로 페이지 이동 후에도 리스너가 살아남는다.
 *
 * ★ 이 파일에는 **import/export 가 없다.** TypeScript 가 "모듈"이 아니라 "스크립트"로 취급해야
 *   `addInitScript` 가 그대로 평가할 수 있는 평범한 JS 로 emit 된다(ESM `export` 가 한 줄이라도
 *   섞이면 페이지에서 SyntaxError 가 난다). 그래서 타입도 이 파일 안에서만 정의한다.
 *   DOM lib 이 필요하므로 빌드는 `tsconfig.injected.json` 이 따로 맡는다.
 *
 * ## 왜 CDP Input 이벤트가 아니라 주입 리스너인가
 * CDP `Input` 이벤트는 **우리가 보낸 좌표와 키**만 알려 줄 뿐 **어떤 DOM 요소가 눌렸는지 모른다.**
 * 좌표만으로 스텝을 만들면 FR-004(role/label/text/testid Locator)를 만족시킬 수 없고 해상도가
 * 바뀌면 재생이 깨진다. 주입 리스너는 `event.target` 에서 요소를 직접 얻는다
 * (02-context "행동 → 스텝 변환").
 *
 * ## 반드시 지키는 4가지
 * 1. **캡처 단계**(`{capture:true}`) 에 건다 — 대상 페이지가 `stopPropagation()` 해도 먼저 본다.
 * 2. **`input` 디바운스** — 글자마다 오는 이벤트를 마지막 값 하나의 `fill` 로 합친다.
 *    (안 하면 "아이디 입력" 하나가 스텝 20개가 된다.)
 * 3. **`isComposing` 필터** — 역주입 이벤트도 리스너에 잡히는 게 목적이지만, IME 조합 중간
 *    상태가 `input` 으로 새어 나오면 안 된다.
 * 4. **`type="password"` 는 값을 수집하지 않는다** — `{{password}}` 참조 + `isSecret:true`.
 *    (02-context "★ 최종 결정 (c) 파생 영향" 마지막 항목 / 시안의 `••••••••` 가 여기서 나온다)
 *
 * ## ★ 고유성 검증 (Task 7.4 의 핵심)
 * 후보를 만들면 **그 자리에서 매칭을 돌려 1개만 맞는지 확인**한다. 여러 개면 `nth` 로 좁히고,
 * 그래도 안 되면 다음 순위로 내려간다. 이 검증이 없으면 "녹화는 되는데 재생이 깨지는" 최악의
 * 실패 모드가 나온다. 매칭 규칙은 Playwright 의 `getByRole/getByLabel/getByText/getByTestId`
 * 의미를 페이지 안에서 재현한 것이다(`apps/runner/src/execute/locator.ts` 가 소비하는 쪽).
 */

(() => {
  /* ── 페이지 안에서만 쓰는 타입 (Node 쪽 `step-mapper.ts` 의 `RecordedAction` 과 1:1) ── */

  interface Candidate {
    by: "role" | "label" | "text" | "testid" | "css";
    role?: string;
    name?: string;
    value?: string;
    exact?: boolean;
    nth?: number;
  }

  interface Snapshot {
    tag: string;
    attrs?: Record<string, string>;
    text?: string;
  }

  interface Target {
    primary: Candidate;
    fallbacks: Candidate[];
    frameUrl: string | null;
    snapshot: Snapshot | null;
  }

  interface RecordedAction {
    kind: "click" | "fill" | "select" | "check" | "uncheck" | "press";
    target: Target;
    /** `fill`/`select` 의 입력값, `press` 의 키 이름. 비밀번호면 `{{password}}` 가 들어온다. */
    value?: string;
    isSecret?: boolean;
    /** 업무 문장 생성용 힌트. */
    role: string | null;
    accessibleName: string | null;
    label: string | null;
    tag: string;
    inputType: string | null;
    url: string;
    at: number;
  }

  type EmitFn = (action: RecordedAction) => unknown;

  interface InjectedWindow extends Window {
    __tfInjected?: boolean;
    __tfEmit?: EmitFn;
    /** 단위·통합 검증에서 쓰는 진입점. 프로덕션 경로는 이벤트 리스너다. */
    __tfBuildTarget?: (el: Element) => Target;
  }

  const win = window as InjectedWindow;

  // 같은 문서에 두 번 주입되는 경우(addInitScript + 수동 주입)를 막는다.
  if (win.__tfInjected === true) return;
  win.__tfInjected = true;

  /** 같은 요소 연속 입력을 하나로 합치는 시간. 이 시간만큼 조용하면 확정한다. */
  const DEBOUNCE_MS = 600;
  /** `submit` 이 직전 click/press 와 중복 스텝을 만드는 것을 막는 창(窓). */
  const SUBMIT_DEDUPE_MS = 500;
  /** text 후보로 쓰기에 너무 긴 문자열은 버린다(문단 전체가 Locator 가 되는 사고 방지). */
  const MAX_TEXT_LEN = 80;
  /** 비밀번호 필드가 승격되는 변수 참조. 값 자체는 어디에도 남기지 않는다. */
  const SECRET_PLACEHOLDER = "{{password}}";
  const TEST_ID_ATTR = "data-testid";

  /* ════════════════════════════════════════════════════════════
   * 1. 공용 유틸
   * ════════════════════════════════════════════════════════════ */

  const norm = (value: string | null | undefined): string =>
    (value ?? "").replace(/\s+/gu, " ").trim();

  const lower = (value: string): string => value.toLocaleLowerCase();

  const isElement = (node: unknown): node is Element =>
    node !== null && typeof node === "object" && (node as Node).nodeType === 1;

  const allElements = (): Element[] => Array.from(document.querySelectorAll("*"));

  /* ════════════════════════════════════════════════════════════
   * 2. 접근성 — 암시적 role 과 accessible name
   *
   *   Playwright 의 `getByRole` 이 쓰는 ARIA 계산을 페이지 안에서 근사한다. 전체 ARIA 스펙을
   *   구현하지 않는 이유는 **틀리면 후보가 탈락할 뿐 재생이 깨지지는 않기 때문**이다 —
   *   재생 시점에도 `locator.ts` 가 "정확히 1개" 를 다시 확인한다(이중 방어).
   * ════════════════════════════════════════════════════════════ */

  const INPUT_TYPE_ROLE: Record<string, string> = {
    button: "button",
    submit: "button",
    reset: "button",
    image: "button",
    checkbox: "checkbox",
    radio: "radio",
    range: "slider",
    number: "spinbutton",
    search: "searchbox",
    email: "textbox",
    tel: "textbox",
    text: "textbox",
    url: "textbox",
    "": "textbox",
    // ★ password 는 대응 role 이 없다(HTML-AAM). getByRole('textbox') 에 잡히지 않으므로
    //   후보를 만들면 재생이 깨진다. 의도적으로 빼 둔다.
  };

  const TAG_ROLE: Record<string, string> = {
    BUTTON: "button",
    TEXTAREA: "textbox",
    H1: "heading",
    H2: "heading",
    H3: "heading",
    H4: "heading",
    H5: "heading",
    H6: "heading",
    NAV: "navigation",
    MAIN: "main",
    ASIDE: "complementary",
    UL: "list",
    OL: "list",
    LI: "listitem",
    TABLE: "table",
    TR: "row",
    TD: "cell",
    TH: "columnheader",
    DIALOG: "dialog",
    OPTION: "option",
    PROGRESS: "progressbar",
    P: "paragraph",
    FIGURE: "figure",
    HR: "separator",
    OUTPUT: "status",
  };

  function computeRole(el: Element): string | null {
    const explicit = norm(el.getAttribute("role"));
    if (explicit !== "") return lower(explicit.split(" ")[0] ?? "");

    const tag = el.tagName.toUpperCase();
    if (tag === "A") return el.hasAttribute("href") ? "link" : null;
    if (tag === "IMG") return el.getAttribute("alt") === "" ? "presentation" : "img";
    if (tag === "INPUT") {
      const type = lower(norm((el as HTMLInputElement).getAttribute("type")));
      if (type === "hidden") return null;
      if (type === "password") return null;
      const role = INPUT_TYPE_ROLE[type];
      if (role === "textbox" && el.hasAttribute("list")) return "combobox";
      return role ?? null;
    }
    if (tag === "SELECT") {
      const select = el as HTMLSelectElement;
      return select.multiple || select.size > 1 ? "listbox" : "combobox";
    }
    if (tag === "FORM") return norm(el.getAttribute("aria-label")) === "" ? null : "form";
    if (tag === "HEADER") return el.closest("article, aside, main, nav, section") ? null : "banner";
    if (tag === "FOOTER") return el.closest("article, aside, main, nav, section") ? null : "contentinfo";
    if (tag === "SECTION") return norm(el.getAttribute("aria-label")) === "" ? null : "region";
    return TAG_ROLE[tag] ?? null;
  }

  /** `<label for>` / 조상 `<label>` 의 텍스트. Playwright `getByLabel` 의 주 근거다. */
  function nativeLabelText(el: Element): string {
    const parts: string[] = [];
    const id = el.getAttribute("id");
    if (id !== null && id !== "") {
      const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id;
      for (const label of Array.from(document.querySelectorAll(`label[for="${escaped}"]`))) {
        const text = norm(label.textContent);
        if (text !== "") parts.push(text);
      }
    }
    const ancestor = el.closest("label");
    if (ancestor) {
      const text = norm(ancestor.textContent);
      if (text !== "" && parts.indexOf(text) === -1) parts.push(text);
    }
    return parts.join(" ");
  }

  /** `getByLabel` 이 보는 라벨 — 네이티브 label → aria-labelledby → aria-label → placeholder. */
  function labelText(el: Element): string {
    const native = norm(nativeLabelText(el));
    if (native !== "") return native;

    const labelledBy = norm(el.getAttribute("aria-labelledby"));
    if (labelledBy !== "") {
      const text = labelledBy
        .split(" ")
        .map((refId) => norm(document.getElementById(refId)?.textContent))
        .filter((value) => value !== "")
        .join(" ");
      if (text !== "") return text;
    }

    const ariaLabel = norm(el.getAttribute("aria-label"));
    if (ariaLabel !== "") return ariaLabel;

    const placeholder = norm(el.getAttribute("placeholder"));
    if (placeholder !== "") return placeholder;

    return "";
  }

  function accessibleName(el: Element): string {
    const fromLabel = labelText(el);
    if (fromLabel !== "") return fromLabel;

    const tag = el.tagName.toUpperCase();
    if (tag === "INPUT") {
      const input = el as HTMLInputElement;
      const type = lower(norm(input.getAttribute("type")));
      if (type === "button" || type === "submit" || type === "reset") return norm(input.value);
      if (type === "image") return norm(input.getAttribute("alt"));
      return "";
    }
    if (tag === "IMG") return norm(el.getAttribute("alt"));

    const text = norm(el.textContent);
    if (text !== "" && text.length <= 200) return text;

    return norm(el.getAttribute("title"));
  }

  /**
   * `getByText` 가 매칭하는 "가장 작은 요소" 의 텍스트.
   * 자식 중에도 같은 텍스트를 가진 요소가 있으면 우리가 가장 작은 요소가 아니다.
   */
  function visibleText(el: Element): string {
    const tag = el.tagName.toUpperCase();
    if (tag === "INPUT") {
      const type = lower(norm(el.getAttribute("type")));
      // Playwright: input[type=button|submit] 은 텍스트 대신 value 로 매칭된다.
      return type === "button" || type === "submit" ? norm((el as HTMLInputElement).value) : "";
    }
    return norm(el.textContent);
  }

  function isSmallestTextMatch(el: Element, value: string, exact: boolean): boolean {
    if (!textMatches(visibleText(el), value, exact)) return false;
    for (const child of Array.from(el.querySelectorAll("*"))) {
      if (textMatches(visibleText(child), value, exact)) return false;
    }
    return true;
  }

  /** Playwright 규약: `exact:false` 는 대소문자 무시 + 부분 일치, `exact:true` 는 완전 일치. */
  function textMatches(actual: string, expected: string, exact: boolean): boolean {
    if (exact) return actual === expected;
    return lower(actual).indexOf(lower(expected)) !== -1;
  }

  /* ════════════════════════════════════════════════════════════
   * 3. ★ 고유성 검증 — 후보별 매칭 집합을 페이지 안에서 직접 센다
   * ════════════════════════════════════════════════════════════ */

  /** Playwright `getByLabel` 대상이 되는 폼 컨트롤. */
  const LABELABLE = "input, textarea, select, button, meter, output, progress";

  function matchesFor(candidate: Candidate): Element[] {
    const exact = candidate.exact === true;

    if (candidate.by === "role") {
      const wanted = candidate.role ?? "";
      const name = candidate.name;
      return allElements().filter((el) => {
        if (computeRole(el) !== wanted) return false;
        if (name === undefined) return true;
        return textMatches(norm(accessibleName(el)), name, exact);
      });
    }

    if (candidate.by === "label") {
      const value = candidate.value ?? "";
      return Array.from(document.querySelectorAll(LABELABLE)).filter((el) =>
        textMatches(norm(labelText(el)), value, exact),
      );
    }

    if (candidate.by === "text") {
      const value = candidate.value ?? "";
      return allElements().filter((el) => isSmallestTextMatch(el, value, exact));
    }

    if (candidate.by === "testid") {
      const value = candidate.value ?? "";
      const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value;
      return Array.from(document.querySelectorAll(`[${TEST_ID_ATTR}="${escaped}"]`));
    }

    try {
      return Array.from(document.querySelectorAll(candidate.value ?? ""));
    } catch {
      return [];
    }
  }

  /* ════════════════════════════════════════════════════════════
   * 4. CSS 최후 fallback (고급 설정 전용 — 테스터 화면에 노출하지 않는다)
   * ════════════════════════════════════════════════════════════ */

  function uniqueIdSelector(el: Element): string | null {
    const id = el.getAttribute("id");
    if (id === null || id === "") return null;
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id;
    const selector = `#${escaped}`;
    try {
      return document.querySelectorAll(selector).length === 1 ? selector : null;
    } catch {
      return null;
    }
  }

  function cssPath(el: Element): string {
    const byId = uniqueIdSelector(el);
    if (byId !== null) return byId;

    const parts: string[] = [];
    let cursor: Element | null = el;
    while (cursor !== null && cursor !== document.documentElement) {
      const node: Element = cursor;
      const nodeId = uniqueIdSelector(node);
      if (nodeId !== null) {
        parts.unshift(nodeId);
        break;
      }
      let part = lower(node.tagName);
      const parent = node.parentElement;
      if (parent !== null) {
        const sameTag = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
        if (sameTag.length > 1) part += `:nth-of-type(${String(sameTag.indexOf(node) + 1)})`;
      }
      parts.unshift(part);
      cursor = node.parentElement;
    }
    return parts.join(" > ");
  }

  /* ════════════════════════════════════════════════════════════
   * 5. 후보 배열 생성 — role → label → text → testid → (fallback) css
   * ════════════════════════════════════════════════════════════ */

  function buildTarget(el: Element): Target {
    /** 유일하게 매칭된 후보(우선순위 순). */
    const unique: Candidate[] = [];
    /** `nth` 로 좁힌 후보(우선순위 순). 유일 후보가 하나도 없을 때만 primary 가 된다. */
    const narrowed: Candidate[] = [];
    /** css 는 언제나 맨 뒤다(02-context 우선순위 5번 = 최후 fallback). */
    const cssCandidates: Candidate[] = [];

    const consider = (candidate: Candidate): void => {
      const matches = matchesFor(candidate);
      const index = matches.indexOf(el);
      if (index === -1) return; // 후보가 우리 요소를 못 집는다 → 쓸 수 없다.

      const bucket = candidate.by === "css" ? cssCandidates : matches.length === 1 ? unique : narrowed;
      if (matches.length === 1) {
        bucket.push(candidate);
        return;
      }
      // ★ 여러 개 매칭 → 그 자리에서 좁힌다. `nth` 는 `locator.ts` 가 이미 소비하는 필드다.
      bucket.push({ ...candidate, nth: index });
    };

    const role = computeRole(el);
    const name = norm(accessibleName(el));
    if (role !== null && role !== "presentation") {
      if (name !== "" && name.length <= MAX_TEXT_LEN) {
        consider({ by: "role", role, name, exact: true });
      } else {
        consider({ by: "role", role });
      }
    }

    const label = norm(labelText(el));
    if (label !== "" && label.length <= MAX_TEXT_LEN) {
      consider({ by: "label", value: label, exact: true });
    }

    const text = norm(visibleText(el));
    if (text !== "" && text.length <= MAX_TEXT_LEN) {
      consider({ by: "text", value: text, exact: true });
    }

    const testId = norm(el.getAttribute(TEST_ID_ATTR));
    if (testId !== "") consider({ by: "testid", value: testId });

    consider({ by: "css", value: cssPath(el) });

    const chain = unique.concat(narrowed).concat(cssCandidates);
    const primary: Candidate = chain[0] ?? { by: "css", value: cssPath(el) };

    return {
      primary,
      fallbacks: chain.slice(1),
      frameUrl: window.top === window ? null : window.location.href,
      snapshot: snapshotOf(el),
    };
  }

  /** 실패 진단용. ★ `value` 속성은 담지 않는다 — 비밀번호가 새는 경로다. */
  function snapshotOf(el: Element): Snapshot {
    const attrs: Record<string, string> = {};
    const keep = ["id", "name", "type", "class", "placeholder", "href", TEST_ID_ATTR];
    for (const key of keep) {
      const value = el.getAttribute(key);
      if (value !== null && value !== "") attrs[key] = value.slice(0, 120);
    }
    const isPassword = lower(norm(el.getAttribute("type"))) === "password";
    const text = isPassword ? "" : norm(el.textContent).slice(0, 120);
    const snapshot: Snapshot = { tag: lower(el.tagName), attrs };
    if (text !== "") snapshot.text = text;
    return snapshot;
  }

  win.__tfBuildTarget = buildTarget;

  /* ════════════════════════════════════════════════════════════
   * 6. 행동 감지 — 캡처 단계 리스너 + 디바운스
   * ════════════════════════════════════════════════════════════ */

  let lastEmitAtMs = 0;
  let lastEmitKind = "";

  function emit(action: RecordedAction): void {
    lastEmitAtMs = Date.now();
    lastEmitKind = action.kind;
    try {
      const send = win.__tfEmit;
      if (typeof send === "function") void send(action);
    } catch {
      // 바인딩이 아직 없거나 세션이 접히는 중이다. 페이지 동작을 막지 않는다.
    }
  }

  interface Pending {
    el: Element;
    action: RecordedAction;
    timer: number;
  }

  let pending: Pending | null = null;

  /** 대기 중이던 `fill` 초안을 확정한다. **다른 행동보다 항상 먼저** 나가야 순서가 맞는다. */
  function flushPending(): void {
    if (pending === null) return;
    const action = pending.action;
    window.clearTimeout(pending.timer);
    pending = null;
    emit(action);
  }

  function baseAction(el: Element, kind: RecordedAction["kind"]): RecordedAction {
    const inputType =
      el.tagName.toUpperCase() === "INPUT" ? lower(norm(el.getAttribute("type"))) || "text" : null;
    const label = norm(labelText(el));
    return {
      kind,
      target: buildTarget(el),
      role: computeRole(el),
      accessibleName: norm(accessibleName(el)) || null,
      label: label === "" ? null : label,
      tag: lower(el.tagName),
      inputType,
      url: window.location.href,
      at: Date.now(),
    };
  }

  const EDITABLE = new Set(["INPUT", "TEXTAREA"]);
  const NON_TEXT_INPUT = new Set(["checkbox", "radio", "submit", "button", "reset", "image", "file"]);

  function isTextEditable(el: Element): boolean {
    if ((el as HTMLElement).isContentEditable) return true;
    if (!EDITABLE.has(el.tagName.toUpperCase())) return false;
    if (el.tagName.toUpperCase() === "TEXTAREA") return true;
    const type = lower(norm(el.getAttribute("type"))) || "text";
    return !NON_TEXT_INPUT.has(type);
  }

  function isCheckable(el: Element): boolean {
    if (el.tagName.toUpperCase() !== "INPUT") return false;
    const type = lower(norm(el.getAttribute("type")));
    return type === "checkbox" || type === "radio";
  }

  function currentValue(el: Element): string {
    if ((el as HTMLElement).isContentEditable) return norm(el.textContent);
    return (el as HTMLInputElement | HTMLTextAreaElement).value ?? "";
  }

  /** ★ 비밀번호는 값을 읽지 않는다. 읽는 순간 로그·JSON 어딘가로 샐 가능성이 생긴다. */
  function fillAction(el: Element): RecordedAction {
    const action = baseAction(el, "fill");
    if (action.inputType === "password") {
      action.value = SECRET_PLACEHOLDER;
      action.isSecret = true;
      return action;
    }
    action.value = currentValue(el).slice(0, 2000);
    action.isSecret = false;
    return action;
  }

  document.addEventListener(
    "input",
    (event) => {
      // ★ IME 조합 중간 상태("ㅎ" → "하" → "한")는 흘리지 않는다.
      if ((event as InputEvent).isComposing === true) return;
      const el = event.target;
      if (!isElement(el) || !isTextEditable(el)) return;

      const action = fillAction(el);
      if (pending !== null && pending.el === el) {
        window.clearTimeout(pending.timer);
        pending.action = action;
      } else {
        flushPending();
        pending = { el, action, timer: 0 };
      }
      pending.timer = window.setTimeout(flushPending, DEBOUNCE_MS);
    },
    { capture: true },
  );

  document.addEventListener(
    "change",
    (event) => {
      const el = event.target;
      if (!isElement(el)) return;

      if (el.tagName.toUpperCase() === "SELECT") {
        flushPending();
        const select = el as HTMLSelectElement;
        const action = baseAction(el, "select");
        // Playwright `selectOption` 은 value 를 받는다. 라벨은 문장 생성용으로만 쓴다.
        action.value = select.value;
        action.isSecret = false;
        emit(action);
        return;
      }

      if (isCheckable(el)) {
        flushPending();
        emit(baseAction(el, (el as HTMLInputElement).checked ? "check" : "uncheck"));
        return;
      }

      // 텍스트 입력의 `change` 는 blur 시점이다 — 대기 중인 초안을 지금 확정한다.
      if (pending !== null && pending.el === el) flushPending();
    },
    { capture: true },
  );

  const CLICKABLE_SELECTOR =
    'button, a[href], [role="button"], [role="link"], [role="tab"], input[type="submit"], input[type="button"], input[type="reset"], summary';

  document.addEventListener(
    "click",
    (event) => {
      const raw = event.target;
      if (!isElement(raw)) return;
      // 체크박스/라디오는 `change` 가 check/uncheck 스텝을 만든다. 클릭 스텝을 겹쳐 만들지 않는다.
      if (isCheckable(raw)) return;
      // 텍스트 입력란을 눌러 포커스를 옮기는 것은 스텝이 아니다(다음 fill 이 대신한다).
      if (isTextEditable(raw) && raw.closest(CLICKABLE_SELECTOR) === null) {
        flushPending();
        return;
      }

      flushPending();
      const el = raw.closest(CLICKABLE_SELECTOR) ?? raw;
      emit(baseAction(el, "click"));
    },
    { capture: true },
  );

  document.addEventListener(
    "keydown",
    (event) => {
      const ke = event;
      if (ke.isComposing) return;
      const el = event.target;

      if (ke.key === "Enter") {
        // Enter 는 폼을 보내거나 기본 동작을 일으킨다 → 대기 중 입력을 먼저 확정하고 스텝으로 남긴다.
        flushPending();
        if (isElement(el)) emit({ ...baseAction(el, "press"), value: "Enter", isSecret: false });
        return;
      }

      if (ke.key === "Tab") {
        // Tab 은 포커스 이동일 뿐이라 스텝으로 남기지 않는다. 다만 **대기 중 입력은 확정**한다
        // (Tab 으로 다음 칸에 넘어간 순간 앞 칸 입력은 끝난 것이다).
        flushPending();
      }
    },
    { capture: true },
  );

  document.addEventListener(
    "submit",
    (event) => {
      flushPending();
      // 버튼 클릭이나 Enter 로 이미 스텝이 나갔으면 같은 행동을 두 번 남기지 않는다.
      if (
        Date.now() - lastEmitAtMs < SUBMIT_DEDUPE_MS &&
        (lastEmitKind === "click" || lastEmitKind === "press")
      ) {
        return;
      }
      const form = event.target;
      if (!isElement(form)) return;
      const submitter =
        form.querySelector('button[type="submit"], input[type="submit"], button:not([type])') ?? null;
      if (submitter) emit(baseAction(submitter, "click"));
    },
    { capture: true },
  );

  // 페이지를 떠나기 직전, 대기 중이던 입력을 잃지 않게 확정한다.
  window.addEventListener("beforeunload", flushPending, { capture: true });
  window.addEventListener("pagehide", flushPending, { capture: true });
})();
