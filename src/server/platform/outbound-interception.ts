import nodeHttp from "node:http";
import nodeHttps from "node:https";
import { Readable, Writable } from "node:stream";

import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";

class Passthrough {
  readonly kind = "passthrough";
}

const passthroughResult = new Passthrough();

const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export class UnhandledRequestError extends Error {
  readonly host: string;
  readonly url: string;

  constructor(url: string, method: string) {
    const host = new URL(url).hostname;

    super(
      `Refusing a ${method} request to unmocked host ${host}: tests may reach only a host an interceptor handler mocks or a loopback fixture (${url}).`,
    );

    this.name = "UnhandledRequestError";
    this.host = host;
    this.url = url;
  }
}

export type PassedThrough = Passthrough;

export interface InterceptionContext {
  request: Request;
  params: Record<string, string>;
}

export type InterceptionResult = Response | PassedThrough;

type Resolver = (context: InterceptionContext) => InterceptionResult | Promise<InterceptionResult>;

type Matcher = (request: Request) => Record<string, string> | null;

type Pattern = string | RegExp | ((context: InterceptionContext) => boolean);

export interface InterceptionHandler {
  method: string;
  match: Matcher;
  resolve: Resolver;
}

export interface InterceptionServer {
  listen: () => void;
  close: () => void;
}

type JsonBody = Parameters<typeof JSON.stringify>[0];

type NodeResponseCallback = (response: IncomingMessage) => void;

type NodeRequestArgs =
  | [input: string | URL, options?: RequestOptions, callback?: NodeResponseCallback]
  | [options: RequestOptions, callback?: NodeResponseCallback];

export function passthrough() {
  return passthroughResult;
}

function matchedParams() {
  return {};
}

function stringMatcher(template: string) {
  const target = new URL(template);
  const expectedSegments = target.pathname.split("/");

  function match(request: Request) {
    const url = new URL(request.url);

    if (url.protocol !== target.protocol || url.host !== target.host) {
      return null;
    }

    const actualSegments = url.pathname.split("/");

    if (actualSegments.length !== expectedSegments.length) {
      return null;
    }

    const params: Record<string, string> = {};

    for (let index = 0; index < expectedSegments.length; index += 1) {
      const expected = expectedSegments[index] ?? "";
      const actual = actualSegments[index] ?? "";

      if (expected.startsWith(":")) {
        params[expected.slice(1)] = decodeURIComponent(actual);
        continue;
      }

      if (expected !== actual) {
        return null;
      }
    }

    return params;
  }

  return match;
}

function regexMatcher(regex: RegExp) {
  return function matchRegex(request: Request) {
    return regex.test(request.url) ? matchedParams() : null;
  };
}

function predicateMatcher(predicate: (context: InterceptionContext) => boolean) {
  return function matchPattern(request: Request) {
    return predicate({ request, params: matchedParams() }) ? matchedParams() : null;
  };
}

function matcherFor(pattern: Pattern) {
  if (pattern instanceof RegExp) {
    return regexMatcher(pattern);
  }

  if (isPatternFunction(pattern)) {
    return predicateMatcher(pattern);
  }

  return stringMatcher(pattern);
}

function createHandler(method: string, pattern: Pattern, resolve: Resolver) {
  return { method, match: matcherFor(pattern), resolve };
}

export const http = {
  get: (pattern: Pattern, resolve: Resolver) => createHandler("GET", pattern, resolve),
  post: (pattern: Pattern, resolve: Resolver) => createHandler("POST", pattern, resolve),
  put: (pattern: Pattern, resolve: Resolver) => createHandler("PUT", pattern, resolve),
  patch: (pattern: Pattern, resolve: Resolver) => createHandler("PATCH", pattern, resolve),
  delete: (pattern: Pattern, resolve: Resolver) => createHandler("DELETE", pattern, resolve),
  all: (pattern: Pattern, resolve: Resolver) => createHandler("ALL", pattern, resolve),
};

export class HttpResponse extends Response {
  static json(body: JsonBody, init?: ResponseInit) {
    const headers = new Headers(init?.headers);

    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    return new HttpResponse(JSON.stringify(body), { ...init, headers });
  }

  static text(body: string, init?: ResponseInit) {
    const headers = new Headers(init?.headers);

    if (!headers.has("content-type")) {
      headers.set("content-type", "text/plain;charset=UTF-8");
    }

    return new HttpResponse(body, { ...init, headers });
  }
}

const activeHandlers: InterceptionHandler[] = [];

let restoreInterception: (() => void) | null = null;

async function dispatch(request: Request) {
  for (const handler of activeHandlers) {
    if (handler.method !== "ALL" && handler.method !== request.method) {
      continue;
    }

    const params = handler.match(request);

    if (params === null) {
      continue;
    }

    return handler.resolve({ request, params });
  }

  throw new UnhandledRequestError(request.url, request.method);
}

export function createInterceptionServer(...handlers: InterceptionHandler[]) {
  let listening = false;

  return {
    listen: () => {
      if (listening) {
        throw new Error("This interception server is already listening.");
      }

      listening = true;
      activeHandlers.push(...handlers);
      restoreInterception ??= installInterceptors();
    },
    close: () => {
      if (!listening) {
        return;
      }

      listening = false;

      for (const handler of handlers) {
        const index = activeHandlers.indexOf(handler);

        if (index !== -1) {
          activeHandlers.splice(index, 1);
        }
      }

      if (activeHandlers.length === 0 && restoreInterception !== null) {
        restoreInterception();
        restoreInterception = null;
      }
    },
  } satisfies InterceptionServer;
}

function installInterceptors() {
  const restoreFetch = installFetchInterceptor();
  const restoreNode = installNodeInterceptors();

  return () => {
    restoreNode();
    restoreFetch();
  };
}

function installFetchInterceptor() {
  const original = globalThis.fetch;

  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);

      if (loopbackHosts.has(new URL(request.url).hostname)) {
        return original(input, init);
      }

      const result = await dispatch(request);

      return result instanceof Passthrough ? original(input, init) : result;
    },
    { preconnect: original.preconnect.bind(original) },
  );

  return () => {
    globalThis.fetch = original;
  };
}

function installNodeInterceptors() {
  const httpRequest = nodeHttp.request;
  const httpGet = nodeHttp.get;
  const httpsRequest = nodeHttps.request;
  const httpsGet = nodeHttps.get;

  Object.assign(nodeHttp, {
    request: interceptedNodeRequest("http:", httpRequest, false),
    get: interceptedNodeRequest("http:", httpGet, true),
  });
  Object.assign(nodeHttps, {
    request: interceptedNodeRequest("https:", httpsRequest, false),
    get: interceptedNodeRequest("https:", httpsGet, true),
  });

  return () => {
    Object.assign(nodeHttp, { request: httpRequest, get: httpGet });
    Object.assign(nodeHttps, { request: httpsRequest, get: httpsGet });
  };
}

function interceptedNodeRequest(
  protocol: string,
  original: typeof nodeHttp.request,
  autoEnd: boolean,
) {
  return (...args: NodeRequestArgs) => {
    const url = nodeRequestUrl(args[0], args[1], protocol);

    if (loopbackHosts.has(url.hostname)) {
      return forwardRequest(original, args);
    }

    const request = startNodeRequest(() => forwardRequest(original, args), args, url);

    if (autoEnd) {
      request.end();
    }

    return request;
  };
}

function forwardRequest(original: typeof nodeHttp.request, args: NodeRequestArgs) {
  const [first, second, third] = args;

  if (isRequestOptions(first)) {
    return isNodeCallback(second) ? original(first, second) : original(first);
  }

  if (isRequestOptions(second)) {
    return isNodeCallback(third) ? original(first, second, third) : original(first, second);
  }

  return isNodeCallback(second) ? original(first, second) : original(first);
}

const callableTags = new Set([
  "[object Function]",
  "[object AsyncFunction]",
  "[object GeneratorFunction]",
  "[object AsyncGeneratorFunction]",
]);

function isPatternFunction(value: Pattern): value is (context: InterceptionContext) => boolean {
  return callableTags.has(Object.prototype.toString.call(value));
}

function isNodeCallback(
  value: NodeRequestArgs[0] | NodeRequestArgs[1] | NodeRequestArgs[2] | undefined,
): value is NodeResponseCallback {
  return callableTags.has(Object.prototype.toString.call(value));
}

function isRequestOptions(
  value: NodeRequestArgs[0] | NodeRequestArgs[1] | undefined,
): value is RequestOptions {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function nodeRequestUrl(
  first: NodeRequestArgs[0] | undefined,
  second: NodeRequestArgs[1] | undefined,
  protocol: string,
) {
  if (first instanceof URL) {
    return new URL(first.href);
  }

  if (isRequestOptions(first)) {
    return urlFromOptions(first, protocol);
  }

  if (first !== undefined) {
    return new URL(first, `${protocol}//localhost`);
  }

  return urlFromOptions(isRequestOptions(second) ? second : undefined, protocol);
}

function urlFromOptions(options: RequestOptions | undefined, protocol: string) {
  const protocolValue = options?.protocol ?? protocol;
  const path = options?.path ?? "/";
  const rawHost = options?.host ?? options?.hostname ?? "localhost";
  const host = rawHost.includes(":") && !rawHost.startsWith("[") ? `[${rawHost}]` : rawHost;

  const withPort =
    options?.port === undefined || host.includes(":") ? host : `${host}:${String(options.port)}`;

  return new URL(`${protocolValue}//${withPort}${path}`);
}

function headersFromOptions(headers: RequestOptions["headers"]) {
  const result = new Headers();

  if (headers === undefined) {
    return result;
  }

  if (isHeaderList(headers)) {
    for (let index = 0; index + 1 < headers.length; index += 2) {
      result.set(headers[index] ?? "", headers[index + 1] ?? "");
    }

    return result;
  }

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const part of value) {
        result.append(name, part);
      }

      continue;
    }

    result.set(name, String(value));
  }

  return result;
}

function isHeaderList(headers: RequestOptions["headers"]): headers is readonly string[] {
  return Array.isArray(headers);
}

function isStringList(value: string | number | readonly string[]): value is readonly string[] {
  return Array.isArray(value);
}

function idleSocket() {
  return {
    connecting: false,
    setTimeout: (_timeout: number, _done?: () => void) => undefined,
    setKeepAlive: (_enable?: boolean, _initialDelay?: number) => undefined,
    destroy: (_error?: Error) => undefined,
    on: (_event: string, _listener: () => void) => undefined,
    once: (_event: string, _listener: () => void) => undefined,
    removeListener: (_event: string, _listener: () => void) => undefined,
  };
}

class InterceptedIncomingMessage extends Readable {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  rawHeaders: string[];
  httpVersion = "1.1";
  complete = false;

  constructor(status: number, statusMessage: string, body: Uint8Array, headers: Headers) {
    super();
    this.statusCode = status;
    this.statusMessage = statusMessage;
    this.headers = Object.fromEntries(headers.entries());
    this.rawHeaders = [...headers.entries()].flat();
    this.push(body);
    this.push(null);
    this.once("end", () => {
      this.complete = true;
    });
  }
}

class InterceptedNodeRequest extends Writable {
  readonly method: string;
  readonly path: string;
  readonly protocol: string;
  readonly host: string;
  readonly socket = idleSocket();

  private readonly url: URL;
  private readonly headers: Headers;
  private readonly forward: () => ClientRequest;
  private readonly chunks: Uint8Array[] = [];

  constructor(
    forward: () => ClientRequest,
    url: URL,
    headers: Headers,
    options: RequestOptions | undefined,
    done: NodeResponseCallback | undefined,
  ) {
    super();
    this.forward = forward;
    this.url = url;
    this.headers = headers;
    this.method = options?.method ?? "GET";
    this.path = `${url.pathname}${url.search}`;
    this.protocol = url.protocol;
    this.host = url.host;

    if (done !== undefined) {
      this.once("response", done);
    }
  }

  override _write(
    chunk: Uint8Array,
    _encoding: BufferEncoding,
    done: (error?: Error | null) => void,
  ) {
    this.chunks.push(chunk);
    done();
  }

  override _final(done: (error?: Error | null) => void) {
    void this.flush();
    done();
  }

  setHeader(name: string, value: string | number | readonly string[]) {
    if (isStringList(value)) {
      for (const part of value) {
        this.headers.append(name, part);
      }

      return this;
    }

    this.headers.set(name, String(value));

    return this;
  }

  getHeader(name: string) {
    return this.headers.get(name) ?? undefined;
  }

  hasHeader(name: string) {
    return this.headers.has(name);
  }

  removeHeader(name: string) {
    this.headers.delete(name);
  }

  getHeaders() {
    return Object.fromEntries(this.headers.entries());
  }

  setTimeout(_timeout: number, _done?: () => void) {
    return this;
  }

  setNoDelay(_noDelay?: boolean) {
    return this;
  }

  setSocketKeepAlive(_enable?: boolean, _initialDelay?: number) {
    return this;
  }

  abort() {
    this.destroy();
  }

  private async flush() {
    const body = this.chunks.length === 0 ? undefined : Buffer.concat(this.chunks);
    const requestInit: RequestInit = { method: this.method, headers: this.headers };

    if (body !== undefined && this.method !== "GET" && this.method !== "HEAD") {
      requestInit.body = body;
    }

    let result: InterceptionResult;

    try {
      result = await dispatch(new Request(this.url, requestInit));
    } catch (error) {
      queueMicrotask(() => {
        this.emit("error", error);
      });

      return;
    }

    if (result instanceof Passthrough) {
      this.passThrough();

      return;
    }

    const bytes = new Uint8Array(await result.arrayBuffer());

    const message = new InterceptedIncomingMessage(
      result.status,
      result.statusText,
      bytes,
      result.headers,
    );

    queueMicrotask(() => {
      this.emit("response", message);
      message.once("end", () => {
        this.emit("close");
      });
    });
  }

  private passThrough() {
    const real = this.forward();

    real.on("response", (response) => {
      this.emit("response", response);
    });
    real.on("error", (error) => {
      this.emit("error", error);
    });
    real.on("close", () => {
      this.emit("close");
    });

    for (const chunk of this.chunks) {
      real.write(chunk);
    }

    real.end();
  }
}

function optionsAt(value: NodeRequestArgs[1] | undefined) {
  return isRequestOptions(value) ? value : undefined;
}

function callbackAt(value: NodeRequestArgs[1] | NodeRequestArgs[2] | undefined) {
  return isNodeCallback(value) ? value : undefined;
}

function startNodeRequest(forward: () => ClientRequest, args: NodeRequestArgs, url: URL) {
  const options = isRequestOptions(args[0]) ? args[0] : optionsAt(args[1]);
  const done = callbackAt(args[1]) ?? callbackAt(args[2]);

  return new InterceptedNodeRequest(
    forward,
    url,
    headersFromOptions(options?.headers),
    options,
    done,
  );
}
