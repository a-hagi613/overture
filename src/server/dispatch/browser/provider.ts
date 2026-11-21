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

export interface BrowserSessionView {
  liveViewUrl: string | null;
  recordingUrl: string | null;
  status: "active" | "stopped";
}

export interface BrowserProvider {
  id: "browser_use" | "kernel" | "local";
  open: (input: OpenBrowserInput) => Promise<RemoteBrowser>;
  listOpen: () => Promise<OpenSession[]>;
  stop: (sessionId: string) => Promise<void>;
  ensureProfile: (userId: string, country: string) => Promise<string>;
  deleteProfile: (providerProfileId: string) => Promise<void>;
  view: (sessionId: string) => Promise<BrowserSessionView | null>;
}

export interface BrowserProviderRegistry {
  ids: () => string[];
  pick: () => BrowserProvider;
  all: () => BrowserProvider[];
}
