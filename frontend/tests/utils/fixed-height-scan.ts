import ts from "typescript";

/*
 * Finds a fixed height on an element that holds text. Arabic-script text (Urdu at a line height of 2.5, Nastaliq) is taller than
 * the same Latin text and its height changes with the font that loads, so a box with a fixed `h-*` or `height` around a sentence
 * clips it. A box that holds no text (a chart plot, a swatch, a rule) may have any height.
 *
 * An element is a TEXT element when it is a heading, paragraph, label, list item, definition, table cell, legend, summary, button or
 * link, or when one of its direct children is JSX text or an expression (`{t("x")}`, `{name}`): those are the elements whose own
 * content is words. An element whose children are only other elements is a layout box, not a text element.
 *
 * A fixed height is a Tailwind `h-` or `size-` class with a number, an arbitrary value `[..]`, a variable `(--x)`, `px`, `full`,
 * `screen`, `dvh`, `svh` or `lvh` (with any variant prefix: `sm:h-12`, `max-[899px]:h-90`), or a `height` in an inline `style`
 * that is not `auto`. `min-h-*` and `max-h-*` are not fixed.
 *
 * A hit is accepted with a comment on the line of the element or the line above: `fixed-height-ok: <why>`; the reason is required.
 */

const TEXT_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "label", "li", "dt", "dd", "th", "td", "legend", "summary", "button", "a", "figcaption", "caption", "blockquote"]);
const FIXED = /^(?:[a-z0-9\-[\]&>:_*]+:)*(?:h|size)-(?:\d|\[|\(|px$|full$|screen$|dvh$|svh$|lvh$)/;
const ACCEPT = /fixed-height-ok:[ \t]*\S/;

export interface Hit {
  readonly line: number;
  readonly tag: string;
  readonly fixed: string;
}

function classTokens(attributes: ts.JsxAttributes): string[] {
  const tokens: string[] = [];
  for (const attribute of attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== "className" || attribute.initializer === undefined) continue;
    // Every string and template chunk inside the value: className="a b", className={`a ${x}`}, className={cond ? "a" : "b"}.
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) tokens.push(...node.text.split(/\s+/));
      else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) tokens.push(...node.text.split(/\s+/));
      ts.forEachChild(node, visit);
    };
    visit(attribute.initializer);
  }
  return tokens.filter((token) => token !== "");
}

function inlineHeight(attributes: ts.JsxAttributes): string | null {
  for (const attribute of attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== "style" || attribute.initializer === undefined) continue;
    const match = /\bheight\s*:\s*([^,}]+)/.exec(attribute.initializer.getText());
    if (match !== null && !/^["'`]?\s*auto\b/.test((match[1] ?? "").trim())) return `style height: ${(match[1] ?? "").trim()}`;
  }
  return null;
}

/** An expression child that is itself markup or a list of markup (`{cond ? <a/> : null}`, `{items.map(...)}`) is not text. */
function isMarkup(expression: ts.Expression): boolean {
  const seen = { markup: false };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) seen.markup = true;
    else ts.forEachChild(node, visit);
  };
  visit(expression);
  // `{children}`, `{band}` and the like are slots filled with markup by the caller.
  return seen.markup || (ts.isIdentifier(expression) && /^(children|content|band|icon|clock|dock|trailing)$/.test(expression.text));
}

function holdsText(element: ts.JsxElement | ts.JsxSelfClosingElement, tag: string): boolean {
  if (TEXT_TAGS.has(tag)) return true;
  if (ts.isJsxSelfClosingElement(element)) return false;
  return element.children.some((child) => (ts.isJsxText(child) && child.text.trim() !== "") || (ts.isJsxExpression(child) && child.expression !== undefined && !isMarkup(child.expression)));
}

export function fixedHeightOnText(source: string, fileName = "file.tsx"): Hit[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines = source.split("\n");
  const hits: Hit[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = opening.tagName.getText();
      const fixed = classTokens(opening.attributes).find((token) => FIXED.test(token)) ?? inlineHeight(opening.attributes);
      if (fixed !== null && holdsText(node, tag)) {
        const line = file.getLineAndCharacterOfPosition(opening.getStart()).line;
        const context = [lines[line - 1] ?? "", lines[line] ?? ""].join("\n");
        if (!ACCEPT.test(context)) hits.push({ line: line + 1, tag, fixed });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hits;
}
