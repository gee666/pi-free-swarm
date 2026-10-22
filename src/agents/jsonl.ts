import { StringDecoder } from "node:string_decoder";

// The largest checked-in RPC fixtures are below 1 MiB; leave room for full tool results.
export const DEFAULT_MAX_RPC_FRAME_BYTES = 16 * 1024 * 1024;

export class RpcFrameOverflowError extends Error {
  readonly code = "RPC_FRAME_OVERFLOW";
  constructor(readonly maxBytes: number) {
    super(`RPC record exceeds maxRpcFrameBytes (${maxBytes} bytes). Increase the limit for legitimate large records.`);
    this.name = "RpcFrameOverflowError";
  }
}

/** Newlines delimit records; Unicode line separators inside JSON strings do not. */
export function createJsonlSplitter(
  onLine: (line: string) => void,
  maxBytes = DEFAULT_MAX_RPC_FRAME_BYTES,
): { push(chunk: Buffer): void; end(): void; readonly bufferedBytes: number } {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new Error("maxRpcFrameBytes must be a positive safe integer.");
  let decoder = new StringDecoder("utf8");
  let parts: string[] = [];
  let bytes = 0;
  let failed = false;
  const append = (part: Buffer) => {
    if (bytes + part.length > maxBytes) {
      failed = true;
      parts = [];
      bytes = 0;
      decoder = new StringDecoder("utf8");
      throw new RpcFrameOverflowError(maxBytes);
    }
    bytes += part.length;
    parts.push(decoder.write(part));
  };
  const emit = () => {
    const text = parts.join("") + decoder.end();
    parts = [];
    bytes = 0;
    decoder = new StringDecoder("utf8");
    const line = text.endsWith("\r") ? text.slice(0, -1) : text;
    if (line.length > 0) onLine(line);
  };
  return {
    get bufferedBytes() {
      return bytes;
    },
    push(chunk) {
      if (failed) return;
      let start = 0;
      for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, start)) {
        append(chunk.subarray(start, end));
        emit();
        start = end + 1;
      }
      if (start < chunk.length) append(chunk.subarray(start));
    },
    end() {
      if (!failed) emit();
    },
  };
}
