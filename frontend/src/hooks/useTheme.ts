import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";
// v2: the default changed to light, so earlier saved choices start fresh.
const KEY = "wikipulse-theme-v2";

function stored(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light"; // storage blocked (private mode): fall back to the default
  }
}

/** Light look by default; the choice is remembered per browser. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(stored);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // ignore: the theme still applies for this visit
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  return { theme, toggle };
}
