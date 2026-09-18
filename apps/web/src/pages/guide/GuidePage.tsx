import { cn } from "cn";
import { NoticeBox, NoticeLine } from "@/components";
import { PageHead } from "@/components/ui";
import { CodeBlock } from "./CodeBlock";
import { InlineMd } from "./InlineMd";
import {
  GUIDE_INTRO,
  GUIDE_SECTIONS,
  GUIDE_SOURCE_PATH,
  GUIDE_TITLE,
  type GuideBlock,
  type GuideSection,
  type GuideTable,
} from "./content";

/**
 * 가이드 화면 — `docs/AI로-테스트코드-만들기.md` 를 앱 안에서 읽는다.
 *
 * ## 레이아웃
 * 시안에 없는 화면이라 새 디자인을 만들지 않고 **기존 패턴만 조합**했다.
 *   - 머리: `PageHead` (시안 `.page-head`)
 *   - 표: 시나리오 목록과 같은 table-wrap + th(`--table-head`) + td
 *   - 알림: `NoticeBox`/`NoticeLine` (시안 `.notice` — amber)
 *   - 목차: `tf-inspector-sticky` (시안 `.inspector` 의 sticky 규칙 재사용)
 * 새 색·새 반경을 만들지 않았다.
 *
 * ## ★ 본문 폭을 제한한다
 * 콘텐츠 영역은 최대 1500px(`--spacing-content-max`)까지 늘어난다. 14px 본문이
 * 1440px 줄이면 한 줄에 100자가 넘어가 눈이 다음 줄 첫 글자를 못 찾는다.
 * 그래서 읽는 열은 `max-w-[820px]`(≈ 한글 55~60자)로 묶고, 남는 폭은 목차가 쓴다.
 * 1050px 이하에서는 목차가 본문 위로 올라오고 한 단이 된다(시안 브레이크포인트 그대로).
 *
 * DOM 순서는 **목차 → 본문**이다. 그래야 한 단으로 접혔을 때 목차가 위에 온다.
 * 넓은 화면에서 목차를 오른쪽에 두는 것은 grid 배치(`col-start-2`)로만 처리한다.
 */
export function GuidePage() {
  return (
    <>
      {/*
        `description` 을 주지 않는다. 원본 md 의 첫 문장이 바로 아래 `GUIDE_INTRO` 로
        그려지는데, 여기에 비슷한 요약을 또 쓰면 같은 말이 두 번 나온다.
        (그리고 그 요약은 원본에 없는 **새로 쓴 문장**이 된다 — 이 작업의 금기다.)
      */}
      <PageHead title={GUIDE_TITLE} />

      <div
        data-slot="guide-layout"
        className="grid grid-cols-[minmax(0,1fr)_216px] gap-[24px] max-compact:grid-cols-1"
      >
        <Toc />

        <article
          data-slot="guide-body"
          className="col-start-1 row-start-1 min-w-0 max-w-[820px] max-compact:col-auto max-compact:row-auto"
        >
          {GUIDE_INTRO.map((block, index) => (
            <Block key={index} block={block} />
          ))}

          {GUIDE_SECTIONS.map((section) => (
            <Section key={section.id} section={section} />
          ))}

          <p className="mt-[34px] border-t border-line pt-[16px] text-[11px] text-muted">
            이 화면의 원본 문서는 레포지토리의 <code className="font-mono">{GUIDE_SOURCE_PATH}</code>{" "}
            입니다. 내용을 고칠 때는 그 파일을 먼저 고치세요 — 두 곳이 어긋나면 테스트가 실패합니다.
          </p>
        </article>
      </div>
    </>
  );
}

/* ── 목차 ────────────────────────────────────────────────── */

/**
 * 앵커 목차.
 *
 * `<a href="#id">` 그대로 쓴다 — 주소창에 앵커가 남아 **절 링크를 그대로 공유**할 수 있고,
 * JS 없이도 동작한다. 스크롤 위치 보정은 각 제목의 `scroll-mt-*` 가 맡는다
 * (탑바가 `sticky` 라 보정이 없으면 제목이 탑바 뒤에 숨는다).
 */
function Toc() {
  return (
    <nav
      data-slot="guide-toc"
      aria-label="목차"
      className={cn(
        "tf-inspector-sticky col-start-2 row-start-1",
        "rounded-panel border border-line bg-panel px-[14px] py-[13px]",
        "max-compact:col-auto max-compact:row-auto",
      )}
    >
      <div className="mb-[8px] text-nav-label text-table-head-ink">목차</div>
      <ol className="m-0 list-none p-0">
        {GUIDE_SECTIONS.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className="block rounded-btn px-[8px] py-[6px] text-[12px] text-ink hover:bg-btn-hover-bg hover:text-brand"
            >
              {section.title}
            </a>
            <SubToc section={section} />
          </li>
        ))}
      </ol>
    </nav>
  );
}

function SubToc({ section }: { section: GuideSection }) {
  const headings = section.blocks.filter((block) => block.kind === "h3");
  if (headings.length === 0) return null;

  return (
    /*
     * 760px 이하에서는 소절 목차를 감춘다. 한 단으로 접히면 목차가 본문 위에 통째로
     * 쌓이는데, 12줄짜리 목차가 첫 화면을 다 먹으면 "문서"가 아니라 "메뉴"로 보인다.
     * 절 6개만 남기면 4~5줄이라 바로 아래 본문이 함께 보인다.
     */
    <ol className="m-0 mb-[4px] list-none border-l border-hairline p-0 pl-[10px] max-mobile:hidden">
      {headings.map((heading) => (
        <li key={heading.id}>
          <a
            href={`#${heading.id}`}
            className="block rounded-btn px-[8px] py-[4px] text-[11px] text-muted hover:bg-btn-hover-bg hover:text-brand"
          >
            {/* 목차는 **라벨**이다. 인라인 코드 칩까지 그리면 좁은 열에서 줄이 튄다 — 백틱만 뗀다. */}
            {heading.text.replace(/`/g, "")}
          </a>
        </li>
      ))}
    </ol>
  );
}

/* ── 블록 렌더러 ─────────────────────────────────────────── */

function Section({ section }: { section: GuideSection }) {
  return (
    <section data-slot="guide-section" className="mt-[34px]">
      <h2
        id={section.id}
        className="scroll-mt-[var(--spacing-inspector-top)] border-t border-line pt-[22px] text-[19px] font-750"
      >
        {section.title}
      </h2>
      {section.blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </section>
  );
}

function Block({ block }: { block: GuideBlock }) {
  switch (block.kind) {
    case "p":
      return (
        <p className="mt-[12px] mb-0 leading-[1.85]">
          <InlineMd text={block.text} />
        </p>
      );

    case "h3":
      return (
        <h3
          id={block.id}
          className="mt-[26px] scroll-mt-[var(--spacing-inspector-top)] text-[15px] font-750"
        >
          <InlineMd text={block.text} />
        </h3>
      );

    case "code":
      return (
        <CodeBlock
          code={block.code}
          lang={block.lang}
          {...(block.caption === undefined ? {} : { caption: block.caption })}
          {...(block.copy === undefined ? {} : { copy: block.copy })}
        />
      );

    case "note":
      return <Note text={block.text} />;

    case "table":
      return <Table table={block.table} />;

    case "ul":
      return (
        <ul className="mt-[12px] mb-0 list-disc pl-[20px] leading-[1.85] marker:text-line">
          {block.items.map((item, index) => (
            <li key={index} className="mt-[7px]">
              <InlineMd text={item} />
            </li>
          ))}
        </ul>
      );

    case "ol":
      return (
        <ol className="mt-[12px] mb-0 list-decimal pl-[22px] leading-[1.85] marker:font-750 marker:text-brand">
          {block.items.map((item, index) => (
            <li key={index} className="mt-[10px] min-w-0">
              <InlineMd text={item.text} />
              {item.sub === undefined ? null : (
                <ul className="m-0 list-disc pl-[18px] text-[13px] text-muted marker:text-line">
                  {item.sub.map((sub, subIndex) => (
                    <li key={subIndex} className="mt-[4px]">
                      <InlineMd text={sub} />
                    </li>
                  ))}
                </ul>
              )}
              {item.table === undefined ? null : <Table table={item.table} />}
            </li>
          ))}
        </ol>
      );

    case "qa":
      return (
        <dl className="m-0">
          {block.items.map((item, index) => (
            <div key={index} className="mt-[18px]">
              <dt className="font-750">
                <InlineMd text={item.q} />
              </dt>
              {item.a.map((answer, answerIndex) => (
                <dd key={answerIndex} className="mt-[5px] ml-0 leading-[1.85] text-muted">
                  <InlineMd text={answer} />
                </dd>
              ))}
            </div>
          ))}
        </dl>
      );
  }
}

/**
 * 원본 md 의 인용문(`>`) → 시안 amber notice.
 *
 * 두 인용문 모두 `[⚠️] **굵은 한 문장.** 나머지 설명` 꼴이라, 앞의 굵은 부분을
 * `NoticeBox` 의 제목으로, 나머지를 `NoticeLine` 으로 넘긴다.
 * **데이터는 원본 md 문자열 한 덩어리 그대로 두고 쪼개는 일은 여기서만 한다** —
 * 그래야 `content.spec.ts` 가 md 와 글자 단위로 대조할 수 있다.
 */
const NOTE_LEAD = /^(⚠️\s*)?\*\*(.+?)\*\*\s*/;

function Note({ text }: { text: string }) {
  const match = NOTE_LEAD.exec(text);
  const mark = match?.[1] ?? "";
  const lead = match?.[2] ?? "";
  const rest = match === null ? text : text.slice(match[0].length);

  return (
    <NoticeBox title={`${mark}${lead}`} className="mt-[14px]">
      <NoticeLine className="text-[12px]">
        <InlineMd text={rest} />
      </NoticeLine>
    </NoticeBox>
  );
}

/**
 * 표.
 *
 * `min-w-[420px]` + 래퍼 `overflow-x-auto` — 좁은 화면에서 표가 **자기 상자 안에서만**
 * 가로 스크롤한다. 래퍼에 `min-w-0` 이 없으면 표가 본문을 밀어 페이지가 가로로 넘친다.
 */
function Table({ table }: { table: GuideTable }) {
  return (
    <div className="mt-[14px] min-w-0 overflow-x-auto rounded-table border border-line bg-panel">
      <table className="w-full min-w-[420px] border-collapse">
        <thead>
          <tr>
            {table.head.map((cell, index) => (
              <th
                key={index}
                scope="col"
                className="bg-table-head px-[13px] py-[10px] text-left text-th text-table-head-ink"
              >
                {cell === "" ? <span className="sr-only">항목</span> : <InlineMd text={cell} />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className="border-t border-line px-[13px] py-[11px] text-td leading-[1.6] align-top"
                >
                  <InlineMd text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
