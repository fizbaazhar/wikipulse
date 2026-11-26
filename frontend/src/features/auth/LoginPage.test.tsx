import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";

const setup = (onLogin = vi.fn(async () => null as string | null), notice?: string) => {
  render(<LoginPage onLogin={onLogin} notice={notice} theme="light" onToggleTheme={() => {}} />);
  return onLogin;
};

describe("LoginPage", () => {
  it("sends the trimmed username and the password", async () => {
    const onLogin = setup();
    await userEvent.type(screen.getByLabelText("Username"), "  admin ");
    await userEvent.type(screen.getByLabelText("Password"), "s3cret");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onLogin).toHaveBeenCalledWith("admin", "s3cret");
  });

  it("asks for both fields before calling the server", async () => {
    const onLogin = setup();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onLogin).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter your username and password.");
  });

  it("shows the server's error and clears the password", async () => {
    setup(vi.fn(async () => "Wrong username or password."));
    await userEvent.type(screen.getByLabelText("Username"), "admin");
    await userEvent.type(screen.getByLabelText("Password"), "nope");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong username or password.");
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("can reveal the password and shows a session notice", async () => {
    setup(undefined, "Your session ended. Please sign in again.");
    expect(screen.getByRole("status")).toHaveTextContent("Your session ended");
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
  });
});
