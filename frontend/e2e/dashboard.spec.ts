import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, password = "e2e-password") {
  await page.getByLabel("Username").fill("e2e");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** The guided tour opens on a first visit; mark it seen so it doesn't cover the page. */
async function skipTour(page: Page) {
  await page.addInitScript(() => localStorage.setItem("wikipulse-tour-done-v1", "1"));
}

test.describe("Guided tour", () => {
  test("opens on the first visit, walks every section and can be replayed", async ({ page }) => {
    await page.goto("/");
    await signIn(page);
    const tour = page.getByRole("dialog");
    await expect(tour.getByRole("heading", { name: /Welcome to WikiPulse/ })).toBeVisible();
    await tour.getByRole("button", { name: "Start tour" }).click();
    await expect(tour.getByRole("heading", { name: "Connection status" })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(tour.getByRole("heading", { name: "Key numbers" })).toBeVisible();
    await tour.getByRole("button", { name: "Back" }).click();
    await expect(tour.getByRole("heading", { name: "Connection status" })).toBeVisible();

    // Walk to the end.
    while (!(await tour.getByRole("button", { name: "Finish" }).isVisible())) {
      await tour.getByRole("button", { name: "Next" }).click();
    }
    await expect(tour.getByRole("heading", { name: "That's it!" })).toBeVisible();
    await tour.getByRole("button", { name: "Finish" }).click();
    await expect(tour).toBeHidden();

    // Seen once: a reload doesn't reopen it, but the ? button does.
    await page.reload();
    await expect(page.locator(".feed-item").first()).toBeVisible();
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.getByRole("button", { name: "Take the tour" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});

test.describe("Login", () => {
  test("rejects a wrong password, then signs in and out", async ({ page }) => {
    await skipTour(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Hello! Let's get started" })).toBeVisible();

    // The API and the live socket are closed without a session.
    expect((await page.request.get("/api/snapshot")).status()).toBe(401);

    await signIn(page, "wrong");
    await expect(page.getByRole("alert")).toHaveText("Wrong username or password.");

    await expect(page).toHaveURL(/\/login$/);
    await signIn(page);
    await expect(page.locator(".feed-item").first()).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.reload(); // the session cookie survives a reload
    await expect(page.locator(".feed-item").first()).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("WikiPulse dashboard (replaying the recorded sample)", () => {
  test.beforeEach(async ({ page }) => {
    // Any alert() would mean an XSS payload from the sample data executed.
    page.on("dialog", (dialog) => {
      throw new Error(`Unexpected dialog: ${dialog.message()}`);
    });
    await skipTour(page);
    await page.goto("/");
    await signIn(page);
  });

  test("shows live stats, trending pages and the feed", async ({ page }) => {
    await expect(page.getByRole("status")).toHaveText(/Replay/);

    const top = page.locator(".top-pages");
    await expect(top.locator(".top-item").first()).toContainText("Artificial intelligence");
    await expect(top.locator(".top-item")).toHaveCount(10);

    await expect(page.locator(".feed-item").first()).toBeVisible();
    expect(await page.locator(".feed-item").count()).toBeGreaterThan(50);

    // Charts: heartbeat line, per-minute stacks, editor mix, size histogram, busiest wikis.
    await expect(page.locator(".heartbeat path.line").first()).toBeAttached();
    await expect(page.locator(".chart .bar").first()).toBeAttached();
    await expect(page.locator(".editors .segbar-part").first()).toBeVisible();
    await expect(page.locator(".sizes .bar").first()).toBeAttached();
    await expect(page.locator(".top-pages .sparkline").first()).toBeVisible();
    await expect(page.locator(".pulse-headline")).toContainText("Artificial intelligence");
  });

  test("flags the planted attacks and renders them as harmless text", async ({ page }) => {
    const flagged = page.locator(".flagged");
    await expect(flagged.getByText("edit summary contains instructions aimed at automated moderation").first()).toBeVisible();
    await expect(flagged.getByText("edit summary contains HTML/script code").first()).toBeVisible();

    // The raw payload is visible as text...
    await expect(flagged.getByText('<script>alert("xss")</script>', { exact: false })).toBeVisible();
    // ...and no element from it was injected into the page.
    await expect(page.locator("img[src='x']")).toHaveCount(0);
  });

  test("filters everything by wiki", async ({ page }) => {
    await expect(page.locator(".feed-item").first()).toBeVisible();
    await page.getByLabel("Filter by wiki").selectOption("frwiki");

    const items = page.locator(".feed-item");
    await expect(items.first()).toHaveAttribute("data-wiki", "frwiki");
    const wikis = await items.evaluateAll((els) => els.map((el) => el.getAttribute("data-wiki")));
    expect(new Set(wikis)).toEqual(new Set(["frwiki"]));
    await expect(page.locator(".top-pages .wiki-tag").first()).toHaveText("French");
  });

  test("clicking a busy wiki filters the whole dashboard", async ({ page }) => {
    await page.locator(".wikis").getByRole("button", { name: /French/ }).click();
    await expect(page.getByLabel("Filter by wiki")).toHaveValue("frwiki");
    await expect(page.locator(".feed-item").first()).toHaveAttribute("data-wiki", "frwiki");
    await expect(page.locator(".wikis").getByRole("button", { name: /French/ })).toHaveAttribute("aria-pressed", "true");

    await page.locator(".wikis").getByRole("button", { name: "Show all" }).click();
    await expect(page.getByLabel("Filter by wiki")).toHaveValue("");
  });
});
