export interface CloudflareEmailRequestRecord {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

const recorded: CloudflareEmailRequestRecord[] = [];

export function recordCloudflareEmailRequest(record: CloudflareEmailRequestRecord) {
  recorded.push(record);
}

export function listCloudflareEmailRequests() {
  const requests: CloudflareEmailRequestRecord[] = [...recorded];

  return requests;
}

export function clearCloudflareEmailRequests() {
  recorded.length = 0;
}
