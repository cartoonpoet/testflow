export function resolveWebSocketUrlForPage(wsUrl: string, pageHref: string): string {
  const socketUrl = new URL(wsUrl);
  const pageUrl = new URL(pageHref);

  socketUrl.protocol = pageUrl.protocol === "https:" ? "wss:" : "ws:";
  socketUrl.host = pageUrl.host;

  return socketUrl.toString();
}
