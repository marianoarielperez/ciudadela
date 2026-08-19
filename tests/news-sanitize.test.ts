import { describe, expect, it } from "vitest";
import { newsBodyIsEmpty, newsPlainText, sanitizeNewsBody } from "@/lib/news/sanitize";

describe("sanitizeNewsBody", () => {
  it("deja pasar la allowlist del editor", () => {
    const html = "<h2>Título</h2><p><strong>Hola</strong> <em>vecinos</em> <u>todos</u></p><ul><li>uno</li></ul>";
    expect(sanitizeNewsBody(html)).toBe(html);
  });
  it("elimina scripts, estilos y handlers", () => {
    expect(sanitizeNewsBody('<p onclick="x()">hola</p><script>alert(1)</script>')).toBe("<p>hola</p>");
    expect(sanitizeNewsBody('<p style="color:red">hola</p>')).toBe("<p>hola</p>");
  });
  it("solo links http/https y les fuerza rel", () => {
    expect(sanitizeNewsBody('<a href="javascript:alert(1)">x</a>')).toBe('<a rel="noopener noreferrer">x</a>');
    expect(sanitizeNewsBody('<a href="https://example.com">x</a>')).toBe(
      '<a href="https://example.com" rel="noopener noreferrer">x</a>',
    );
  });
  it("degrada tags fuera de la allowlist conservando el texto", () => {
    expect(sanitizeNewsBody("<h1>grande</h1><table><tr><td>celda</td></tr></table>")).toBe("grandecelda");
  });

  // Casos hostiles extra: el cuerpo persistido se renderiza después con
  // dangerouslySetInnerHTML sin volver a sanitizar, así que estos vectores
  // clásicos no pueden sobrevivir ni siquiera parcialmente.
  it("descarta img con handlers inline", () => {
    expect(sanitizeNewsBody("<img src=x onerror=alert(1)>")).toBe("");
    expect(sanitizeNewsBody('<p>antes<img src="x" onerror="alert(1)">después</p>')).toBe("<p>antesdespués</p>");
  });
  it("descarta iframes y svg con onload", () => {
    expect(sanitizeNewsBody('<iframe src="https://evil.example/x"></iframe>')).toBe("");
    expect(sanitizeNewsBody('<svg onload="alert(1)"></svg>')).toBe("");
  });
  it("no deja pasar hrefs data: ni con mayúsculas o espacios de por medio", () => {
    expect(sanitizeNewsBody('<a href="data:text/html,<script>alert(1)</script>">x</a>')).toBe(
      '<a rel="noopener noreferrer">x</a>',
    );
    expect(sanitizeNewsBody('<a href="JaVaScRiPt:alert(1)">x</a>')).toBe('<a rel="noopener noreferrer">x</a>');
    expect(sanitizeNewsBody('<a href=" javascript:alert(1)">x</a>')).toBe('<a rel="noopener noreferrer">x</a>');
  });
  it("escapa el texto que parece markup en vez de reinyectarlo", () => {
    expect(sanitizeNewsBody("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>")).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    );
  });
  it("descarta hrefs protocol-relative pero conserva los links internos", () => {
    expect(sanitizeNewsBody('<a href="//evil.example/x">x</a>')).toBe('<a rel="noopener noreferrer">x</a>');
    expect(sanitizeNewsBody('<a href="/noticias/1">x</a>')).toBe(
      '<a href="/noticias/1" rel="noopener noreferrer">x</a>',
    );
    expect(sanitizeNewsBody('<a href="#seccion">x</a>')).toBe('<a href="#seccion" rel="noopener noreferrer">x</a>');
  });
  it("pisa el rel hostil y descarta target", () => {
    expect(sanitizeNewsBody('<a href="https://ok.com" rel="opener" target="_blank">x</a>')).toBe(
      '<a href="https://ok.com" rel="noopener noreferrer">x</a>',
    );
  });
  it("descarta el esquema ofuscado con entidades HTML", () => {
    expect(sanitizeNewsBody('<a href="java&#115;cript:alert(1)">x</a>')).toBe('<a rel="noopener noreferrer">x</a>');
  });
  it("es idempotente: re-editar una noticia no cambia el cuerpo", () => {
    const html =
      '<h2>Título</h2><p><strong>Hola</strong> <a href="https://example.com">link</a> y <a href="/noticias/1">interno</a></p><ul><li>uno</li></ul>';
    const once = sanitizeNewsBody(html);
    expect(sanitizeNewsBody(once)).toBe(once);
    expect(once).toBe(
      '<h2>Título</h2><p><strong>Hola</strong> <a href="https://example.com" rel="noopener noreferrer">link</a> y <a href="/noticias/1" rel="noopener noreferrer">interno</a></p><ul><li>uno</li></ul>',
    );
  });
});

describe("newsBodyIsEmpty", () => {
  it("detecta el HTML sin texto real", () => {
    expect(newsBodyIsEmpty("<p></p><p>  </p>")).toBe(true);
    expect(newsBodyIsEmpty("<p>hola</p>")).toBe(false);
    expect(newsBodyIsEmpty("")).toBe(true);
  });
});

describe("newsPlainText", () => {
  it("extrae texto plano y corta con elipsis", () => {
    expect(newsPlainText("<p>Hola <strong>vecinos</strong> del barrio</p>")).toBe("Hola vecinos del barrio");
    expect(newsPlainText(`<p>${"a".repeat(200)}</p>`, 50).length).toBeLessThanOrEqual(51);
    expect(newsPlainText(`<p>${"a".repeat(200)}</p>`, 50).endsWith("…")).toBe(true);
  });
});
