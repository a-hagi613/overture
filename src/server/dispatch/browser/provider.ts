export interface BrowserUsage {
  browserMs: number;
  proxyBytes: number | null;
  costMicros: number;
}

export interface ProviderSessionUsage {
  status: "active" | "stopped";
  usage: BrowserUsage;
}

export type ProviderUnavailableReason = "no_credit" | "forbidden";

export class ProviderUnavailableError extends Error {
  readonly providerId: string;
  readonly reason: ProviderUnavailableReason;

  constructor(providerId: string, reason: ProviderUnavailableReason, message: string) {
    super(message);

    this.name = "ProviderUnavailableError";
    this.providerId = providerId;
    this.reason = reason;
  }
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
  sessionUsage: (sessionId: string) => Promise<ProviderSessionUsage | null>;
  ensureProfile: (userId: string, country: string) => Promise<string>;
  deleteProfile: (providerProfileId: string) => Promise<void>;
  view: (sessionId: string) => Promise<BrowserSessionView | null>;
}

export interface BrowserProviderRegistry {
  ids: () => string[];
  pick: () => BrowserProvider;
  all: () => BrowserProvider[];
}
