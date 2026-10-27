import type { FilePreview } from "../api-file-types.js";
import { projectOf } from "../broker/project-path.js";
import { sendJson, type RouteHandler } from "./http.js";
import { badRequest, intQuery, matchRoute, requireSwarmItem, sendError, type ApiDeps } from "./api-util.js";
import { previewProjectFile, readProjectImage } from "./project-files.js";
import { receiveProjectUpload } from "./project-uploads.js";

/** User-only browser previews. No file-reading tool is exposed to worker or Watcher models. */
export function createFileRoutes(deps: ApiDeps): RouteHandler {
  return async (req, res, url) => {
    const upload = req.method === "POST" ? matchRoute("/api/swarms/:swarmId/files/upload", url.pathname) : null;
    if (req.method !== "GET" && !upload) return false;
    const preview = matchRoute("/api/swarms/:swarmId/files/preview", url.pathname);
    const content = matchRoute("/api/swarms/:swarmId/files/content", url.pathname);
    const params = upload ?? preview ?? content;
    if (!params) return false;
    try {
      const swarm = deps.db.read(() => requireSwarmItem(deps, params.id("swarmId")));
      const root = projectOf(deps.db.dataDir);
      if (upload) {
        const uploaded = await receiveProjectUpload(root, url.searchParams.get("name"), req);
        if (!res.destroyed) sendJson(res, 201, { path: uploaded });
        return true;
      }
      const requested = url.searchParams.get("path");
      if (requested === null) throw badRequest("path is required for a project file preview.", "path");
      const version = url.searchParams.get("version") ?? undefined;
      if (preview) {
        const file = await previewProjectFile(root, requested, { offset: intQuery(url, "offset", 0), version });
        const body: FilePreview =
          file.kind === "image"
            ? {
                ...file,
                url: `/api/swarms/${swarm.id}/files/content?path=${encodeURIComponent(file.path)}&version=${encodeURIComponent(file.version)}`,
              }
            : file;
        if (!res.destroyed) sendJson(res, 200, body);
      } else {
        if (version === undefined) throw badRequest("version is required; open preview metadata first.", "version");
        const image = await readProjectImage(root, requested, version);
        if (!res.destroyed) {
          res.writeHead(200, {
            "Content-Type": image.mimeType,
            "Content-Length": image.bytes.length,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Cross-Origin-Resource-Policy": "same-origin",
            "Content-Security-Policy": "sandbox; default-src 'none'",
          });
          res.end(image.bytes);
        }
      }
    } catch (error) {
      if (!res.destroyed) sendError(res, error, deps.onError);
    }
    return true;
  };
}
