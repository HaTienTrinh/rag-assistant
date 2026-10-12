import { sendJSON } from "../core/api.js";
import { setAccessToken, logout } from "../core/auth.js";
import { el, $ } from "./dom.js";
import { createSvg } from "./icons.js";
import { toast } from "./toast.js";

let changePasswordDialog = null;
let lastTriggerElement = null;
let isForcedMode = false;
let forcedOnSuccessCallback = null;

/**
 * Tạo một ô nhập mật khẩu có nút bật/tắt ẩn/hiện mật khẩu
 * @param {Object} options
 * @param {string} options.id - ID của input
 * @param {string} options.label - Nhãn hiển thị
 * @param {string} options.autocomplete - Giá trị thuộc tính autocomplete
 * @param {string} options.placeholder - Gợi ý nhập
 * @returns {HTMLElement} Phần tử .form-group
 */
function createPasswordField({ id, label, autocomplete, placeholder }) {
  const input = el("input", {
    type: "password",
    id,
    name: id,
    class: "form-input password-input",
    placeholder,
    autocomplete,
    required: true,
  });

  const toggleBtn = el("button", {
    type: "button",
    class: "password-toggle-btn",
    "aria-label": `Hiện ${label.toLowerCase()}`,
    title: "Hiện mật khẩu",
    onclick: () => {
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      toggleBtn.replaceChildren(createSvg(isPassword ? "eye-off" : "eye", 16, 16));
      toggleBtn.setAttribute("aria-label", isPassword ? `Ẩn ${label.toLowerCase()}` : `Hiện ${label.toLowerCase()}`);
      toggleBtn.title = isPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu";
      input.focus();
    },
  }, createSvg("eye", 16, 16));

  const inputWrap = el("div", { class: "password-input-wrap" }, input, toggleBtn);

  return el("div", { class: "form-group" },
    el("label", { for: id, class: "form-label" }, label),
    inputWrap
  );
}

/**
 * Đảm bảo hộp thoại <dialog id="change-password-dialog"> đã có trong DOM
 */
function ensureDialogCreated() {
  if (changePasswordDialog && document.body.contains(changePasswordDialog)) {
    return changePasswordDialog;
  }

  const existing = document.getElementById("change-password-dialog");
  if (existing) {
    changePasswordDialog = existing;
    return changePasswordDialog;
  }

  // 1. Error Banner trong modal
  const errorBox = el("div", {
    id: "change-pw-error-box",
    class: "alert-banner alert-danger",
    role: "alert",
    hidden: true,
  },
    el("div", { class: "alert-icon" }, createSvg("alert", 18, 18)),
    el("div", { id: "change-pw-error-text", class: "alert-text" })
  );

  // 1b. Lời dẫn thông báo khi ở chế độ bắt buộc đổi mật khẩu (forced)
  const forcedNotice = el("div", {
    id: "change-pw-forced-notice",
    class: "alert-banner alert-warning",
    role: "alert",
    hidden: true,
  },
    el("div", { class: "alert-icon" }, createSvg("alert", 18, 18)),
    el("div", { class: "alert-text" }, "Đây là lần đăng nhập đầu tiên hoặc mật khẩu vừa được quản trị viên đặt lại. Vui lòng đặt mật khẩu mới.")
  );

  // 2. Các ô nhập mật khẩu
  const currentField = createPasswordField({
    id: "change-pw-current",
    label: "Mật khẩu hiện tại",
    autocomplete: "current-password",
    placeholder: "Nhập mật khẩu đang dùng",
  });

  const newField = createPasswordField({
    id: "change-pw-new",
    label: "Mật khẩu mới",
    autocomplete: "new-password",
    placeholder: "Tối thiểu 8 ký tự",
  });

  const confirmField = createPasswordField({
    id: "change-pw-confirm",
    label: "Nhập lại mật khẩu mới",
    autocomplete: "new-password",
    placeholder: "Nhập lại chính xác mật khẩu mới",
  });

  // 3. Khối gợi ý quy tắc
  const rulesHint = el("div", { class: "password-rules-box" },
    el("div", { class: "password-rules-title" }, "Quy tắc mật khẩu:"),
    el("ul", { class: "password-rules-list" },
      el("li", {}, "Tối thiểu 8 ký tự, tối đa 72 ký tự."),
      el("li", {}, "Không được trùng với mật khẩu hiện tại."),
      el("li", {}, "Sau khi đổi, các thiết bị khác đang đăng nhập sẽ bị đăng xuất.")
    )
  );

  // 4. Các nút hành động
  const cancelBtn = el("button", {
    id: "change-pw-cancel-btn",
    type: "button",
    class: "btn btn-outline",
    onclick: () => {
      if (isForcedMode) {
        logout();
      } else {
        closeChangePasswordDialog();
      }
    },
  }, "Hủy");

  const submitBtn = el("button", {
    id: "change-pw-submit-btn",
    type: "submit",
    class: "btn btn-primary",
  }, "Xác nhận đổi");

  // 5. Thẻ Form
  const form = el("form", { id: "change-password-form" },
    el("div", { class: "dialog-body" },
      forcedNotice,
      errorBox,
      currentField,
      newField,
      confirmField,
      rulesHint
    ),
    el("div", { class: "dialog-footer" },
      cancelBtn,
      submitBtn
    )
  );

  // Xử lý gửi Form
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const currentInput = $("#change-pw-current");
    const newInput = $("#change-pw-new");
    const confirmInput = $("#change-pw-confirm");
    const errorText = $("#change-pw-error-text");

    const currentPass = currentInput?.value || "";
    const newPass = newInput?.value || "";
    const confirmPass = confirmInput?.value || "";

    const showError = (msg) => {
      if (errorBox && errorText) {
        errorText.textContent = msg;
        errorBox.hidden = false;
      }
    };

    const clearError = () => {
      if (errorBox) errorBox.hidden = true;
    };

    clearError();

    // Kiểm tra client-side
    if (!currentPass) {
      showError("Vui lòng nhập mật khẩu hiện tại");
      currentInput?.focus();
      return;
    }

    if (newPass.length < 8) {
      showError("Mật khẩu mới phải có tối thiểu 8 ký tự");
      newInput?.focus();
      return;
    }

    const utf8ByteLength = new TextEncoder().encode(newPass).length;
    if (utf8ByteLength > 72) {
      showError("Mật khẩu quá dài (tối đa 72 byte)");
      newInput?.focus();
      return;
    }

    if (newPass === currentPass) {
      showError("Mật khẩu mới không được trùng mật khẩu hiện tại");
      newInput?.focus();
      return;
    }

    if (confirmPass !== newPass) {
      showError("Mật khẩu nhập lại không khớp");
      confirmInput?.focus();
      return;
    }

    // Gửi lên server
    submitBtn.disabled = true;
    submitBtn.textContent = "Đang xử lý…";

    try {
      const result = await sendJSON("POST", "/auth/change-password", {
        current_password: currentPass,
        new_password: newPass,
      });

      // Cập nhật access token mới trong bộ nhớ phiên hiện tại mà không đăng xuất
      if (result.access_token) {
        setAccessToken(result.access_token, result.expires_in, false);
      }

      const cb = forcedOnSuccessCallback;
      // Tắt chế độ forced trước khi đóng modal
      isForcedMode = false;
      forcedOnSuccessCallback = null;

      // Đóng modal
      closeChangePasswordDialog();

      if (typeof cb === "function") {
        try {
          cb();
        } catch (_) {}
      }

      // Thông báo toast thành công
      toast("Đã đổi mật khẩu. Các thiết bị khác sẽ bị đăng xuất.", "success");
    } catch (err) {
      // Hiển thị lỗi từ server ngay trong dialog bằng textContent
      showError(err.message || "Không thể đổi mật khẩu, vui lòng thử lại");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = isForcedMode ? "Đổi mật khẩu" : "Xác nhận đổi";
    }
  });

  const closeBtn = el("button", {
    id: "change-pw-close-btn",
    type: "button",
    class: "icon-btn dialog-close-btn",
    "aria-label": "Đóng hộp thoại",
    onclick: () => {
      if (!isForcedMode) {
        closeChangePasswordDialog();
      }
    },
  }, createSvg("close", 18, 18));

  // 6. Thẻ Dialog
  changePasswordDialog = el("dialog", {
    id: "change-password-dialog",
    class: "custom-dialog change-password-dialog",
    "aria-labelledby": "change-pw-dialog-title",
  },
    el("div", { class: "dialog-card" },
      el("div", { class: "dialog-header" },
        el("div", { style: "display: flex; align-items: center; gap: 8px;" },
          createSvg("lock", 20, 20),
          el("h3", { id: "change-pw-dialog-title", class: "dialog-title" }, "Đổi mật khẩu")
        ),
        closeBtn
      ),
      form
    )
  );

  // Xử lý Focus Trap và đóng bằng phím Escape
  changePasswordDialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (!isForcedMode) {
        closeChangePasswordDialog();
      }
      return;
    }

    if (e.key === "Tab") {
      const focusableEls = changePasswordDialog.querySelectorAll(
        'button:not([hidden]):not([style*="display: none"]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusableEls.length === 0) return;

      const firstEl = focusableEls[0];
      const lastEl = focusableEls[focusableEls.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }
  });

  // Chặn phím Esc tự đóng bởi browser cancel event trên thẻ dialog khi đang ở chế độ forced
  changePasswordDialog.addEventListener("cancel", (e) => {
    if (isForcedMode) {
      e.preventDefault();
    }
  });

  // Chặn đóng khi bấm nền nếu đang ở chế độ forced
  changePasswordDialog.addEventListener("click", (e) => {
    if (e.target === changePasswordDialog && isForcedMode) {
      e.stopPropagation();
    }
  });

  document.body.append(changePasswordDialog);
  return changePasswordDialog;
}

/**
 * Mở modal Đổi mật khẩu
 * Hỗ trợ cả hai chữ ký: openChangePasswordDialog(triggerEl) hoặc openChangePasswordDialog({ forced: true, triggerEl, onSuccess })
 * @param {HTMLElement|Object|null} triggerElOrOptions - Nút mở hoặc object cấu hình options
 * @param {Object} maybeOptions - Cấu hình phụ khi đối số 1 là HTMLElement
 */
export function openChangePasswordDialog(triggerElOrOptions = null, maybeOptions = {}) {
  let triggerEl = null;
  let options = {};

  if (triggerElOrOptions instanceof HTMLElement) {
    triggerEl = triggerElOrOptions;
    options = maybeOptions || {};
  } else if (triggerElOrOptions && typeof triggerElOrOptions === "object") {
    options = triggerElOrOptions;
    triggerEl = options.triggerEl || null;
  }

  isForcedMode = Boolean(options.forced);
  forcedOnSuccessCallback = typeof options.onSuccess === "function" ? options.onSuccess : null;

  lastTriggerElement = triggerEl || document.activeElement;
  const dialog = ensureDialogCreated();

  // Reset form và ẩn error box
  const form = $("#change-password-form");
  if (form) form.reset();

  const errorBox = $("#change-pw-error-box");
  if (errorBox) errorBox.hidden = true;

  const forcedNotice = $("#change-pw-forced-notice");
  if (forcedNotice) {
    forcedNotice.hidden = !isForcedMode;
  }

  const closeBtn = $("#change-pw-close-btn");
  if (closeBtn) {
    closeBtn.hidden = isForcedMode;
    closeBtn.style.display = isForcedMode ? "none" : "";
  }

  const cancelBtn = $("#change-pw-cancel-btn");
  if (cancelBtn) {
    cancelBtn.textContent = isForcedMode ? "Đăng xuất" : "Hủy";
  }

  const submitBtn = $("#change-pw-submit-btn");
  if (submitBtn) {
    submitBtn.textContent = isForcedMode ? "Đổi mật khẩu" : "Xác nhận đổi";
  }

  // Đặt lại các nút ẩn/hiện password về trạng thái mặc định (password)
  dialog.querySelectorAll(".password-input").forEach((inp) => {
    inp.type = "password";
  });
  dialog.querySelectorAll(".password-toggle-btn").forEach((btn) => {
    btn.replaceChildren(createSvg("eye", 16, 16));
  });

  if (!dialog.open) {
    dialog.showModal();
  }

  // Tự động focus vào ô mật khẩu hiện tại
  setTimeout(() => {
    const currentInput = $("#change-pw-current");
    if (currentInput) currentInput.focus();
  }, 50);
}

/**
 * Đóng modal Đổi mật khẩu và trả lại focus (không đóng nếu đang ở chế độ forced)
 */
export function closeChangePasswordDialog() {
  if (isForcedMode) return;
  if (changePasswordDialog && changePasswordDialog.open) {
    changePasswordDialog.close();
  }
  if (lastTriggerElement && typeof lastTriggerElement.focus === "function") {
    lastTriggerElement.focus();
  }
}
