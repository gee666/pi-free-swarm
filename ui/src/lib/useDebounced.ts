import { useEffect, useState } from "react";

export const REFRESH_DEBOUNCE_MS = 250;

export function useDebounced(value: string) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), REFRESH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [value]);
  return debounced;
}
