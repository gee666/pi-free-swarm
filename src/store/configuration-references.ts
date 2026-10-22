// Extension source URLs may carry credentials. Retain identity, never authorization data.
export function safeExtensionReference(argument: string): string {
  const prefix = argument.startsWith("git:") ? "git:" : "";
  const source = prefix ? argument.slice(prefix.length) : argument;
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(source)) return argument;
  try {
    const url = new URL(source);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return prefix + url.toString();
  } catch {
    // A malformed URL cannot be safely separated from embedded authorization data.
    return "[unrecorded extension URL]";
  }
}
