import type { FilePreview } from "../api-file-types.js";
import { projectOf } from "../broker/body-limit.js";
import { sendJson, type RouteHandler } from "./http.js";
import { badRequest, intQuery, matchRoute, requireSwarmItem, sendError, type ApiDeps } from "./api-util.js";
import { previewProjectFile, readProjectImage } from "./project-files.js";

/** User-only browser previews. No file-reading tool is exposed to worker or Watcher models. */
export function createFileRoutes(deps: ApiDeps): RouteHandler {
  return async (req, res, url) => {
    if (req.method !== "GET") return false;
    const preview = matchRoute("/api/swarms/:swarmId/files/preview", url.pathname);
    const content = matchRoute("/api/swarms/:swarmId/files/content", url.pathname);
    const params = preview ?? content;
    if (!params) return false;
    try {
      const swarm = requireSwarmItem(deps, params.id("swarmId"));
      const requested = url.searchParams.get("path");
      if (requested === null) throw badRequest("path is required for a project file preview.", "path");
      const version = url.searchParams.get("version") ?? undefined;
      const root = projectOf(deps.db.dataDir);
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
