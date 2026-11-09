import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/server";

import { loadConfig, type RuntimeConfig } from "../../src/config/env.js";
import { Dependencies } from "../../src/media/dependencies.js";
import { createVideoServer } from "../../src/server/create-server.js";
import type { UnderstandFn } from "../../src/server/register-tools.js";

export interface ConnectedServer {
  client: Client;
  close: () => Promise<void>;
}

export function testConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return { ...loadConfig({}), ...overrides };
}

export async function connectServer(
  config: RuntimeConfig,
  understand: UnderstandFn,
): Promise<ConnectedServer> {
  const server = createVideoServer({
    config,
    dependencies: new Dependencies(config),
    understand,
    version: "0.0.0-test",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "video-understanding-mcp-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export function resultText(result: CallToolResult): string {
  return result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}
