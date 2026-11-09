import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface ScriptedResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: string | object;
  delayMs?: number;
  /** Close the socket without answering. */
  destroy?: boolean;
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  json: unknown;
}

export type Responder = (request: RecordedRequest) => ScriptedResponse;

export interface FakeEndpoint {
  baseUrl: string;
  requests: RecordedRequest[];
  /** Responses for POST /chat/completions, consumed in order; the last one repeats. */
  chat: ScriptedResponse[];
  /** Overrides the queue when set. */
  responder: Responder | undefined;
  models: ScriptedResponse;
  close: () => Promise<void>;
}

export function chatBody(content: string, extra: Record<string, unknown> = {}): object {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    model: "fake-model",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3433, completion_tokens: 120, total_tokens: 3553 },
    ...extra,
  };
}

export async function startFakeEndpoint(): Promise<FakeEndpoint> {
  const endpoint: Omit<FakeEndpoint, "baseUrl" | "close"> = {
    requests: [],
    chat: [{ body: chatBody("ok") }],
    responder: undefined,
    models: { status: 200, body: { object: "list", data: [] } },
  };

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let json: unknown = null;
      try {
        json = raw ? (JSON.parse(raw) as unknown) : null;
      } catch {
        json = raw;
      }
      const recorded: RecordedRequest = {
        method: request.method ?? "",
        path: request.url ?? "",
        headers: request.headers,
        json,
      };
      endpoint.requests.push(recorded);

      let scripted: ScriptedResponse;
      if (recorded.path.endsWith("/models")) scripted = endpoint.models;
      else if (endpoint.responder) scripted = endpoint.responder(recorded);
      else scripted = (endpoint.chat.length > 1 ? endpoint.chat.shift() : endpoint.chat[0]) ?? {};

      const send = () => {
        if (scripted.destroy) {
          request.socket.destroy();
          return;
        }
        const body =
          typeof scripted.body === "string" ? scripted.body : JSON.stringify(scripted.body ?? {});
        response.writeHead(scripted.status ?? 200, {
          "content-type": "application/json",
          ...scripted.headers,
        });
        response.end(body);
      };
      if (scripted.delayMs) setTimeout(send, scripted.delayMs);
      else send();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return Object.assign(endpoint, {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  });
}
