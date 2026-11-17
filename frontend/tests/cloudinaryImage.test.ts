import { describe, expect, it } from "vitest";
import { cloudinaryOptimized, withWidthParam } from "@/lib/cloudinaryImage";

const IMG = "https://res.cloudinary.com/demo/image/upload/v1699999999/tpm/avatars/ana.jpg";

describe("withWidthParam", () => {
  it("añade el ancho como parámetro, con ? o & según corresponda", () => {
    expect(withWidthParam("/assets/logo.png", 96)).toBe("/assets/logo.png?w=96");
    expect(withWidthParam("https://ui-avatars.com/api/?name=Ana", 64.4)).toBe("https://ui-avatars.com/api/?name=Ana&w=64");
  });
  it("no toca data: ni blob:", () => {
    expect(withWidthParam("blob:http://localhost/abc", 96)).toBe("blob:http://localhost/abc");
    expect(withWidthParam("data:image/png;base64,AAA", 96)).toBe("data:image/png;base64,AAA");
  });
});

describe("cloudinaryOptimized", () => {
  it("inserta formato y calidad automáticos y el ancho pedido", () => {
    expect(cloudinaryOptimized(IMG, 640)).toBe(
      "https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_640/v1699999999/tpm/avatars/ana.jpg",
    );
  });

  it("funciona sin versión en la URL", () => {
    expect(cloudinaryOptimized("https://res.cloudinary.com/demo/image/upload/tpm/a.png", 96)).toBe(
      "https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_96/tpm/a.png",
    );
  });

  it("no toca URLs que ya llevan transformaciones", () => {
    const withT = "https://res.cloudinary.com/demo/image/upload/w_100,h_100,c_fill/v1/tpm/a.jpg";
    expect(cloudinaryOptimized(withT, 640)).toBe(withT);
    const withE = "https://res.cloudinary.com/demo/image/upload/e_grayscale/v1/tpm/a.jpg";
    expect(cloudinaryOptimized(withE, 640)).toBe(withE);
  });

  it("no toca vídeos, archivos sueltos ni otros tipos de entrega", () => {
    for (const u of [
      "https://res.cloudinary.com/demo/video/upload/v1/tpm/v.mp4",
      "https://res.cloudinary.com/demo/raw/upload/v1/tpm/doc.pdf",
      "https://res.cloudinary.com/demo/image/fetch/https://x.com/a.jpg",
      "https://res.cloudinary.com/demo/image/authenticated/v1/tpm/a.jpg",
    ]) {
      expect(cloudinaryOptimized(u, 640)).toBe(u);
    }
  });

  it("no toca imágenes de otros orígenes ni rutas locales", () => {
    for (const u of [
      "/assets/logo.png",
      "https://ui-avatars.com/api/?name=Ana&size=96",
      "https://lh3.googleusercontent.com/a/abc=s96-c",
      "https://evil.com/https://res.cloudinary.com/demo/image/upload/v1/a.jpg",
    ]) {
      expect(cloudinaryOptimized(u, 640)).toBe(u);
    }
  });

  it("un ancho absurdo no genera una URL inválida", () => {
    expect(cloudinaryOptimized(IMG, 0)).toContain("w_16/");
    expect(cloudinaryOptimized(IMG, 12.4)).toContain("w_16/");
    expect(cloudinaryOptimized(IMG, 1080.6)).toContain("w_1081/");
  });
});
