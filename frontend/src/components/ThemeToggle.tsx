import type { Theme } from "../hooks/useTheme";

interface Props {
  theme: Theme;
  onToggle: () => void;
  /** Extra class for placement, e.g. on the login page. */
  className?: string;
}

/** Sun / moon button that switches between the light and dark themes. */
export function ThemeToggle({ theme, onToggle, className }: Props) {
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className={className ? `icon-btn ${className}` : "icon-btn"}
      onClick={onToggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
    >
      {dark ? "☀" : "☾"}
    </button>
  );
}
