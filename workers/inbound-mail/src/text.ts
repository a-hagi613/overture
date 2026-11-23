const encoder = new TextEncoder();

export function byteLength(value: string) {
  return encoder.encode(value).byteLength;
}

export function truncateBytes(value: string, maximum: number) {
  if (byteLength(value) <= maximum) {
    return value;
  }

  let low = 0;
  let high = value.length;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);

    if (byteLength(value.slice(0, middle)) <= maximum) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return value.slice(0, low);
}
