export interface GreenhouseQuestionsFixture {
  url: string;
  requests: () => string[];
  stop: () => void;
}

export function startGreenhouseQuestionsFixture() {
  const requests: string[] = [];

  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);

      requests.push(`${url.pathname}${url.search}`);

      return new Response("not found", { status: 404 });
    },
  });

  return {
    requests: () => [...requests],
    stop: () => {
      void server.stop(true);
    },
    url: `http://127.0.0.1:${String(server.port)}`,
  } satisfies GreenhouseQuestionsFixture;
}
