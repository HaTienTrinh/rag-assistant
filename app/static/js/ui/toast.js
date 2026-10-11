import { el } from "./dom.js";
import { createSvg } from "./icons.js";

/**
 * Hiển thị toast thông báo
 * @param {string} message - Nội dung thông báo
 * @param {"success"|"error"|"warning"|"info"} type - Loại thông báo
 */
export function toast(message, type = "info") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = el("div", {
      id: "toast-container",
      class: "toast-container",
      "aria-live": "polite",
      "aria-atomic": "true",
    });
    document.body.append(container);
  }

  const iconNameMap = {
    success: "check",
    error: "alert",
    warning: "alert",
    info: "info",
  };

  const icon = createSvg(iconNameMap[type] || "info", 18, 18);
  const toastItem = el("div", { class: `toast toast-${type}` },
    el("div", { class: "toast-icon" }, icon),
    el("div", { class: "toast-msg" }, message)
  );

  container.append(toastItem);

  setTimeout(() => {
    toastItem.style.opacity = "0";
    toastItem.style.transform = "translateY(-6px)";
    setTimeout(() => toastItem.remove(), 250);
  }, 4000);
}
