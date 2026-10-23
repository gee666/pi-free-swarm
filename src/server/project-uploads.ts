import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, realpath, rm } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import { ApiFailure, badRequest } from "./api-util.js";
import { FILE_PREVIEW_IMAGE_BYTES } from "./project-files.js";

export const FILE_UPLOAD_MAX_BYTES = FILE_PREVIEW_IMAGE_BYTES;
const MAX_FILENAME_BYTES = 255;

function uploadName(raw: string | null): string {
  if (
    raw === null ||
    !raw.trim() ||
    raw === "." ||
    raw === ".." ||
    /[/\\\x00-\x1f\x7f]/u.test(raw) ||
    Buffer.byteLength(raw) > MAX_FILENAME_BYTES
  ) {
    throw badRequest("name must be a filename without paths or control characters.", "name");
  }
  return raw.replace(/[^A-Za-z0-9._-]/gu, "_");
}

async function readUpload(req: IncomingMessage): Promise<Buffer> {
  if (req.headers["content-type"]?.toLowerCase() !== "application/octet-stream")
    throw badRequest("Content-Type must be application/octet-stream.");
  const declared = Number(req.headers["content-length"]);
  const tooLarge = () => new ApiFailure(413, "validation", `File exceeds ${FILE_UPLOAD_MAX_BYTES} bytes.`, "file");
  if (Number.isFinite(declared) && declared > FILE_UPLOAD_MAX_BYTES) throw tooLarge();
  let size = 0;
  const chunks: Buffer[] = [];
  // Keep the socket usable for the 413 response if a chunked request exceeds the bound.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > FILE_UPLOAD_MAX_BYTES) {
      req.resume();
      throw tooLarge();
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size);
}

/** Browser uploads never overwrite project files or trust client-provided paths. */
export async function receiveProjectUpload(root: string, name: string | null, req: IncomingMessage): Promise<string> {
  const filename = uploadName(name);
  const bytes = await readUpload(req);
  const project = await realpath(root);
  const tmp = path.join(project, "tmp");
  try {
    await mkdir(tmp);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  const info = await lstat(tmp);
  if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(tmp)) !== tmp)
    throw new ApiFailure(403, "validation", "Upload tmp directory must be a real project directory.", "path");
  const directory = await mkdtemp(path.join(tmp, "swarm-upload-"));
  try {
    if (path.dirname(await realpath(directory)) !== tmp)
      throw new ApiFailure(403, "validation", "Upload directory escaped project tmp.", "path");
    const target = path.join(directory, filename);
    const handle = await open(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
    return path.relative(project, target).split(path.sep).join("/");
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
