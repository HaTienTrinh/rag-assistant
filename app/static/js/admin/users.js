import { api, sendJSON } from "../core/api.js";
import { el, $, $$ } from "../ui/dom.js";
import { fmtTime, fmtNum } from "../ui/format.js";
import { toast } from "../ui/toast.js";
import { openCustomDialog, closeCustomDialog, showConfirmDialog } from "../ui/dialog.js";

let cachedUsers = [];
let userSearchFilter = "";
let userStatusFilter = "all";
let me = null;
let targetUserForReset = null;

/**
 * Tải danh sách người dùng và vẽ bảng
 * @param {Object} [currentUser] - Thông tin tài khoản admin đang đăng nhập
 */
export async function loadUsers(currentUser = null) {
  if (currentUser) {
    me = currentUser;
  }

  const tbody = $("#users-tbody");
  if (!tbody) return;

  tbody.replaceChildren(
    el("tr", { class: "table-empty-row" },
      el("td", { colspan: "6" }, "Đang tải danh sách người dùng…")
    )
  );

  try {
    cachedUsers = await api("/admin/users");
    renderUsersTable();
  } catch (err) {
    toast(err.message, "error");
    tbody.replaceChildren(
      el("tr", { class: "table-empty-row" },
        el("td", { colspan: "6" }, err.message)
      )
    );
  }
}

/**
 * Lọc và hiển thị các dòng người dùng ra bảng
 */
function renderUsersTable() {
  const tbody = $("#users-tbody");
  if (!tbody) return;

  const activeCount = cachedUsers.filter((u) => u.is_active).length;
  const subtitle = $("#users-subtitle");
  if (subtitle) {
    subtitle.textContent = `${cachedUsers.length} tài khoản · ${activeCount} đang hoạt động`;
  }

  // Lọc ở client
  const filtered = cachedUsers.filter((u) => {
    const matchSearch = !userSearchFilter || u.email.toLowerCase().includes(userSearchFilter.toLowerCase());
    const matchStatus = userStatusFilter === "all"
      || (userStatusFilter === "active" && u.is_active)
      || (userStatusFilter === "locked" && !u.is_active);
    return matchSearch && matchStatus;
  });

  if (filtered.length === 0) {
    tbody.replaceChildren(
      el("tr", { class: "table-empty-row" },
        el("td", { colspan: "6" }, "Không tìm thấy người dùng phù hợp.")
      )
    );
    return;
  }

  tbody.replaceChildren(...filtered.map(createUserRow));
}

/**
 * Tạo một hàng table cho tài khoản người dùng
 */
function createUserRow(u) {
  const isSelf = me && u.id === me.id;

  // Dropdown đổi vai trò (vô hiệu hóa với chính mình)
  const roleSelect = el("select", {
    class: "form-select",
    style: "width: auto; padding: 4px 8px; font-size: 13px;",
    disabled: isSelf,
    onchange: async (e) => {
      try {
        await sendJSON("PATCH", `/admin/users/${u.id}`, { role: e.target.value });
        toast("Đã cập nhật vai trò", "success");
        await loadUsers();
      } catch (err) {
        toast(err.message, "error");
        e.target.value = u.role;
      }
    },
  },
    el("option", { value: "user", selected: u.role === "user" }, "Người dùng"),
    el("option", { value: "admin", selected: u.role === "admin" }, "Admin")
  );

  // Pill trạng thái
  const statusPill = u.is_active
    ? el("span", { class: "pill pill-success" }, "Hoạt động")
    : el("span", { class: "pill pill-danger" }, "Đã khóa");

  // Ô hạn mức câu hỏi
  let limitCellContent;
  if (u.role === "admin") {
    limitCellContent = el("span", { class: "kpi-note" }, "Không giới hạn");
  } else {
    const limitInput = el("input", {
      type: "number",
      min: "1",
      class: "limit-input-inline",
      placeholder: `mặc định ${u.default_limit}`,
      value: u.daily_limit != null ? u.daily_limit : "",
      onchange: async (e) => {
        const val = e.target.value.trim();
        const limit = val === "" ? null : Number(val);
        try {
          await sendJSON("PATCH", `/admin/users/${u.id}`, { daily_limit: limit });
          toast("Đã cập nhật hạn mức câu hỏi", "success");
          await loadUsers();
        } catch (err) {
          toast(err.message, "error");
          e.target.value = u.daily_limit != null ? u.daily_limit : "";
        }
      },
    });
    limitCellContent = limitInput;
  }

  // Hôm nay / Tổng câu hỏi kèm thanh tiến độ
  const questionsCell = el("div", { class: "limit-cell" },
    el("span", { style: "font-weight: 500;" }, `${fmtNum(u.questions_today)} / ${fmtNum(u.questions_total)}`)
  );

  if (u.effective_limit) {
    const pct = Math.min(100, Math.round((u.questions_today / u.effective_limit) * 100));
    const isWarning = pct >= 80;
    const bar = el("div", { class: "limit-progress-track", title: `${pct}% hạn mức hôm nay` },
      el("div", {
        class: `limit-progress-fill ${isWarning ? "warning" : ""}`,
        style: `width: ${pct}%`,
      })
    );
    questionsCell.append(bar);
  }

  // Các nút thao tác
  const lockBtn = el("button", {
    class: "btn btn-outline btn-sm",
    disabled: isSelf,
    title: u.is_active ? "Khóa tài khoản" : "Mở khóa tài khoản",
    onclick: async () => {
      try {
        await sendJSON("PATCH", `/admin/users/${u.id}`, { is_active: !u.is_active });
        toast(u.is_active ? "Đã khóa tài khoản" : "Đã mở khóa tài khoản", "success");
        await loadUsers();
      } catch (err) {
        toast(err.message, "error");
      }
    },
  }, u.is_active ? "Khóa" : "Mở khóa");

  const resetPwBtn = el("button", {
    class: "btn btn-outline btn-sm",
    title: "Đặt lại mật khẩu mới",
    onclick: () => {
      openResetPasswordDialog(u);
    },
  }, "Đặt lại MK");

  const deleteBtn = el("button", {
    class: "btn btn-danger-outline btn-sm",
    disabled: isSelf,
    title: "Xóa tài khoản vĩnh viễn",
    onclick: () => {
      showConfirmDialog({
        title: "Xác nhận xóa tài khoản",
        message: `Xóa tài khoản ${u.email} và toàn bộ hội thoại của họ? Hành động này không thể hoàn tác.`,
        okText: "Xóa tài khoản",
        isDanger: true,
        onConfirm: async () => {
          try {
            await api(`/admin/users/${u.id}`, { method: "DELETE" });
            toast("Đã xóa tài khoản", "success");
            await loadUsers();
          } catch (err) {
            toast(err.message, "error");
          }
        },
      });
    },
  }, "Xóa");

  return el("tr", { class: u.is_active ? "" : "row-inactive" },
    el("td", {},
      el("div", { class: "user-cell" },
        el("div", { class: "user-cell-email" },
          u.email,
          isSelf ? el("span", { class: "user-self-badge" }, "(bạn)") : false
        ),
        el("div", { class: "user-cell-last-login" },
          `Đăng nhập gần nhất: ${fmtTime(u.last_login_at)}`
        )
      )
    ),
    el("td", {}, roleSelect),
    el("td", {}, statusPill),
    el("td", {}, limitCellContent),
    el("td", {}, questionsCell),
    el("td", { class: "col-actions" },
      el("div", { class: "actions-wrap" }, lockBtn, resetPwBtn, deleteBtn)
    )
  );
}

/**
 * Mở modal đặt lại mật khẩu cho user
 */
function openResetPasswordDialog(u) {
  targetUserForReset = u;
  const dialog = $("#reset-password-dialog");
  const form = $("#reset-password-form");
  const desc = $("#reset-password-target-desc");

  if (form) form.reset();
  if (desc) desc.textContent = `Đặt mật khẩu mới cho tài khoản: ${u.email}`;
  openCustomDialog(dialog);
}

/**
 * Gắn các sự kiện một lần cho trang Users (search, filters, modals)
 */
export function initUsersEvents(currentUser) {
  me = currentUser;

  // 1. Ô tìm kiếm email
  const searchInput = $("#user-search-input");
  if (searchInput && !searchInput.dataset.initialized) {
    searchInput.dataset.initialized = "true";
    searchInput.addEventListener("input", (e) => {
      userSearchFilter = e.target.value.trim();
      renderUsersTable();
    });
  }

  // 2. Các tab lọc trạng thái
  $$("#tab-users .filter-tab").forEach((tab) => {
    if (!tab.dataset.initialized) {
      tab.dataset.initialized = "true";
      tab.addEventListener("click", () => {
        $$("#tab-users .filter-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        userStatusFilter = tab.dataset.filter;
        renderUsersTable();
      });
    }
  });

  // 3. Modal tạo tài khoản mới
  const openCreateBtn = $("#open-create-user-modal-btn");
  const createDialog = $("#create-user-dialog");
  const createForm = $("#create-user-form");

  if (openCreateBtn && !openCreateBtn.dataset.initialized) {
    openCreateBtn.dataset.initialized = "true";
    openCreateBtn.addEventListener("click", () => {
      if (createForm) createForm.reset();
      openCustomDialog(createDialog, openCreateBtn);
    });
  }

  if (createForm && !createForm.dataset.initialized) {
    createForm.dataset.initialized = "true";
    createForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("#create-user-email").value.trim();
      const password = $("#create-user-password").value;
      const role = $("#create-user-role").value;
      const limitVal = $("#create-user-limit").value.trim();
      const daily_limit = limitVal === "" ? null : Number(limitVal);

      try {
        await sendJSON("POST", "/admin/users", { email, password, role, daily_limit });
        closeCustomDialog(createDialog);
        toast("Đã tạo tài khoản thành công", "success");
        await loadUsers();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }

  // 4. Modal đặt lại mật khẩu
  const resetDialog = $("#reset-password-dialog");
  const resetForm = $("#reset-password-form");

  if (resetForm && !resetForm.dataset.initialized) {
    resetForm.dataset.initialized = "true";
    resetForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!targetUserForReset) return;
      const password = $("#reset-new-password").value;

      try {
        await sendJSON("POST", `/admin/users/${targetUserForReset.id}/reset-password`, { password });
        closeCustomDialog(resetDialog);
        toast("Đã đặt lại mật khẩu thành công", "success");
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }
}
