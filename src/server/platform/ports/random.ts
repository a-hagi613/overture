export interface Random {
  next: () => number;
}

export function createRandom() {
  return { next: () => Math.random() } satisfies Random;
}
