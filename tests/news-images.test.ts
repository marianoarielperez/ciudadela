import { describe, expect, it } from "vitest";
import { isValidNewsImageName, newsImageUrl, sniffImageExt } from "@/lib/news/images";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

describe("isValidNewsImageName", () => {
  it("acepta uuid.ext de la allowlist", () => {
    expect(isValidNewsImageName("123e4567-e89b-42d3-a456-426614174000.jpg")).toBe(true);
    expect(isValidNewsImageName("123e4567-e89b-42d3-a456-426614174000.webp")).toBe(true);
  });
  it("rechaza path traversal y extensiones fuera de la allowlist", () => {
    expect(isValidNewsImageName("../secret.jpg")).toBe(false);
    expect(isValidNewsImageName("..%2Fsecret.jpg")).toBe(false);
    expect(isValidNewsImageName("123e4567-e89b-42d3-a456-426614174000.svg")).toBe(false);
    expect(isValidNewsImageName("foo.jpg")).toBe(false);
    expect(isValidNewsImageName("")).toBe(false);
  });

  // Esta función es la ÚNICA defensa contra path traversal: el route handler
  // concatena el nombre a una ruta del filesystem. Cada caso de acá es un
  // intento real de salirse de UPLOADS_DIR/news o de que el navegador
  // interprete el archivo como algo ejecutable.
  it("rechaza separadores de Windows", () => {
    expect(isValidNewsImageName("..\\secret.jpg")).toBe(false);
    expect(isValidNewsImageName(`..\\${UUID}.jpg`)).toBe(false);
    expect(isValidNewsImageName(`..\\..\\.env`)).toBe(false);
    expect(isValidNewsImageName(`sub\\${UUID}.jpg`)).toBe(false);
  });
  it("rechaza rutas absolutas", () => {
    expect(isValidNewsImageName("/etc/passwd")).toBe(false);
    expect(isValidNewsImageName(`/var/sigev/uploads/news/${UUID}.jpg`)).toBe(false);
    expect(isValidNewsImageName(`/${UUID}.jpg`)).toBe(false);
    expect(isValidNewsImageName(`C:\\Windows\\win.ini`)).toBe(false);
    expect(isValidNewsImageName(`\\\\servidor\\share\\${UUID}.jpg`)).toBe(false);
  });
  it("rechaza byte nulo", () => {
    expect(isValidNewsImageName(`${UUID}.jpg\u0000.txt`)).toBe(false);
    expect(isValidNewsImageName(`${UUID}\u0000.jpg`)).toBe(false);
    expect(isValidNewsImageName(`../.env\u0000${UUID}.jpg`)).toBe(false);
  });
  it("rechaza doble extensión en cualquier orden", () => {
    expect(isValidNewsImageName(`${UUID}.jpg.svg`)).toBe(false);
    expect(isValidNewsImageName(`${UUID}.svg.jpg`)).toBe(false);
    expect(isValidNewsImageName(`${UUID}.html.png`)).toBe(false);
    expect(isValidNewsImageName(`${UUID}.png.php`)).toBe(false);
  });
  it("rechaza mayúsculas en el uuid o en la extensión", () => {
    expect(isValidNewsImageName(`${UUID.toUpperCase()}.jpg`)).toBe(false);
    expect(isValidNewsImageName(`${UUID}.JPG`)).toBe(false);
    expect(isValidNewsImageName(`${UUID}.Webp`)).toBe(false);
  });
  // En Python/PCRE `$` matchea antes de un \n final; en JS sin flag `m` no.
  // Se testea igual para que un futuro cambio de regex no reintroduzca el
  // agujero (p. ej. agregar `m`, o pasar a `String.match` con otra anclada).
  it("rechaza saltos de línea y espacios al final", () => {
    expect(isValidNewsImageName(`${UUID}.jpg\n`)).toBe(false);
    expect(isValidNewsImageName(`${UUID}.jpg\r\n`)).toBe(false);
    expect(isValidNewsImageName(`${UUID}.jpg `)).toBe(false);
    expect(isValidNewsImageName(` ${UUID}.jpg`)).toBe(false);
  });
  it("rechaza nombres sin extensión o con el uuid mal formado", () => {
    expect(isValidNewsImageName(UUID)).toBe(false);
    expect(isValidNewsImageName(`${UUID}.`)).toBe(false);
    expect(isValidNewsImageName("123e4567-e89b-42d3-a456-42661417400.jpg")).toBe(false);
    expect(isValidNewsImageName("123e4567e89b42d3a456426614174000.jpg")).toBe(false);
    expect(isValidNewsImageName(`${UUID}0.jpg`)).toBe(false);
  });
});

describe("sniffImageExt", () => {
  it("detecta por magic bytes, no por extensión", () => {
    expect(sniffImageExt(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("jpg");
    expect(sniffImageExt(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe("png");
    const webp = new Uint8Array(12);
    webp.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    webp.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
    expect(sniffImageExt(webp)).toBe("webp");
    expect(sniffImageExt(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  // Un SVG que se hace pasar por PNG sería XSS almacenado: el navegador
  // ejecuta el <script> del SVG con el origen del sitio.
  it("rechaza un SVG y un HTML aunque vengan con nombre de imagen", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(sniffImageExt(svg)).toBeNull();
    expect(sniffImageExt(new TextEncoder().encode("<!DOCTYPE html><html><body>hola"))).toBeNull();
    // RIFF que no es WEBP (un .wav): no alcanza con la firma RIFF.
    const wav = new Uint8Array(12);
    wav.set([0x52, 0x49, 0x46, 0x46], 0);
    wav.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
    expect(sniffImageExt(wav)).toBeNull();
  });
  it("no explota con buffers cortos", () => {
    expect(sniffImageExt(new Uint8Array([]))).toBeNull();
    expect(sniffImageExt(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffImageExt(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(sniffImageExt(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]))).toBeNull();
  });
});

describe("newsImageUrl", () => {
  it("arma la URL del route handler", () => {
    expect(newsImageUrl("a.jpg")).toBe("/api/imagenes/noticias/a.jpg");
  });
});
