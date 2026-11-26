import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserMenu } from "./UserMenu";

afterEach(() => vi.restoreAllMocks());

const open = async () => userEvent.click(screen.getByRole("button", { name: "Account: admin" }));

describe("UserMenu", () => {
  it("keeps Sign out in a dropdown opened from the avatar", async () => {
    const onLogout = vi.fn();
    render(<UserMenu user="admin" onLogout={onLogout} />);
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();

    await open();
    expect(screen.getByRole("button", { name: "Account: admin" })).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("closes on Escape and on a click outside", async () => {
    render(<UserMenu user="admin" onLogout={() => {}} />);
    await open();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(screen.getByRole("button", { name: "Account: admin" })).toHaveFocus();

    await open();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });
});
