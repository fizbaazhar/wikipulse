import { useEffect, useId, useRef, useState } from "react";

interface Props {
  user: string;
  onLogout: () => void;
}

/** Avatar + name button; opens a small menu with Sign out. */
export function UserMenu({ user, onLogout }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="user-trigger"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account: ${user}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar user={user} />
        <span className="user-name">{user}</span>
        <svg className="user-caret" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>

      {open && (
        <div className="user-dropdown" id={menuId}>
          <div className="user-dropdown-head">
            <Avatar user={user} large />
            <div>
              <strong>{user}</strong>
              <span>Signed in</span>
            </div>
          </div>
          <button type="button" className="user-item user-item-danger" onClick={onLogout}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Avatar({ user, large = false }: { user: string; large?: boolean }) {
  return (
    <span className={`user-avatar ${large ? "user-avatar-lg" : ""}`} aria-hidden="true">
      {user.slice(0, 1).toUpperCase()}
    </span>
  );
}
