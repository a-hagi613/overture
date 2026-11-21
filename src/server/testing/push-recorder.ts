export interface RecordedPushRequest {
  body: string;
  headers: Record<string, string>;
  method: string;
  url: string;
}

const requests: RecordedPushRequest[] = [];

export function recordPushRequest(request: RecordedPushRequest) {
  requests.push(request);
}

export function listPushRequests() {
  return [...requests];
}

export function clearPushRequests() {
  requests.length = 0;
}

export function pushResponseStatus(url: string) {
  const { pathname } = new URL(url);

  if (pathname.endsWith("/gone")) {
    return 410;
  }

  if (pathname.endsWith("/fail")) {
    return 500;
  }

  return 201;
}
