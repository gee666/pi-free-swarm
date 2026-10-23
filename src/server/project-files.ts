import { constants } from "node:fs";
import { open, realpath, stat, type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { ImageFilePreview, TextFilePreview } from "../api-file-types.js";
import { ApiFailure, badRequest, notFound } from "./api-util.js";

export const FILE_PREVIEW_TEXT_BYTES = 64 * 1024;
export const FILE_PREVIEW_IMAGE_BYTES = 16 * 1024 * 1024;

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

type ProjectPreview = TextFilePreview | Omit<ImageFilePreview, "url">;
interface OpenedFile {
  handle: FileHandle;
  relative: string;
  size: number;
  version: string;
}

function contained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function versionOf(value: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint }): string {
  return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(":");
}

function changed(): ApiFailure {
  return new ApiFailure(409, "validation", "File changed during preview; reopen it from the first page.", "version");
}

function fileError(error: unknown): never {
  if (error instanceof ApiFailure) throw error;
  if (error instanceof Error && "code" in error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") throw notFound("Referenced project file was not found.");
    if (error.code === "EACCES" || error.code === "EPERM" || error.code === "ELOOP") {
      throw new ApiFailure(403, "validation", "Referenced project file is not readable.", "path");
    }
    if (error.code === "ENAMETOOLONG" || error.code === "ERR_INVALID_ARG_VALUE") {
      throw badRequest("path must be a valid project file reference.", "path");
    }
  }
  throw error;
}

async function withProjectFile<T>(root: string, requested: string, read: (file: OpenedFile) => Promise<T>): Promise<T> {
  if (!requested.trim() || requested.includes("\0") || /^[a-z][a-z\d+.-]*:\/\//i.test(requested)) {
    throw badRequest("path must be a project file path, not a URL.", "path");
  }
  let handle: FileHandle | undefined;
  try {
    const lexicalRoot = path.resolve(root);
    const realRoot = await realpath(lexicalRoot);
    const candidate = path.resolve(lexicalRoot, requested);
    if (!contained(lexicalRoot, candidate) && !contained(realRoot, candidate))
      throw new ApiFailure(403, "validation", "Only project files may be previewed.", "path");
    const target = await realpath(candidate);
    if (!contained(realRoot, target))
      throw new ApiFailure(403, "validation", "File symlink escapes the project.", "path");
    const expected = await stat(target, { bigint: true });
    if (!expected.isFile()) throw badRequest("Only regular files may be previewed.", "path");
    // Nonblocking also prevents a replaced FIFO from blocking the server between stat and open.
    handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const actual = await handle.stat({ bigint: true });
    if (!actual.isFile() || actual.dev !== expected.dev || actual.ino !== expected.ino) throw changed();
    if (actual.size < 0n || actual.size > BigInt(Number.MAX_SAFE_INTEGER))
      throw badRequest("File size is not supported for preview.", "path");
    return await read({
      handle,
      relative: path.relative(realRoot, target).split(path.sep).join("/"),
      size: Number(actual.size),
      version: versionOf(actual),
    });
  } catch (error) {
    return fileError(error);
  } finally {
    await handle?.close();
  }
}

async function unchanged(file: OpenedFile): Promise<void> {
  if (versionOf(await file.handle.stat({ bigint: true })) !== file.version) throw changed();
}

function checkVersion(file: OpenedFile, version: string | undefined): void {
  if (version !== undefined && version !== file.version) throw changed();
}

export async function previewProjectFile(
  root: string,
  requested: string,
  options: { offset?: number; version?: string; textBytes?: number } = {},
): Promise<ProjectPreview> {
  const offset = options.offset ?? 0;
  const limit = options.textBytes ?? FILE_PREVIEW_TEXT_BYTES;
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw badRequest("offset must be a nonnegative byte position.", "offset");
  if (!Number.isSafeInteger(limit) || limit < 4 || limit > FILE_PREVIEW_TEXT_BYTES)
    throw badRequest("Invalid preview page size.");
  return withProjectFile(root, requested, async (file) => {
    checkVersion(file, options.version);
    const mimeType = IMAGE_TYPES[path.extname(file.relative).toLowerCase()];
    if (mimeType) {
      if (offset !== 0) throw badRequest("Image previews do not use text offsets.", "offset");
      if (file.size > FILE_PREVIEW_IMAGE_BYTES)
        throw new ApiFailure(413, "validation", "Image exceeds the 16MiB preview limit; open it externally.", "path");
      return { kind: "image", path: file.relative, mimeType, totalBytes: file.size, version: file.version };
    }
    if (offset > file.size) throw badRequest("offset is beyond the file; reopen its first page.", "offset");
    const buffer = Buffer.alloc(Math.min(limit, file.size - offset));
    const { bytesRead } = await file.handle.read(buffer, 0, buffer.length, offset);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, bytesRead), {
        stream: offset + bytesRead < file.size,
      });
    } catch {
      throw new ApiFailure(
        415,
        "validation",
        "File range is not UTF-8 text; reopen from the first page or view it externally.",
        "offset",
      );
    }
    await unchanged(file);
    const next = offset + Buffer.byteLength(text);
    if (next === offset && next < file.size) throw changed();
    const nextOffset = next < file.size ? next : null;
    return {
      kind: "text",
      path: file.relative,
      mimeType: "text/plain",
      totalBytes: file.size,
      version: file.version,
      text,
      offset,
      nextOffset,
      complete: nextOffset === null,
    };
  });
}

export async function readProjectImage(
  root: string,
  requested: string,
  version: string,
): Promise<{ bytes: Buffer; mimeType: string }> {
  return withProjectFile(root, requested, async (file) => {
    checkVersion(file, version);
    const mimeType = IMAGE_TYPES[path.extname(file.relative).toLowerCase()];
    if (!mimeType)
      throw new ApiFailure(415, "validation", "Only supported raster images have raw preview content.", "path");
    if (file.size > FILE_PREVIEW_IMAGE_BYTES)
      throw new ApiFailure(413, "validation", "Image exceeds the 16MiB preview limit; open it externally.", "path");
    const buffer = Buffer.alloc(file.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) throw changed();
      offset += bytesRead;
    }
    await unchanged(file);
    return { bytes: buffer, mimeType };
  });
}
