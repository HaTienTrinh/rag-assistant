import { el } from "./dom.js";
import { createSvg } from "./icons.js";

let lastFocusedElement = null;

/**
 * Mở modal dialog an toàn và lưu lại phần tử kích hoạt để trả focus khi đóng
 * @param {HTMLDialogElement} dialogEl - Thẻ <dialog>
 * @param {HTMLElement|null} triggerEl - Nút mở dialog
 */
export function openCustomDialog(dialogEl, triggerEl = null) {
  if (!dialogEl) return;
  lastFocusedElement = triggerEl || document.activeElement;
  dialogEl.showModal();
}

/**
 * Đóng modal dialog và trả focus về phần tử ban đầu
 * @param {HTMLDialogElement} dialogEl - Thẻ <dialog>
 */
export function closeCustomDialog(dialogEl) {
  if (!dialogEl || !dialogEl.open) return;
  dialogEl.close();
  if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
    lastFocusedElement.focus();
  }
}

// Lắng nghe sự kiện click nút đóng có thuộc tính data-close-dialog
document.addEventListener("click", (e) => {
  const closeBtn = e.target.closest("[data-close-dialog]");
  if (closeBtn) {
    const dialog = closeBtn.closest("dialog");
    if (dialog) closeCustomDialog(dialog);
  }
});

/**
 * Hộp thoại xác nhận dùng chung (thay thế window.confirm hoàn toàn),
 * được tạo động bằng JS và chèn vào DOM nếu chưa có.
 * @param {Object} options
 * @param {string} [options.title="Xác nhận"]
 * @param {string} options.message
 * @param {boolean} [options.isDanger=true]
 * @param {string} [options.okText="Xác nhận"]
 * @param {string} [options.cancelText="Hủy"]
 * @param {Function} options.onConfirm
 */
export function showConfirmDialog({
  title = "Xác nhận",
  message,
  isDanger = true,
  okText = "Xác nhận",
  cancelText = "Hủy",
  onConfirm,
}) {
  let dialog = document.getElementById("global-confirm-dialog");

  if (!dialog) {
    dialog = el("dialog", { id: "global-confirm-dialog", class: "custom-dialog" },
      el("div", { class: "dialog-card" },
        el("div", { class: "dialog-header" },
          el("h3", { id: "global-confirm-title", class: "dialog-title" }, title),
          el("button", {
            type: "button",
            class: "icon-btn dialog-close-btn",
            "data-close-dialog": "",
            "aria-label": "Đóng hộp thoại",
          }, createSvg("close", 18, 18))
        ),
        el("div", { class: "dialog-body" },
          el("p", { id: "global-confirm-msg", class: "dialog-desc" }, message)
        ),
        el("div", { class: "dialog-footer" },
          el("button", {
            type: "button",
            id: "global-confirm-cancel-btn",
            class: "btn btn-outline",
            "data-close-dialog": "",
          }, cancelText),
          el("button", {
            type: "button",
            id: "global-confirm-ok-btn",
            class: isDanger ? "btn btn-danger" : "btn btn-primary",
          }, okText)
        )
      )
    );
    document.body.append(dialog);
  }

  // Cập nhật nội dung
  const titleEl = document.getElementById("global-confirm-title");
  const msgEl = document.getElementById("global-confirm-msg");
  const cancelBtn = document.getElementById("global-confirm-cancel-btn");
  const okBtn = document.getElementById("global-confirm-ok-btn");

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  if (cancelBtn) cancelBtn.textContent = cancelText;

  if (okBtn) {
    okBtn.textContent = okText;
    okBtn.className = isDanger ? "btn btn-danger" : "btn btn-primary";

    // Thay thế nút để xóa các listener trước đó
    const newOkBtn = okBtn.cloneNode(true);
    okBtn.replaceWith(newOkBtn);

    newOkBtn.addEventListener("click", async () => {
      closeCustomDialog(dialog);
      if (typeof onConfirm === "function") {
        await onConfirm();
      }
    });
  }

  openCustomDialog(dialog);
}
