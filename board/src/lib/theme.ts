// Theme resolution (v0.11 dark mode). The same logic runs twice: once as an
// inline pre-paint script in board/index.html (no flash of the wrong theme),
// and here for the React-side toggle. Storage is best-effort — file:// exports
// and the live server's per-port origins may not persist, and then the OS
// preference simply applies.
export type Theme = "light" | "dark";

export const THEME_KEY = "aict-board:theme";

export function resolveTheme(stored: string | null, systemDark: boolean): Theme {
  if (stored === "dark" || stored === "light") return stored;
  return systemDark ? "dark" : "light";
}
