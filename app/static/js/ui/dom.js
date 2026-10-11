export const $ = (sel, parent = document) => parent.querySelector(sel);
export const $$ = (sel, parent = document) => Array.from(parent.querySelectorAll(sel));

/**
 * Tạo phần tử DOM thuần an toàn XSS (không dùng innerHTML với server data).
 * @param {string} tag - Tên thẻ HTML (div, span, button...)
 * @param {Object} props - Các thuộc tính: class, style, onclick, disabled...
 * @param {...(Node|string|number|boolean|null|undefined)} children - Các phần tử con
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  for (const [k, v] of Object.entries(props)) {
    if (k === "class") {
      node.className = v;
    } else if (k === "style") {
      node.style.cssText = v;
    } else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v !== false && v != null) {
      node.setAttribute(k, v === true ? "" : v);
    }
  }

  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    if (typeof child === "string" || typeof child === "number") {
      node.append(document.createTextNode(String(child)));
    } else if (child instanceof Node) {
      node.append(child);
    }
  }

  return node;
}
