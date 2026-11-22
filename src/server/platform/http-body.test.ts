import { describe, expect, test } from "bun:test";

import { readBodyCapped } from "./http-body.ts";

function bytes(text: string) {
  return new TextEncoder().encode(text);
}

function requestWith(body: BodyInit | null) {
  return new Request("https://overture.test/webhook", { body, method: "POST" });
}

describe("readBodyCapped", () => {
  test("returns the exact bytes of a body under the cap", async () => {
    expect(await readBodyCapped(requestWith(new Blob([bytes("hello")])), 10)).toEqual(
      bytes("hello"),
    );
  });

  test("returns the exact bytes of a body exactly at the cap", async () => {
    expect(await readBodyCapped(requestWith(new Blob([bytes("0123456789")])), 10)).toEqual(
      bytes("0123456789"),
    );
  });

  test("reads an empty body as empty bytes", async () => {
    expect(await readBodyCapped(requestWith(null), 10)).toEqual(new Uint8Array(0));
  });

  test("stops reading as soon as the cap is passed instead of buffering the rest", async () => {
    let pulls = 0;

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;

        if (pulls > 3) {
          throw new Error("readBodyCapped kept reading past the cap");
        }

        controller.enqueue(bytes("0123456789"));
      },
    });

    expect(await readBodyCapped(requestWith(stream), 10)).toBeNull();
    expect(pulls).toBeLessThan(4);
  });
});
