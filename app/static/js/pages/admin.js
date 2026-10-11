import { requireAdmin } from "../core/auth.js";
import { api } from "../core/api.js";
import { $, $$ } from "../ui/dom.js";
import { renderSidebar, setSidebarActiveTab, updateSidebarBadge } from "../ui/sidebar.js";

import { loadDashboard } from "../admin/dashboard.js?v=ui1";
import { loadUsers, initUsersEvents } from "../admin/users.js";
import { loadDocuments, stopDocumentsTimer, initDocumentsEvents } from "../admin/documents.js";
import { loadUnanswered, initUnansweredEvents } from "../admin/unanswered.js";

let me = null;

const VALID_TABS = ["dashboard", "users", "documents", "unanswered"];

// Xử lý chuyển tab quản trị theo hash của URL
async function handleAdminRoute() {
  const hash = window.location.hash || "#/dashboard";
  const [tabPath] = hash.replace("#/", "").split("?");
  let tabName = tabPath;

  if (!VALID_TABS.includes(tabName)) {
    tabName = "dashboard";
    window.location.hash = "#/dashboard";
    return;
  }

  // Tắt timer tự động của documents nếu chuyển sang tab khác
  if (tabName !== "documents") {
    stopDocumentsTimer();
  }

  // Cập nhật active tab trong sidebar
  setSidebarActiveTab(tabName);

  // Ẩn tất cả các tab panel, chỉ hiện tab tương ứng
  $$(".admin-page").forEach((p) => {
    p.hidden = p.id !== `tab-${tabName}`;
  });

  // Gọi hàm load dữ liệu của tab đó
  switch (tabName) {
    case "dashboard":
      await loadDashboard();
      break;
    case "users":
      await loadUsers(me);
      break;
    case "documents":
      await loadDocuments();
      break;
    case "unanswered":
      await loadUnanswered();
      break;
  }
}

// Đồng bộ số câu hỏi chưa trả lời với badge trên sidebar
async function syncUnansweredBadge() {
  try {
    const openRows = await api("/admin/unanswered?status=open");
    updateSidebarBadge(openRows.length);
  } catch (err) {
    console.error("Lỗi đồng bộ badge câu hỏi chưa trả lời:", err);
  }
}

// Khởi tạo trang Quản trị Admin
async function initAdminPage() {
  // Kiểm tra quyền Admin (nếu không phải admin sẽ tự chuyển về / hoặc /login)
  me = await requireAdmin();
  if (!me) return;

  // Dựng sidebar dùng chung loại "admin"
  renderSidebar({
    type: "admin",
    user: me,
  });

  // Khởi tạo các sự kiện tĩnh của từng trang con
  initUsersEvents(me);
  initDocumentsEvents();
  initUnansweredEvents();

  // Đồng bộ badge số câu hỏi chưa xử lý
  syncUnansweredBadge();

  // Lắng nghe thay đổi hash và thực hiện route ban đầu
  window.addEventListener("hashchange", handleAdminRoute);
  await handleAdminRoute();
}

initAdminPage();
