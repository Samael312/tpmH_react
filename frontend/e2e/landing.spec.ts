import { test, expect } from "@playwright/test";

/**
 * La portada monta escenas WebGL (HeroScene y ChipiMascot3D) que Vitest/jsdom no puede ejecutar.
 * Aquí se comprueba, en navegador real, que el canvas aparece con tamaño y que la página no rompe.
 */
test.describe("portada · escenas 3D", () => {
  test("escritorio monta el canvas WebGL; móvil no carga three.js (M17)", async ({ page, isMobile }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    if (isMobile) {
      // por diseño: en móvil se sirve el logo flotante y el chunk de three.js ni se descarga
      await page.waitForTimeout(1500);
      await expect(page.locator("canvas")).toHaveCount(0);
    } else {
      const canvas = page.locator("canvas").first();
      await expect(canvas).toBeAttached({ timeout: 30_000 });
      const box = await canvas.boundingBox();
      expect(box, "el canvas no tiene caja").not.toBeNull();
      expect(box!.width).toBeGreaterThan(50);
      expect(box!.height).toBeGreaterThan(50);
    }
    expect(pageErrors).toEqual([]);
  });

  test("no hay desbordamiento horizontal (móvil y escritorio)", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
