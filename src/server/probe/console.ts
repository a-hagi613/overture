import { createInterface } from "node:readline/promises";

import type { Interface as ReadLineInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

/**
 * The console the probe talks to the owner on: prompts on the console and reads what the owner types.
 */
export interface ProbeConsole {
  readLine: () => Promise<string>;
  writeLine: (message: string) => void;
  close: () => void;
}

export function createStreamConsole(input: Readable, output: Writable) {
  const reader: ReadLineInterface = createInterface({ input, output, terminal: false });

  return {
    readLine: async () => reader.question(""),
    writeLine: (message: string) => {
      output.write(`${message}\n`);
    },
    close: () => {
      reader.close();
    },
  };
}
