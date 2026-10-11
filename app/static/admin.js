/* ==========================================================================
   RAG Assistant - Admin Console Module
   Overview KPI & Charts, Users Management, Master-Detail Documents, Unanswered
   Strictly XSS-Safe (No innerHTML for server data)
   ========================================================================== */

let adminTimer = null;
let currentAdminTab = "dashboard";
let selectedDocId = null;
let docChunksOffset = 0;
const CHUNKS_PER_PAGE = 10;

// Cached users list for client-side search & filter
let cachedUsers = [];
let userSearchFilter = "";
let userStatusFilter = "all";

// Status mappings
const STATUS_LABEL = {
  pending: "Đang chờ",
  processing: "Đang xử lý",
  done: "Hoàn tất",
  failed: "Lỗi",
};

const REASON_LABEL = {
  low_score: "Không tìm thấy đoạn phù hợp",
  llm_not_found: "Có đoạn gần đúng nhưng chưa đủ để trả lời",
};

/* ---------- Global Tab Switcher ---------- */
window.switchAdminTab = function(name) {
  clearTimeout(adminTimer);
  currentAdminTab = name;

  const loaders = {
    dashboard: loadDashboard,
    users: loadUsers,
    documents: loadDocs,
    unanswered: loadUnanswered,
  };

  if (loaders[name]) {
    loaders[name]();
  }
};

window.adminClose = function() {
  clearTimeout(adminTimer);
};

window.syncAdminBadge = async function() {
  try {
    const rows = await api("/admin/unanswered?status=open");
    if (window.updateSidebarBadge) {
      window.updateSidebarBadge(rows.length);
    }
  } catch (err) {
    console.error("Failed to sync unanswered badge:", err);
  }
};

/* ==========================================================================
   1. TỔNG QUAN (DASHBOARD)
   ========================================================================== */
async function loadDashboard() {
  const container = $("#dashboard-content");
  container.replaceChildren(el("div", { class: "loading-state" }, "Đang tải dữ liệu tổng quan…"));

  try {
    // Fetch stats and documents (for failed docs count) in parallel
    const [stats, docs] = await Promise.all([
      api("/admin/stats?days=14"),
      api("/documents"),
    ]);

    const t = stats.totals;

    // Update unanswered badge
    if (window.updateSidebarBadge) {
      window.updateSidebarBadge(t.unanswered_open);
    }

    // Failed docs count
    const failedDocs = docs.filter((d) => d.status === "failed");

    // 1. KPI Cards Grid
    const kpiGrid = el("div", { class: "kpi-cards-grid" },
      el("div", { class: "card kpi-card" },
        el("div", { class: "kpi-value" }, `${t.users_active} / ${t.users}`),
        el("div", { class: "kpi-label" }, "Người dùng hoạt động"),
        el("div", { class: "kpi-note" }, "đang hoạt động / tổng tài khoản")
      ),
      el("div", { class: "card kpi-card" },
        el("div", { class: "kpi-value" }, String(t.documents_done)),
        el("div", { class: "kpi-label" }, "Tài liệu hoàn tất"),
        el("div", { class: "kpi-note" }, `hoàn tất trên ${t.documents} tài liệu · ${fmtNum(t.chunks)} đoạn`)
      ),
      el("div", { class: "card kpi-card" },
        el("div", { class: "kpi-value" }, String(t.questions_today)),
        el("div", { class: "kpi-label" }, "Câu hỏi hôm nay"),
        el("div", { class: "kpi-note" }, `tổng cộng ${fmtNum(t.questions)} câu hỏi`)
      ),
      el("div", { class: "card kpi-card" },
        el("div", { class: `kpi-value ${t.unanswered_open > 0 ? "kpi-warning" : ""}` }, String(t.unanswered_open)),
        el("div", { class: "kpi-label" }, "Chưa trả lời được"),
        el("div", { class: "kpi-note" }, "câu hỏi đang chờ xử lý")
      )
    );

    // 2. Khung "Cần xử lý"
    const actionItems = [];

    if (t.unanswered_open > 0) {
      actionItems.push(
        el("div", { class: "action-item-row" },
          el("div", { class: "action-item-left" },
            el("span", { class: "action-item-icon" }, createSvg("alert", 16, 16)),
            el("span", {}, `Có ${t.unanswered_open} câu hỏi chưa trả lời cần bổ sung tài liệu`)
          ),
          el("a", { href: "#/admin/unanswered", class: "btn btn-outline btn-sm action-item-btn" }, "Xem danh sách →")
        )
      );
    }

    if (failedDocs.length > 0) {
      actionItems.push(
        el("div", { class: "action-item-row" },
          el("div", { class: "action-item-left" },
            el("span", { class: "action-item-icon error" }, createSvg("alert", 16, 16)),
            el("span", {}, `Có ${failedDocs.length} tài liệu bị lỗi trong quá trình xử lý`)
          ),
          el("a", { href: "#/admin/documents", class: "btn btn-outline btn-sm action-item-btn" }, "Kiểm tra tài liệu →")
        )
      );
    }

    const actionCard = el("div", { class: "card action-needed-card" },
      el("div", { class: "card-header" },
        el("div", { class: "card-title" }, "Cần xử lý"),
        el("div", { class: "card-subtitle" }, actionItems.length > 0 ? `${actionItems.length} việc cần giải quyết` : "")
      ),
      actionItems.length > 0
        ? el("div", { class: "action-items-list" }, ...actionItems)
        : el("div", { class: "action-empty-state" },
            createSvg("check", 16, 16),
            el("span", {}, "Không có việc cần xử lý")
          )
    );

    // 3. Biểu đồ cột: "Số câu hỏi mỗi ngày" (CSS Flex thuần)
    const maxQuestions = Math.max(1, ...stats.daily.map((d) => d.questions));
    const bars = stats.daily.map((d) => {
      const heightPx = Math.max(2, Math.round((d.questions / maxQuestions) * 115));
      const dateLabel = d.date.slice(8) + "/" + d.date.slice(5, 7);
      const tooltip = `${d.date}: ${d.questions} câu hỏi, ${d.active_users} người dùng hoạt động`;

      return el("div", { class: "chart-col" },
        el("div", { class: "chart-val" }, d.questions > 0 ? String(d.questions) : ""),
        el("div", {
          class: "chart-bar",
          style: `height: ${heightPx}px`,
          title: tooltip,
        }),
        el("div", { class: "chart-label" }, dateLabel)
      );
    });

    const chartCard = el("div", { class: "card chart-card" },
      el("div", { class: "card-header" },
        el("div", { class: "card-title" }, `Số câu hỏi mỗi ngày (${stats.days} ngày gần nhất)`),
        el("div", { class: "card-subtitle" }, `Đỉnh điểm: ${maxQuestions} câu/ngày`)
      ),
      el("div", { class: "chart-bars-wrap" }, ...bars)
    );

    // 4. Row 2 cột: Tài liệu trích dẫn nhiều nhất & Lượng token
    const maxCitations = Math.max(1, ...stats.top_documents.map((d) => d.citations));
    const citationRows = stats.top_documents.length > 0
      ? stats.top_documents.map((d) => {
          const fillPct = Math.round((d.citations / maxCitations) * 100);
          return el("div", { class: "citation-item" },
            el("div", { class: "citation-header" },
              el("span", { class: "citation-name", title: d.filename }, d.filename),
              el("span", { class: "citation-count" }, `${d.citations} lượt`)
            ),
            el("div", { class: "citation-bar-track" },
              el("div", { class: "citation-bar-fill", style: `width: ${fillPct}%` })
            )
          );
        })
      : [el("div", { class: "loading-state" }, "Chưa có dữ liệu trích dẫn tài liệu.")];

    const citationsCard = el("div", { class: "card" },
      el("div", { class: "card-header" },
        el("div", { class: "card-title" }, "Tài liệu được trích dẫn nhiều nhất")
      ),
      el("div", { class: "citation-list" }, ...citationRows)
    );

    const tk = stats.tokens;
    const tokensCard = el("div", { class: "card" },
      el("div", { class: "card-header" },
        el("div", { class: "card-title" }, "Lượng token")
      ),
      el("div", { class: "tokens-stats-list" },
        el("div", { class: "token-stat-item" },
          el("div", { class: "token-stat-label" }, `14 ngày gần nhất`),
          el("div", { class: "token-stat-vals" },
            `${fmtNum(tk.period.prompt)} đầu vào · ${fmtNum(tk.period.completion)} đầu ra `,
            el("strong", {}, `(tổng ${fmtNum(tk.period.prompt + tk.period.completion)})`)
          )
        ),
        el("div", { class: "token-stat-item" },
          el("div", { class: "token-stat-label" }, `Hôm nay`),
          el("div", { class: "token-stat-vals" },
            `${fmtNum(tk.today.prompt)} đầu vào · ${fmtNum(tk.today.completion)} đầu ra `,
            el("strong", {}, `(tổng ${fmtNum(tk.today.prompt + tk.today.completion)})`)
          )
        )
      ),
      el("p", { class: "kpi-note", style: "margin-top: 14px;" },
        "Số liệu chỉ tính các câu hỏi gửi sau khi bật thống kê token."
      )
    );

    const twoColRow = el("div", { class: "dashboard-row" }, citationsCard, tokensCard);

    container.replaceChildren(kpiGrid, actionCard, chartCard, twoColRow);
  } catch (err) {
    container.replaceChildren(el("div", { class: "alert-banner alert-danger" }, err.message));
  }
}

/* ==========================================================================
   2. NGƯỜI DÙNG (USERS)
   ========================================================================== */
async function loadUsers() {
  const tbody = $("#users-tbody");
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

function renderUsersTable() {
  const tbody = $("#users-tbody");
  const activeCount = cachedUsers.filter((u) => u.is_active).length;

  $("#users-subtitle").textContent = `${cachedUsers.length} tài khoản · ${activeCount} đang hoạt động`;

  // Filter clientside
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

function createUserRow(u) {
  const isSelf = me && u.id === me.id;

  // Role select dropdown
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

  // Status pill
  const statusPill = u.is_active
    ? el("span", { class: "pill pill-success" }, "Hoạt động")
    : el("span", { class: "pill pill-danger" }, "Đã khóa");

  // Limit cell
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

  // Today / Total questions cell with progress bar
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

  // Actions
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

  const tr = el("tr", { class: u.is_active ? "" : "row-inactive" },
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

  return tr;
}

// Search & Filter event bindings
const userSearchInput = $("#user-search-input");
if (userSearchInput) {
  userSearchInput.addEventListener("input", (e) => {
    userSearchFilter = e.target.value.trim();
    renderUsersTable();
  });
}

$$(".filter-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".filter-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    userStatusFilter = tab.dataset.filter;
    renderUsersTable();
  });
});

// Create User Modal logic
const openCreateUserModalBtn = $("#open-create-user-modal-btn");
const createUserDialog = $("#create-user-dialog");
const createUserForm = $("#create-user-form");

if (openCreateUserModalBtn) {
  openCreateUserModalBtn.addEventListener("click", () => {
    createUserForm.reset();
    openCustomDialog(createUserDialog, openCreateUserModalBtn);
  });
}

if (createUserForm) {
  createUserForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#create-user-email").value.trim();
    const password = $("#create-user-password").value;
    const role = $("#create-user-role").value;
    const limitVal = $("#create-user-limit").value.trim();
    const daily_limit = limitVal === "" ? null : Number(limitVal);

    try {
      await sendJSON("POST", "/admin/users", { email, password, role, daily_limit });
      closeCustomDialog(createUserDialog);
      toast("Đã tạo tài khoản thành công", "success");
      await loadUsers();
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

// Reset Password Modal logic
const resetPasswordDialog = $("#reset-password-dialog");
const resetPasswordForm = $("#reset-password-form");
let targetUserForReset = null;

function openResetPasswordDialog(u) {
  targetUserForReset = u;
  resetPasswordForm.reset();
  $("#reset-password-target-desc").textContent = `Đặt mật khẩu mới cho tài khoản: ${u.email}`;
  openCustomDialog(resetPasswordDialog);
}

if (resetPasswordForm) {
  resetPasswordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!targetUserForReset) return;
    const password = $("#reset-new-password").value;

    try {
      await sendJSON("POST", `/admin/users/${targetUserForReset.id}/reset-password`, { password });
      closeCustomDialog(resetPasswordDialog);
      toast("Đã đặt lại mật khẩu thành công", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

/* ==========================================================================
   3. TÀI LIỆU (DOCUMENTS - MASTER/DETAIL)
   ========================================================================== */
async function loadDocs() {
  clearTimeout(adminTimer);
  const container = $("#doc-items-container");

  try {
    const docs = await api("/documents");
    $("#doc-list-count").textContent = `${docs.length} tài liệu`;

    // Banner check for failed docs
    const failedDocs = docs.filter((d) => d.status === "failed");
    const banner = $("#docs-error-banner");
    if (failedDocs.length > 0) {
      banner.hidden = false;
      $("#docs-error-banner-text").textContent =
        `Có ${failedDocs.length} tài liệu bị lỗi trong quá trình xử lý. Vui lòng kiểm tra và xử lý lại.`;
    } else {
      banner.hidden = true;
    }

    if (docs.length === 0) {
      container.replaceChildren(
        el("div", { class: "loading-state" }, "Chưa có tài liệu nào trong hệ thống.")
      );
      selectDocument(null);
      return;
    }

    container.replaceChildren(...docs.map(createDocListItem));

    // Keep active selection or select first
    if (!selectedDocId || !docs.some((d) => d.id === selectedDocId)) {
      selectDocument(docs[0].id);
    } else {
      selectDocument(selectedDocId);
    }

    // Auto-refresh if any doc is busy
    const isBusy = docs.some((d) => d.status === "pending" || d.status === "processing");
    if (isBusy && currentAdminTab === "documents" && !$("#admin-view").hidden) {
      adminTimer = setTimeout(loadDocs, 3000);
    }
  } catch (err) {
    toast(err.message, "error");
  }
}

function createDocListItem(d) {
  const isSelected = d.id === selectedDocId;
  const statusLabel = STATUS_LABEL[d.status] || d.status;

  let pillClass = "pill-neutral";
  if (d.status === "done") pillClass = "pill-success";
  else if (d.status === "processing") pillClass = "pill-accent";
  else if (d.status === "failed") pillClass = "pill-danger";

  const row = el("div", {
    class: `doc-item-row ${isSelected ? "active" : ""}`,
    onclick: () => {
      selectDocument(d.id);
      // On mobile, switch to detail view
      const masterDetail = $("#doc-master-detail");
      masterDetail.classList.remove("mobile-list-mode");
      masterDetail.classList.add("mobile-detail-mode");
    },
  },
    el("div", { class: "doc-item-top" },
      el("span", { class: "doc-item-filename", title: d.filename }, d.filename),
      el("span", { class: `pill ${pillClass}` }, statusLabel)
    ),
    el("div", { class: "doc-item-bottom" },
      el("span", {}, `${d.chunks ?? 0} đoạn`),
      el("span", {}, d.is_active ? "Đang bật" : "Đã tắt")
    )
  );

  return row;
}

async function selectDocument(id) {
  selectedDocId = id;
  docChunksOffset = 0;

  // Highlight in list
  $$(".doc-item-row").forEach((row) => {
    // Determine active by order or attributes
  });

  const emptyView = $("#doc-detail-empty");
  const contentView = $("#doc-detail-content");

  if (!id) {
    emptyView.hidden = false;
    contentView.hidden = true;
    return;
  }

  emptyView.hidden = true;
  contentView.hidden = false;

  await loadDocumentDetails(id);
}

async function loadDocumentDetails(id) {
  try {
    const doc = await api(`/documents/${id}`);

    // Update title
    $("#doc-detail-filename").textContent = doc.filename;

    // Update tags
    const metaContainer = $("#doc-detail-meta");
    metaContainer.replaceChildren();

    const statusPill = el("span", {
      class: `pill ${doc.status === "done" ? "pill-success" : doc.status === "failed" ? "pill-danger" : "pill-accent"}`,
    }, STATUS_LABEL[doc.status] || doc.status);

    const activePill = el("span", {
      class: `pill ${doc.is_active ? "pill-neutral" : "pill-danger"}`,
    }, doc.is_active ? "Đang bật" : "Đã tắt");

    const chunksCountBadge = el("span", { class: "pill pill-neutral" }, `${doc.chunks ?? 0} đoạn`);
    const dateBadge = el("span", { class: "kpi-note" }, `Tải lên: ${fmtTime(doc.created_at)}`);

    metaContainer.append(statusPill, activePill, chunksCountBadge, dateBadge);

    // Update Actions
    const isBusy = doc.status === "pending" || doc.status === "processing";
    const reprocessBtn = $("#doc-reprocess-btn");
    reprocessBtn.disabled = isBusy;
    reprocessBtn.onclick = async () => {
      try {
        await api(`/documents/${doc.id}/reprocess`, { method: "POST" });
        toast("Đã đưa tài liệu vào hàng đợi xử lý lại", "success");
        await loadDocs();
      } catch (err) {
        toast(err.message, "error");
      }
    };

    const toggleBtn = $("#doc-toggle-active-btn");
    toggleBtn.textContent = doc.is_active ? "Tắt" : "Bật";
    toggleBtn.onclick = async () => {
      try {
        await sendJSON("PATCH", `/documents/${doc.id}`, { is_active: !doc.is_active });
        toast(doc.is_active ? "Đã tắt tài liệu" : "Đã bật tài liệu", "success");
        await loadDocs();
      } catch (err) {
        toast(err.message, "error");
      }
    };

    const deleteBtn = $("#doc-delete-btn");
    deleteBtn.onclick = () => {
      showConfirmDialog({
        title: "Xác nhận xóa tài liệu",
        message: `Bạn có chắc muốn xóa tài liệu "${doc.filename}" cùng toàn bộ các đoạn đã tách?`,
        okText: "Xóa tài liệu",
        isDanger: true,
        onConfirm: async () => {
          try {
            await api(`/documents/${doc.id}`, { method: "DELETE" });
            toast("Đã xóa tài liệu", "success");
            selectedDocId = null;
            await loadDocs();
          } catch (err) {
            toast(err.message, "error");
          }
        },
      });
    };

    // Error alert
    const errorBox = $("#doc-error-box");
    if (doc.status === "failed" && doc.error) {
      errorBox.hidden = false;
      $("#doc-error-box-text").textContent = `Lỗi xử lý: ${doc.error}`;
    } else {
      errorBox.hidden = true;
    }

    // Load chunks
    await loadDocumentChunks(id, docChunksOffset);
  } catch (err) {
    toast(err.message, "error");
  }
}

async function loadDocumentChunks(id, offset) {
  docChunksOffset = offset;
  const list = $("#chunks-list");
  list.replaceChildren(el("div", { class: "loading-state" }, "Đang tải các đoạn đã tách…"));

  try {
    const data = await api(`/documents/${id}/chunks?limit=${CHUNKS_PER_PAGE}&offset=${offset}`);
    const total = data.total;

    // Range label
    const start = total === 0 ? 0 : offset + 1;
    const end = Math.min(offset + CHUNKS_PER_PAGE, total);
    $("#chunks-range-label").textContent = `${start}–${end} / ${total} đoạn`;

    // Page indicator
    const currentPage = total === 0 ? 1 : Math.floor(offset / CHUNKS_PER_PAGE) + 1;
    const totalPages = Math.max(1, Math.ceil(total / CHUNKS_PER_PAGE));
    $("#chunks-page-indicator").textContent = `Trang ${currentPage} / ${totalPages}`;

    // Pagination buttons
    const prevBtn = $("#chunks-prev-btn");
    const nextBtn = $("#chunks-next-btn");

    prevBtn.disabled = offset === 0;
    prevBtn.onclick = () => loadDocumentChunks(id, Math.max(0, offset - CHUNKS_PER_PAGE));

    nextBtn.disabled = offset + CHUNKS_PER_PAGE >= total;
    nextBtn.onclick = () => loadDocumentChunks(id, offset + CHUNKS_PER_PAGE);

    if (data.items.length === 0) {
      list.replaceChildren(
        el("div", { class: "loading-state" },
          total === 0
            ? "Tài liệu chưa có đoạn nào (đang xử lý hoặc bị lỗi)."
            : "Không có đoạn nào ở trang này."
        )
      );
      return;
    }

    list.replaceChildren(
      ...data.items.map((c) =>
        el("div", { class: "chunk-card" },
          el("div", { class: "chunk-meta" },
            `Đoạn #${c.id}` + (c.page ? ` · Trang ${c.page}` : "")
          ),
          el("div", { class: "chunk-text" }, c.content)
        )
      )
    );
  } catch (err) {
    list.replaceChildren(el("div", { class: "alert-banner alert-danger" }, err.message));
  }
}

// Mobile Back button in Documents view
const docBackBtn = $("#doc-back-btn");
if (docBackBtn) {
  docBackBtn.addEventListener("click", () => {
    const masterDetail = $("#doc-master-detail");
    masterDetail.classList.remove("mobile-detail-mode");
    masterDetail.classList.add("mobile-list-mode");
  });
}

// Upload Modal Logic
const openUploadModalBtn = $("#open-upload-modal-btn");
const uploadDialog = $("#upload-dialog");
const uploadDialogForm = $("#upload-dialog-form");
const uploadFileInput = $("#upload-file-input");
const uploadFileSelectedName = $("#upload-file-selected-name");
const uploadDialogStatus = $("#upload-dialog-status");
const uploadDropzone = $("#upload-dropzone");

if (openUploadModalBtn) {
  openUploadModalBtn.addEventListener("click", () => {
    uploadDialogForm.reset();
    uploadFileSelectedName.textContent = "";
    uploadDialogStatus.hidden = true;
    openCustomDialog(uploadDialog, openUploadModalBtn);
  });
}

if (uploadFileInput) {
  uploadFileInput.addEventListener("change", () => {
    const file = uploadFileInput.files[0];
    if (file) {
      uploadFileSelectedName.textContent = `${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`;
    } else {
      uploadFileSelectedName.textContent = "";
    }
  });
}

// Drag & Drop
if (uploadDropzone) {
  ["dragenter", "dragover"].forEach((eventName) => {
    uploadDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      uploadDropzone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    uploadDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      uploadDropzone.classList.remove("dragover");
    });
  });

  uploadDropzone.addEventListener("drop", (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files && files.length > 0) {
      uploadFileInput.files = files;
      uploadFileSelectedName.textContent = `${files[0].name} (${(files[0].size / (1024 * 1024)).toFixed(2)} MB)`;
    }
  });
}

if (uploadDialogForm) {
  uploadDialogForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = uploadFileInput.files[0];
    if (!file) return;

    const submitBtn = $("#upload-submit-btn");
    submitBtn.disabled = true;
    uploadDialogStatus.hidden = false;
    uploadDialogStatus.textContent = "Đang tải file lên máy chủ…";

    const form = new FormData();
    form.append("file", file);

    try {
      await api("/documents", { method: "POST", body: form });
      uploadDialogStatus.textContent = "Đã tải lên! Đang đóng...";
      toast("Đã tải lên tài liệu, hệ thống đang xử lý nền", "success");
      setTimeout(() => {
        closeCustomDialog(uploadDialog);
        loadDocs();
      }, 500);
    } catch (err) {
      uploadDialogStatus.textContent = err.message;
      toast(err.message, "error");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ==========================================================================
   4. CHƯA TRẢ LỜI ĐƯỢC (UNANSWERED QUESTIONS)
   ========================================================================== */
let unansweredFilterStatus = "open";

async function loadUnanswered() {
  const tbody = $("#unanswered-tbody");
  tbody.replaceChildren(
    el("tr", { class: "table-empty-row" },
      el("td", { colspan: "5" }, "Đang tải danh sách câu hỏi chưa trả lời…")
    )
  );

  try {
    const rows = await api(`/admin/unanswered?status=${unansweredFilterStatus}`);

    // Update sidebar badge if viewing open status
    if (unansweredFilterStatus === "open" && window.updateSidebarBadge) {
      window.updateSidebarBadge(rows.length);
    }

    if (rows.length === 0) {
      tbody.replaceChildren(
        el("tr", { class: "table-empty-row" },
          el("td", { colspan: "5" }, "Không có câu hỏi nào trong danh mục này.")
        )
      );
      return;
    }

    tbody.replaceChildren(...rows.map(createUnansweredRow));
  } catch (err) {
    toast(err.message, "error");
    tbody.replaceChildren(
      el("tr", { class: "table-empty-row" },
        el("td", { colspan: "5" }, err.message)
      )
    );
  }
}

function createUnansweredRow(q) {
  const reasonText = REASON_LABEL[q.reason] || q.reason;
  const scoreText = q.top_score != null ? q.top_score.toFixed(2) : "—";

  const toggleBtn = el("button", {
    class: "btn btn-outline btn-sm",
    onclick: async () => {
      try {
        await sendJSON("PATCH", `/admin/unanswered/${q.id}`, { resolved: !q.resolved });
        toast(q.resolved ? "Đã mở lại câu hỏi" : "Đã đánh dấu xử lý xong", "success");
        await loadUnanswered();
        if (window.syncAdminBadge) window.syncAdminBadge();
      } catch (err) {
        toast(err.message, "error");
      }
    },
  }, q.resolved ? "Mở lại" : "Đã xử lý");

  const deleteBtn = el("button", {
    class: "btn btn-danger-outline btn-sm",
    onclick: () => {
      showConfirmDialog({
        title: "Xác nhận xóa câu hỏi",
        message: "Xóa câu hỏi này khỏi danh sách câu hỏi chưa trả lời được?",
        okText: "Xóa",
        isDanger: true,
        onConfirm: async () => {
          try {
            await api(`/admin/unanswered/${q.id}`, { method: "DELETE" });
            toast("Đã xóa câu hỏi", "success");
            await loadUnanswered();
            if (window.syncAdminBadge) window.syncAdminBadge();
          } catch (err) {
            toast(err.message, "error");
          }
        },
      });
    },
  }, "Xóa");

  const tr = el("tr", { class: q.resolved ? "row-inactive" : "" },
    el("td", { class: "question-text-cell" }, q.question),
    el("td", {}, reasonText),
    el("td", { class: "score-cell" }, scoreText),
    el("td", {}, fmtTime(q.created_at)),
    el("td", { class: "col-actions" },
      el("div", { class: "actions-wrap" }, toggleBtn, deleteBtn)
    )
  );

  return tr;
}

// Unanswered status filter buttons
$$("#tab-unanswered .filter-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$("#tab-unanswered .filter-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    unansweredFilterStatus = tab.dataset.filter;
    loadUnanswered();
  });
});