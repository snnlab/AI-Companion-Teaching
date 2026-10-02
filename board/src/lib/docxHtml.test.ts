// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeDocxHtml } from "./docxHtml";

const ASSETS = { "docx-media/image1.png": "data:image/png;base64,AAAA" };

describe("sanitizeDocxHtml", () => {
  it("keeps the structure board.py emits", () => {
    const html =
      '<h2>Results</h2><p class="caption ac">Table 1. <em>CLPM</em></p>' +
      '<div class="tbl"><table><colgroup><col style="width:60%"><col style="width:40%"></colgroup>' +
      '<thead><tr><th rowspan="2" class="bt bb">Model</th><th colspan="2" class="bt bb sh">b</th></tr></thead>' +
      '<tbody><tr><td class="bb ar">0.07</td></tr></tbody></table></div>' +
      '<ol type="a" start="3"><li>x<sup class="fn"><a href="#fn-1" id="fnref-1">1</a></sup></li></ol>' +
      '<section class="footnotes"><ol><li id="fn-1"><p>Note.</p></li></ol></section>';
    expect(sanitizeDocxHtml(html)).toBe(html);
  });

  it("resolves figures only through the assets map, keeping Word's size", () => {
    expect(sanitizeDocxHtml('<img src="docx-media/image1.png" alt="Fig" width="200" height="100" class="fig">', ASSETS)).toBe(
      '<img src="data:image/png;base64,AAAA" alt="Fig" width="200" height="100" loading="lazy" class="fig">',
    );
    // a reference the payload does not back is never fetched
    expect(sanitizeDocxHtml('<img src="https://evil.example/x.png" alt="X">', ASSETS)).toBe(
      '<span class="fig-missing">[Figure: X]</span>',
    );
    expect(sanitizeDocxHtml('<img src="docx-media/a.png">', { "docx-media/a.png": "javascript:alert(1)" })).toContain("fig-missing");
  });

  it("strips scripts, handlers, unsafe links, styles and unknown markup", () => {
    const out = sanitizeDocxHtml(
      '<p onclick="steal()" style="color:red" class="ac evil">ok<script>alert(1)</script></p>' +
        '<a href="javascript:alert(1)">js</a><a href="https://x.org">web</a>' +
        '<iframe src="https://x.org"></iframe><svg><script>1</script></svg>' +
        '<font color="red">kept text</font><img src=x onerror="alert(1)">' +
        '<col style="background:url(x)"><td colspan="0" rowspan="abc">c</td>',
    );
    expect(out).not.toMatch(/script|onclick|onerror|javascript:|iframe|svg|font|color|background|evil/);
    expect(out).toContain('<p class="ac">ok</p>');
    expect(out).toContain("js"); // the link text survives, the link does not
    expect(out).toContain('<a href="https://x.org" target="_blank" rel="noopener noreferrer">web</a>');
    expect(out).toContain("kept text");
  });

  it("typesets equations from data-tex and drops the TeX source from the text", () => {
    const out = sanitizeDocxHtml(
      '<p>Let <span class="math" data-tex="\\beta_1"></span> and</p>' +
        '<p><span class="math" data-tex="y=\\frac{a}{b}" data-display="1"></span></p>',
    );
    expect(out).toContain('<span class="math math-inline" data-tex="\\beta_1"><span class="katex"><math');
    expect(out).toContain('class="math math-display"');
    expect(out).not.toContain("<annotation");
  });
});
