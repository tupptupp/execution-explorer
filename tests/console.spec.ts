import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Run workflow" }),
  ).toBeEnabled();
});
test("real transient execution, inspection, replay and export", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "Run workflow" }).click();
  await expect(
    page.getByRole("button", { name: "Stop execution" }),
  ).toBeVisible();
  await expect(page.locator(".metrics")).toContainText("Completed", {
    timeout: 15000,
  });
  await expect(
    page.getByRole("button", { name: "Publish event: Completed" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Enrich context: Completed" }).click();
  await expect(page.locator(".inspector")).toContainText("enrich");
  await page
    .getByRole("combobox", { name: "Filter events by step" })
    .selectOption("enrich");
  await expect(page.locator(".event-type.retrying")).toHaveCount(1);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  expect((await download).suggestedFilename()).toBe("execution-trace.json");
  await page.getByRole("slider", { name: "Replay position" }).fill("0");
  await expect(
    page.getByRole("button", { name: "Receive event: Pending" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Live", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Receive event: Completed" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".metrics")).toContainText("Completed");
  await expect(
    page.getByRole("button", { name: "Run workflow" }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: test.info().outputPath("console.png"),
    fullPage: true,
  });
});
test("outage recovery requires acknowledgement and retains completed steps", async ({
  page,
}) => {
  await page
    .getByRole("combobox", { name: "Scenario", exact: true })
    .selectOption("failure");
  await page.getByRole("button", { name: "Run workflow" }).click();
  const recover = page.getByRole("button", { name: "Recover execution" });
  await expect(recover).toBeVisible({ timeout: 15000 });
  await expect(recover).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Persist record: Failed" }),
  ).toBeVisible();
  await page.getByRole("checkbox").check();
  await recover.click();
  await expect(page.locator(".metrics")).toContainText("Completed", {
    timeout: 15000,
  });
  await page
    .getByRole("combobox", { name: "Filter events by step" })
    .selectOption("receive");
  await expect(page.locator(".event-type.started")).toHaveCount(1);
});
test("cancel and page interruption preserve recoverable progress", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Run workflow" }).click();
  await expect(
    page.getByRole("button", { name: "Enrich context: Running" }),
  ).toBeVisible();
  await page.reload();
  const recover = page.getByRole("button", { name: "Recover execution" });
  await expect(recover).toBeVisible();
  await page.getByRole("checkbox").check();
  await recover.click();
  await expect(
    page.getByRole("button", { name: "Stop execution" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop execution" }).click();
  await expect(recover).toBeVisible();
  await page.getByRole("checkbox").check();
  await recover.click();
  await expect(page.locator(".metrics")).toContainText("Completed", {
    timeout: 15000,
  });
});
test("keyboard navigation, reduced motion, no page overflow, and automated accessibility", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to console" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  const bounds = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: innerWidth,
  }));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
  if (test.info().project.name === "mobile") {
    await expect(
      page.getByRole("region", { name: "Workflow stages" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Receive event: Pending" }),
    ).toBeVisible();
  } else {
    await expect(
      page.getByRole("region", { name: "Scrollable workflow graph" }),
    ).toBeVisible();
  }
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
});
test("fault and recovery views pass automated accessibility", async ({
  page,
}) => {
  await page
    .getByRole("combobox", { name: "Scenario", exact: true })
    .selectOption("failure");
  await page.getByRole("button", { name: "Run workflow" }).click();
  await expect(
    page.getByRole("button", { name: "Recover execution" }),
  ).toBeVisible({ timeout: 15000 });
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
});
test("another tab cannot start effects while a run owns the workspace", async ({
  page,
  context,
}) => {
  const other = await context.newPage();
  await other.goto("/");
  await page.getByRole("button", { name: "Run workflow" }).click();
  await other.getByRole("button", { name: "Run workflow" }).click();
  await expect(other.getByRole("alert")).toContainText("Another tab owns");
  await page.getByRole("button", { name: "Stop execution" }).click();
  await other.close();
});

test("happy path, new execution and graph controls", async ({ page }) => {
  await page
    .getByRole("combobox", { name: "Scenario", exact: true })
    .selectOption("success");
  await page.getByRole("button", { name: "Run workflow" }).click();
  await expect(page.locator(".metrics")).toContainText("Completed", {
    timeout: 15000,
  });
  await expect(page.locator(".event-type.retrying")).toHaveCount(0);
  if (test.info().project.name !== "mobile") {
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.getByRole("button", { name: "Reset graph zoom" }).click();
  }
  await page.getByRole("button", { name: "Play event replay" }).click();
  await expect(
    page.getByRole("button", { name: "Pause replay" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause replay" }).click();
  await page.getByRole("button", { name: "New run" }).click();
  await expect(
    page.getByRole("button", { name: "Run workflow" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Receive event: Pending" }),
  ).toBeVisible();
});

test("corrupt saved data blocks execution rather than resetting silently", async ({
  page,
}) => {
  await page
    .getByRole("combobox", { name: "Scenario", exact: true })
    .selectOption("success");
  await page.getByRole("button", { name: "Run workflow" }).click();
  await expect(page.locator(".metrics")).toContainText("Completed", {
    timeout: 15000,
  });
  await page.evaluate(async () => {
    const session = JSON.parse(
      localStorage.getItem("execution-explorer/current-v2")!,
    );
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("execution-explorer-v1", 1);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("runs", "readwrite");
        const store = tx.objectStore("runs");
        const get = store.get(session.id);
        get.onsuccess = () => store.put({ ...get.result, schema: 999 });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "Invalid or unsupported checkpoint",
  );
  await page.getByRole("button", { name: "Run workflow" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Invalid or unsupported checkpoint",
  );
  await expect(
    page.getByRole("button", { name: "Receive event: Pending" }),
  ).toBeVisible();
});

test("mobile workflow stages remain readable, selectable and inside viewport", async ({ page, isMobile }) => {
  test.skip(!isMobile, "This view is designed for mobile screens");
  const region = page.getByRole("region", { name: "Workflow stages" });
  await expect(region).toBeVisible();
  const stages = region.getByRole("button");
  await expect(stages).toHaveCount(6);
  const stage = region.getByRole("button", { name: "Validate schema: Pending" });
  await expect(stage).toBeVisible();
  await stage.click();
  await expect(stage).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".inspector")).toContainText("Validate schema");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
