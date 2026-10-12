import { api, sendJSON } from "../core/api.js";
import { el, $, $$ } from "../ui/dom.js";
import { fmtTime, fmtNum } from "../ui/format.js";
import { toast } from "../ui/toast.js";
import { openCustomDialog, closeCustomDialog, showConfirmDialog } from "../ui/dialog.js";

let cachedUsers = [];
let userSearchFilter = "";
let userStatusFilter = "all"; // "all" | "active" | "locked" | "trash"
let me = null;
let targetUserForReset = null;
let targetUserForPermanentDelete = null;

/** Tải số lượng tài khoản theo từng trạng thái và cập nhật lên các chip */
async function loadUsersCounts() {
  try {
    const counts = await api("/admin/users/counts");
    const setChip = (id, val) => {
      const span = $(`#chip-count-${id}`);
      if (span) span.textContent = `(${val})`;
    };
    setChip("all", counts.all);
    setChip("active", counts.active);
    setChip("locked", counts.locked);
    setChip("trash", counts.trash);
  } catch (err) {
    console.warn("Không thể tải số đếm người dùng:", err);
  }
}

/** Tải danh sách người dùng và vẽ bảng */
export async function loadUsers(currentUser = null) {
  if (currentUser) {
    me = currentUser;
  }

  const tbody = $("#users-tbody");
  if (!tbody) return;

  renderTableHeader();
  await loadUsersCounts();

  tbody.replaceChildren(
    el("tr", { class: "table-empty-row" },
      el("td", { colspan: userStatusFilter === "trash" ? "4" : "6" }, "Đang tải danh sách người dùng…")
    )
  );

  try {
    const viewParam = userStatusFilter === "trash" ? "trash" : "active";
    cachedUsers = await api(`/admin/users?view=${viewParam}`);
    renderUsersTable();
  } catch (err) {
    toast(err.message, "error");
    tbody.replaceChildren(
      el("tr", { class: "table-empty-row" },
        el("td", { colspan: userStatusFilter === "trash" ? "4" : "6" }, err.message)
      )
    );
  }
}

/** Vẽ tiêu đề bảng phù hợp theo chế độ thường hoặc thùng rác */
function renderTableHeader() {
  const thead = $("#users-thead");
  if (!thead) return;

  if (userStatusFilter === "trash") {
    thead.replaceChildren(
      el("tr", {},
        el("th", {}, "Email"),
        el("th", {}, "Vai trò"),
        el("th", {}, "Ngày xóa"),
        el("th", { class: "col-actions" }, "Thao tác")
      )
    );
  } else {
    thead.replaceChildren(
      el("tr", {},
        el("th", {}, "Email"),
        el("th", {}, "Vai trò"),
        el("th", {}, "Trạng thái"),
        el("th", {}, "Hạn mức/ngày"),
        el("th", {}, "Hôm nay / Tổng"),
        el("th", { class: "col-actions" }, "Thao tác")
      )
    );
  }
}

/** Lọc và hiển thị các dòng người dùng ra bảng */
function renderUsersTable() {
  const tbody = $("#users-tbody");
  if (!tbody) return;

  const colSpan = userStatusFilter === "trash" ? "4" : "6";
  const subtitle = $("#users-subtitle");

  // Lọc ở client theo ô tìm kiếm và trạng thái (nếu ở view active)
  const filtered = cachedUsers.filter((u) => {
    const matchSearch = !userSearchFilter || u.email.toLowerCase().includes(userSearchFilter.toLowerCase());
    if (userStatusFilter === "trash") return matchSearch;
    const matchStatus = userStatusFilter === "all"
      || (userStatusFilter === "active" && u.is_active)
      || (userStatusFilter === "locked" && !u.is_active);
    return matchSearch && matchStatus;
  });

  if (subtitle) {
    if (userStatusFilter === "trash") {
      subtitle.textContent = `${filtered.length} tài khoản trong thùng rác`;
    } else {
      const activeCount = cachedUsers.filter((u) => u.is_active).length;
      subtitle.textContent = `${cachedUsers.length} tài khoản · ${activeCount} đang hoạt động`;
    }
  }

  if (filtered.length === 0) {
    const emptyMsg = userStatusFilter === "trash"
      ? "Thùng rác đang trống."
      : "Không tìm thấy người dùng phù hợp.";
    tbody.replaceChildren(
      el("tr", { class: "table-empty-row" }, el("td", { colspan: colSpan }, emptyMsg))
    );
    return;
  }

  const rowBuilder = userStatusFilter === "trash" ? createTrashUserRow : createUserRow;
  tbody.replaceChildren(...filtered.map(rowBuilder));
}

/** Tạo hàng table cho tài khoản trong thùng rác */
function createTrashUserRow(u) {
  const isSelf = me && u.id === me.id;

  const restoreBtn = el("button", {
    class: "btn btn-outline btn-sm",
    title: "Khôi phục tài khoản",
    onclick: () => {
      showConfirmDialog({
        title: "Khôi phục tài khoản",
        message: `Khôi phục tài khoản ${u.email}? Tài khoản sẽ quay lại danh sách người dùng với trạng thái khóa/mở như trước.`,
        okText: "Khôi phục",
        onConfirm: async () => {
          try {
            await api(`/admin/users/${u.id}/restore`, { method: "POST" });
            toast("Đã khôi phục tài khoản thành công", "success");
            await loadUsers();
          } catch (err) {
            toast(err.message, "error");
          }
        },
      });
    },
  }, "Khôi phục");

  const permDeleteBtn = el("button", {
    class: "btn btn-danger-outline btn-sm",
    disabled: isSelf,
    title: "Xóa tài khoản vĩnh viễn",
    onclick: () => openPermanentDeleteDialog(u),
  }, "Xóa vĩnh viễn");

  return el("tr", { class: "row-inactive" },
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
    el("td", {},
      el("span", { class: "pill pill-neutral" }, u.role === "admin" ? "Quản trị viên" : "Người dùng")
    ),
    el("td", {},
      el("span", { class: "kpi-note" }, fmtTime(u.deleted_at))
    ),
    el("td", { class: "col-actions" },
      el("div", { class: "actions-wrap" }, restoreBtn, permDeleteBtn)
    )
  );
}

/** Tạo một hàng table cho tài khoản người dùng hoạt động bình thường */
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

  const statusWrap = el("div", { class: "status-cell-wrap" }, statusPill);
  if (u.must_change_password) {
    statusWrap.append(
      el("span", { class: "pill pill-warning", title: "Người dùng phải đổi mật khẩu ở lần đăng nhập tiếp theo" }, "Chờ đổi mật khẩu")
    );
  }

  // Ô hạn mức câu hỏi
  let limitCellContent;
  if (u.role === "admin") {
    limitCellContent = el("span", { class: "kpi-note" }, "Không giới hạn");
  } else {
    limitCellContent = el("input", {
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

  // Nút Khóa / Mở khóa
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

  // Nút Đặt lại mật khẩu
  const resetPwBtn = el("button", {
    class: "btn btn-outline btn-sm",
    title: "Đặt lại mật khẩu mới",
    onclick: () => openResetPasswordDialog(u),
  }, "Đặt lại MK");

  // Nút Chuyển vào thùng rác (xóa mềm lần 1)
  const trashBtn = el("button", {
    class: "btn btn-danger-outline btn-sm",
    disabled: isSelf,
    title: "Chuyển vào thùng rác",
    onclick: () => {
      showConfirmDialog({
        title: "Chuyển vào thùng rác",
        message: `Chuyển tài khoản ${u.email} vào thùng rác? Bạn có thể khôi phục tài khoản này bất cứ lúc nào.`,
        okText: "Chuyển vào thùng rác",
        isDanger: true,
        onConfirm: async () => {
          try {
            await api(`/admin/users/${u.id}`, { method: "DELETE" });
            toast("Đã chuyển tài khoản vào thùng rác", "success");
            await loadUsers();
          } catch (err) {
            toast(err.message, "error");
          }
        },
      });
    },
  }, "Chuyển vào thùng rác");

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
    el("td", {}, statusWrap),
    el("td", {}, limitCellContent),
    el("td", {}, questionsCell),
    el("td", { class: "col-actions" },
      el("div", { class: "actions-wrap" }, lockBtn, resetPwBtn, trashBtn)
    )
  );
}

/** Mở modal đặt lại mật khẩu cho user */
function openResetPasswordDialog(u) {
  targetUserForReset = u;
  const dialog = $("#reset-password-dialog");
  const form = $("#reset-password-form");
  const desc = $("#reset-password-target-desc");
  const reqChange = $("#reset-password-require-change");

  if (form) form.reset();
  if (reqChange) reqChange.checked = true;
  if (desc) desc.textContent = `Đặt mật khẩu mới cho tài khoản: ${u.email}`;
  openCustomDialog(dialog);
}

/** Mở modal xác nhận mạnh xóa vĩnh viễn tài khoản trong thùng rác */
function openPermanentDeleteDialog(u) {
  targetUserForPermanentDelete = u;
  const dialog = $("#permanent-delete-dialog");
  const form = $("#permanent-delete-form");
  const desc = $("#permanent-delete-desc");
  const targetEmailStrong = $("#permanent-delete-target-email");
  const confirmInput = $("#permanent-delete-confirm-input");
  const submitBtn = $("#permanent-delete-submit-btn");

  if (form) form.reset();
  if (desc) desc.textContent = `Tài khoản ${u.email} cùng toàn bộ hội thoại và tin nhắn sẽ bị xóa hoàn toàn.`;
  if (targetEmailStrong) targetEmailStrong.textContent = u.email;
  if (submitBtn) submitBtn.disabled = true;

  if (confirmInput) {
    confirmInput.value = "";
    confirmInput.oninput = () => {
      if (submitBtn) submitBtn.disabled = confirmInput.value.trim() !== u.email;
    };
  }

  openCustomDialog(dialog);
}

/** Gắn các sự kiện một lần cho trang Users (search, filters, modals) */
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
      tab.addEventListener("click", async () => {
        $$("#tab-users .filter-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        userStatusFilter = tab.dataset.filter;
        await loadUsers();
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
      const reqChange = $("#create-user-require-change");
      if (reqChange) reqChange.checked = true;
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
      const reqChangeEl = $("#create-user-require-change");
      const require_change = reqChangeEl ? reqChangeEl.checked : true;

      try {
        await sendJSON("POST", "/admin/users", { email, password, role, daily_limit, require_change });
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
      const reqChangeEl = $("#reset-password-require-change");
      const require_change = reqChangeEl ? reqChangeEl.checked : true;

      try {
        await sendJSON("POST", `/admin/users/${targetUserForReset.id}/reset-password`, { password, require_change });
        closeCustomDialog(resetDialog);
        toast("Đã đặt lại mật khẩu thành công", "success");
        await loadUsers();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }

  // 5. Modal xóa vĩnh viễn tài khoản trong thùng rác
  const permDeleteDialog = $("#permanent-delete-dialog");
  const permDeleteForm = $("#permanent-delete-form");

  if (permDeleteForm && !permDeleteForm.dataset.initialized) {
    permDeleteForm.dataset.initialized = "true";
    permDeleteForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!targetUserForPermanentDelete) return;
      const submitBtn = $("#permanent-delete-submit-btn");
      if (submitBtn) submitBtn.disabled = true;

      try {
        await api(`/admin/users/${targetUserForPermanentDelete.id}/permanent`, { method: "DELETE" });
        closeCustomDialog(permDeleteDialog);
        toast("Đã xóa vĩnh viễn tài khoản thành công", "success");
        await loadUsers();
      } catch (err) {
        toast(err.message, "error");
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }
}



