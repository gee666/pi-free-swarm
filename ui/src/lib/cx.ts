/** Joins the truthy class names. */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter((name) => typeof name === "string" && name.length > 0).join(" ");
}
