// A Nostr relay stub on this machine, for the channel's tests and its drive
// (.claude/skills/verify/features/nostr.md). It speaks just enough NIP-01 over a hand-written
// RFC 6455 WebSocket: EVENT is answered with OK and kept, REQ by ids or kinds is answered with what
// it keeps and EOSE. `refuse` answers OK false; `forget` takes events but never serves them back,
// like a relay that dropped them. It checks nothing; `checkStubEvent` checks an event the way any
// Nostr client would, with node's sha256 and noble's schnorr, not with the code under test.
//
//   node brain/test/relay.ts <port> [log.jsonl]          run one until killed, logging each EVENT
//   node brain/test/relay.ts check <log.jsonl> <pubkey>  check every logged event; exit 1 on any fault
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { fileURLToPath } from "node:url";
import { schnorr } from "@noble/curves/secp256k1.js";

export interface StubEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface Relay {
  url: string;
  /** Every EVENT frame it was sent, in order, refused or not. */
  received: StubEvent[];
  /** What it holds and serves back. */
  held: Map<string, StubEvent>;
  mode: { refuse: boolean; forget: boolean };
  close(): Promise<void>;
}

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function frame(text: string, opcode = 1): Buffer {
  const body = Buffer.from(text);
  const n = body.length;
  const head =
    n < 126
      ? Buffer.from([0x80 | opcode, n])
      : n < 65536
        ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255])
        : Buffer.concat([Buffer.from([0x80 | opcode, 127]), u64(n)]);
  return Buffer.concat([head, body]);
}

function u64(n: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
}

/** Client frames, unmasked; whatever is left over waits for the next chunk. */
function* frames(buf: { data: Buffer }): Generator<{ opcode: number; payload: Buffer }> {
  for (;;) {
    const d = buf.data;
    if (d.length < 2) return;
    const opcode = (d[0] as number) & 15;
    const masked = ((d[1] as number) & 128) !== 0;
    let len = (d[1] as number) & 127;
    let at = 2;
    if (len === 126) {
      if (d.length < 4) return;
      len = d.readUInt16BE(2);
      at = 4;
    } else if (len === 127) {
      if (d.length < 10) return;
      len = Number(d.readBigUInt64BE(2));
      at = 10;
    }
    const mask = masked ? d.subarray(at, at + 4) : null;
    if (masked) at += 4;
    if (d.length < at + len) return;
    const payload = Buffer.from(d.subarray(at, at + len));
    if (mask)
      for (let i = 0; i < payload.length; i++)
        payload[i] = (payload[i] as number) ^ (mask[i % 4] as number);
    buf.data = d.subarray(at + len);
    yield { opcode, payload };
  }
}

const matches = (e: StubEvent, f: { ids?: string[]; kinds?: number[]; authors?: string[] }) =>
  (!f.ids || f.ids.includes(e.id)) &&
  (!f.kinds || f.kinds.includes(e.kind)) &&
  (!f.authors || f.authors.includes(e.pubkey));

export function startRelay(
  opts: { port?: number; log?: string; refuse?: boolean; forget?: boolean } = {},
): Promise<Relay> {
  const received: StubEvent[] = [];
  const held = new Map<string, StubEvent>();
  const mode = { refuse: !!opts.refuse, forget: !!opts.forget };
  const sockets = new Set<Socket>();
  const server: Server = createServer((_, res) => {
    res.writeHead(426, { "Content-Type": "text/plain" });
    res.end("a Nostr relay stub: connect with a WebSocket\n");
  });
  server.on("upgrade", (req, socket: Socket) => {
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string") return socket.destroy();
    const accept = createHash("sha1")
      .update(key + GUID)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    const buf = { data: Buffer.alloc(0) };
    const send = (msg: unknown) => socket.writable && socket.write(frame(JSON.stringify(msg)));
    socket.on("data", (chunk: Buffer) => {
      buf.data = Buffer.concat([buf.data, chunk]);
      for (const f of frames(buf)) {
        if (f.opcode === 8) {
          socket.end(frame("", 8));
          return;
        }
        if (f.opcode === 9) {
          socket.write(Buffer.concat([Buffer.from([0x8a, f.payload.length]), f.payload]));
          continue;
        }
        if (f.opcode !== 1) continue;
        let msg: unknown;
        try {
          msg = JSON.parse(f.payload.toString("utf8"));
        } catch {
          send(["NOTICE", "not JSON"]);
          continue;
        }
        if (!Array.isArray(msg)) continue;
        if (msg[0] === "EVENT") {
          const e = msg[1] as StubEvent;
          received.push(e);
          if (opts.log) appendFileSync(opts.log, `${JSON.stringify(e)}\n`);
          if (mode.refuse) send(["OK", e.id, false, "blocked: this stub refuses"]);
          else {
            if (!mode.forget) held.set(e.id, e);
            send(["OK", e.id, true, ""]);
          }
        } else if (msg[0] === "REQ") {
          const [, sub, ...filters] = msg as [string, string, ...object[]];
          for (const e of held.values())
            if (filters.some((x) => matches(e, x))) send(["EVENT", sub, e]);
          send(["EOSE", sub]);
        }
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `ws://127.0.0.1:${port}`,
        received,
        held,
        mode,
        close: () =>
          new Promise((done) => {
            for (const s of sockets) s.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

/** NIP-01: the id is sha256 of the serialized event, the signature a BIP-340 schnorr over it. */
export function checkStubEvent(e: StubEvent, pubkey: string): string[] {
  const out: string[] = [];
  const serial = JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]);
  if (e.id !== createHash("sha256").update(serial, "utf8").digest("hex")) out.push("id");
  try {
    const hex = (h: string) => Buffer.from(h, "hex");
    if (!schnorr.verify(hex(e.sig), hex(e.id), hex(e.pubkey))) out.push("signature");
  } catch {
    out.push("signature");
  }
  if (e.pubkey !== pubkey) out.push("pubkey");
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "check") {
    const [file, pubkey] = process.argv.slice(3);
    if (!file || !/^[0-9a-f]{64}$/.test(pubkey ?? "")) {
      console.error("usage: node brain/test/relay.ts check <log.jsonl> <hex pubkey>");
      process.exit(2);
    }
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    let bad = 0;
    for (const line of lines) {
      const e = JSON.parse(line) as StubEvent;
      const faults = checkStubEvent(e, pubkey as string);
      if (faults.length) bad++;
      const d = e.tags.find((t) => t[0] === "d")?.[1];
      console.log(
        `${faults.length ? `FAIL ${faults.join(",")}` : "ok  "} kind ${e.kind} ${e.id}${d ? ` d=${d}` : ""} ${e.content.length} chars`,
      );
    }
    console.log(`${lines.length} event(s), ${bad} with a fault`);
    process.exit(bad || !lines.length ? 1 : 0);
  }
  const port = Number(process.argv[2]);
  if (!Number.isInteger(port) || port <= 0) {
    console.error("usage: node brain/test/relay.ts <port> [log.jsonl]");
    process.exit(2);
  }
  const r = await startRelay({ port, log: process.argv[3] });
  console.log(`relay stub on ${r.url}${process.argv[3] ? `, logging to ${process.argv[3]}` : ""}`);
}
