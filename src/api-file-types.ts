interface FilePreviewBase {
  /** Canonical project-relative path, with forward slashes for browser links. */
  path: string;
  totalBytes: number;
  version: string;
}

export interface TextFilePreview extends FilePreviewBase {
  kind: "text";
  mimeType: "text/plain";
  text: string;
  offset: number;
  nextOffset: number | null;
  complete: boolean;
}

export interface ImageFilePreview extends FilePreviewBase {
  kind: "image";
  mimeType: string;
  url: string;
}

export type FilePreview = TextFilePreview | ImageFilePreview;
