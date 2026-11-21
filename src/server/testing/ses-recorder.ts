export interface SesRequestRecord {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

const recorded: SesRequestRecord[] = [];

export function recordSesRequest(record: SesRequestRecord) {
  recorded.push(record);
}

export function listSesRequests() {
  const requests: SesRequestRecord[] = [...recorded];

  return requests;
}

export function clearSesRequests() {
  recorded.length = 0;
}
