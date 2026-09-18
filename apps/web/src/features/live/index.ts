/**
 * 실행 라이브 뷰 barrel (라운드 2).
 *
 * `features/recorder` 와 **형제**로 둔다 — 프레임 디코드·렌더는 그쪽 것을 재사용하지만
 * 입력 역주입이 없고 수명주기(run 종료 = 스트림 종료)가 달라 화면 조각은 따로 둔다.
 */
export * from "./LiveCanvas";
