import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";

import { Agent } from "undici";

import { VideoError } from "../errors/video-error.js";

export type Resolver = (hostname: string) => Promise<LookupAddress[]>;

const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED.addSubnet(network, prefix, "ipv6");
}

const MAPPED_IPV4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const MAPPED_IPV4_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;

function unwrapMapped(address: string): string {
  const dotted = MAPPED_IPV4.exec(address);
  if (dotted?.[1]) return dotted[1];
  const hex = MAPPED_IPV4_HEX.exec(address);
  if (hex?.[1] && hex[2]) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join(".");
  }
  return address;
}

/** True for loopback, private, link-local, CGNAT, multicast, reserved, and unspecified addresses. */
export function isBlockedAddress(rawAddress: string): boolean {
  const address = unwrapMapped(rawAddress.replace(/^\[|\]$/g, ""));
  const family = isIP(address);
  if (family === 4) return BLOCKED.check(address, "ipv4");
  if (family === 6) return BLOCKED.check(address, "ipv6");
  return false;
}

export function notAllowed(target: string): VideoError {
  return new VideoError({
    code: "SOURCE_NOT_ALLOWED",
    safeMessage: `Refusing to fetch ${target}: it resolves to a private, loopback, or otherwise non-public address`,
  });
}

/** Validates scheme and IP-literal hosts, which never pass through DNS lookup. */
export function assertUrlAllowed(url: URL, allowPrivateNetwork: boolean): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new VideoError({
      code: "SOURCE_NOT_ALLOWED",
      safeMessage: `Only http and https URLs are supported, got ${url.protocol}`,
    });
  }
  if (!allowPrivateNetwork && isBlockedAddress(url.hostname)) throw notAllowed(url.host);
}

export class BlockedAddressError extends Error {
  readonly code = "EBLOCKED";

  constructor(readonly hostname: string) {
    super(`Blocked non-public address for ${hostname}`);
    this.name = "BlockedAddressError";
  }
}

const systemResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses);
    });
  });

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** An undici dispatcher whose DNS step refuses non-public addresses before connecting. */
export function createGuardedAgent(options: {
  allowPrivateNetwork: boolean;
  resolver?: Resolver;
}): Agent {
  const resolver = options.resolver ?? systemResolver;
  const lookup = (hostname: string, lookupOptions: { all?: boolean }, callback: LookupCallback) => {
    resolver(hostname).then(
      (addresses) => {
        if (addresses.length === 0) {
          callback(
            Object.assign(new Error(`No address for ${hostname}`), { code: "ENOTFOUND" }),
            [],
          );
          return;
        }
        if (
          !options.allowPrivateNetwork &&
          addresses.some((entry) => isBlockedAddress(entry.address))
        ) {
          callback(new BlockedAddressError(hostname), []);
          return;
        }
        const first = addresses[0];
        if (lookupOptions.all || !first) callback(null, addresses);
        else callback(null, first.address, first.family);
      },
      (error: NodeJS.ErrnoException) => callback(error, []),
    );
  };
  return new Agent({ connect: { lookup } as Record<string, unknown> });
}

/** Finds a BlockedAddressError anywhere in an error's cause chain. */
export function findBlocked(error: unknown): BlockedAddressError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (current instanceof BlockedAddressError) return current;
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      current.code === "EBLOCKED"
    ) {
      return current as BlockedAddressError;
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? current.cause
        : undefined;
  }
  return undefined;
}
