export interface BrowserUsage {
  browserMs: number;
  proxyBytes: number;
  costMicros: number;
}

export interface RemoteBrowser {
  cdpUrl: string;
  sessionId: string;
  liveViewUrl: string | null;
  close: () => Promise<BrowserUsage>;
}

export interface OpenBrowserInput {
  profileId: string | null;
  country: string;
  timeoutMinutes: number;
  attemptId: string;
}

export interface OpenSession {
  sessionId: string;
  attemptId: string | null;
}

export interface BrowserProvider {
  id: "browser_use" | "kernel" | "local";
  open: (input: OpenBrowserInput) => Promise<RemoteBrowser>;
  listOpen: () => Promise<OpenSession[]>;
  stop: (sessionId: string) => Promise<void>;
}
