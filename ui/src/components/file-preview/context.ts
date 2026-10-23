import { createContext } from "react";

export const FilePreviewContext = createContext<((reference: string) => void) | null>(null);
