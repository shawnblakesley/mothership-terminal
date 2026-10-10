import test from "node:test";
import assert from "node:assert/strict";
import { renderMd } from "../public/mdrender.js";

test("numbered lines become an ordered list", () => {
  assert.equal(renderMd("1. First\n2. Second"), "<ol><li>First</li><li>Second</li></ol>");
});
test("an indented bullet nests inside its parent", () => {
  assert.equal(renderMd("- a\n  - b\n- c"), "<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>");
});
test("a nested numbered list under a bullet, then back out", () => {
  assert.equal(renderMd("- a\n  1. x\n  2. y\ntext"), "<ul><li>a<ol><li>x</li><li>y</li></ol></li></ul><div>text</div>");
});
test("a rule is not a bullet", () => assert.equal(renderMd("---"), '<div class="md-hr"></div>'));
test("pipe tables render as a table without the separator row", () => {
  assert.equal(renderMd("| A | B |\n|---|---|\n| 1 | 2 |"), '<table class="md-t"><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>');
});
test("markup in handout text is escaped", () => {
  assert.equal(renderMd("<script>x</script>"), "<div>&lt;script&gt;x&lt;/script&gt;</div>");
});
test("inline styles still work", () => {
  assert.equal(renderMd("**bold** and `code`"), "<div><b>bold</b> and <code>code</code></div>");
});
