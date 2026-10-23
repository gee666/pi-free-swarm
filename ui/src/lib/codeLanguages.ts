const aliases: Readonly<Record<string, string>> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  javascript: "javascript",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  json: "json",
  jsonc: "json",
  py: "python",
  python: "python",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  shell: "bash",
  css: "css",
  scss: "css",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  yaml: "yaml",
  yml: "yaml",
  sql: "sql",
};

export function codeLanguage(language: string | undefined): string | undefined {
  if (language === undefined) return undefined;
  const key = language.toLowerCase();
  return Object.hasOwn(aliases, key) ? aliases[key] : undefined;
}

export function fileLanguage(path: string): string | undefined {
  return codeLanguage(path.split(".").at(-1));
}
