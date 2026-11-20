import { startFreshAppServer, test } from "./app.fixture.ts";
import type { AppServer } from "./app.fixture.ts";

const probeTest = test.extend<{ boardServer: AppServer }>({
  boardServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

probeTest("bisect lcd rendering", async ({ boardServer, browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { height: 1000, width: 420 } });
  const page = await context.newPage();
  await page.goto(`${boardServer.url}/signin`);
  await page.evaluate(async () => {
    await document.fonts.ready.then(() => true);
  });

  const entries = await page.evaluate(() => {
    const h1 = document.querySelector("#signin-heading");

    if (h1 === null) {
      return [];
    }

    const placed: { className: string; depth: number; yBase: number }[] = [];
    let node: Element | null = h1;
    let depth = 0;

    while (node !== null && (node as HTMLElement).tagName !== "BODY") {
      const host = document.createElement("div");
      host.setAttribute(
        "style",
        `position:fixed;left:0px;top:${String(300 + depth * 45)}px;width:390px;height:44px;background:#f3eee4;z-index:9999`,
      );
      const probe = document.createElement("p");
      probe.setAttribute(
        "style",
        "margin:0;position:absolute;left:39px;top:6px;font-family:'Instrument Serif','Newsreader',Georgia,serif;font-size:30px;letter-spacing:-0.36px;white-space:nowrap;color:#151311",
      );
      probe.textContent = "Sign in to Overture";
      host.appendChild(probe);
      node.appendChild(host);
      placed.push({ className: node.className.split(" ").slice(0, 2).join("."), depth, yBase: 300 + depth * 45 });
      depth += 1;
      node = node.parentElement;
    }

    const host = document.createElement("div");
    host.setAttribute(
      "style",
      `position:fixed;left:0px;top:${String(300 + depth * 45)}px;width:390px;height:44px;background:#f3eee4;z-index:9999`,
    );
    const probe = document.createElement("p");
    probe.setAttribute(
      "style",
      "margin:0;position:absolute;left:39px;top:6px;font-family:'Instrument Serif','Newsreader',Georgia,serif;font-size:30px;letter-spacing:-0.36px;white-space:nowrap;color:#151311",
    );
    probe.textContent = "Sign in to Overture";
    host.appendChild(probe);
    document.body.appendChild(host);
    placed.push({ className: "BODY", depth, yBase: 300 + depth * 45 });

    return placed;
  });

  for (const entry of entries) {
    const buffer = await page.screenshot({
      clip: { height: 12, x: 39, y: entry.yBase + 12, width: 16 },
    });
    const values = await page.evaluate(async (data: number[]) => {
      const blob = new Blob([new Uint8Array(data)], { type: "image/png" });
      const bitmap = await globalThis.createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      const frame = context.getImageData(0, 0, canvas.width, canvas.height);

      return Array.from(frame.data);
    }, Array.from(buffer));

    let maxSpread = 0;

    for (let index = 0; index < values.length / 4; index += 1) {
      const red = values[index * 4] ?? 0;
      const blue = values[index * 4 + 2] ?? 0;
      const spread = Math.abs(blue - red);
      if (spread > maxSpread) {
        maxSpread = spread;
      }
    }

    process.stdout.write(`${String(entry.depth)} ${entry.className} lcdSpread=${String(maxSpread)}\n`);
  }

  await context.close();
});
