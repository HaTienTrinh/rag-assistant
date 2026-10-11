import { el, $, $$ } from "./dom.js";
import { createSvg } from "./icons.js";
import { logout } from "../core/auth.js";
import { openChangePasswordDialog } from "./change-password.js";

/**
 * Khởi tạo hành vi Mobile Drawer (< 900px)
 */
export function initMobileDrawer() {
  const sidebar = $("#sidebar");
  const toggleBtn = $("#mobile-toggle-btn");
  const backdrop = $("#sidebar-backdrop");

  if (!sidebar || !toggleBtn || !backdrop) return;

  const openDrawer = () => {
    sidebar.classList.add("drawer-open");
    backdrop.hidden = false;
  };

  const closeDrawer = () => {
    sidebar.classList.remove("drawer-open");
    backdrop.hidden = true;
  };

  toggleBtn.addEventListener("click", openDrawer);
  backdrop.addEventListener("click", closeDrawer);

  return { openDrawer, closeDrawer };
}

/**
 * Cập nhật danh sách hội thoại trong sidebar (dành cho trang chat)
 */
export function updateSidebarConversations(conversations = [], activeConvId = null, onSelect, onDelete) {
  const ul = $("#conv-list");
  if (!ul) return;

  ul.replaceChildren();

  if (conversations.length === 0) {
    ul.append(el("li", { class: "conv-list-empty" }, "Chưa có hội thoại nào"));
    return;
  }

  for (const c of conversations) {
    const isActive = c.id === activeConvId;
    const li = el("li", {
      class: `conv-item ${isActive ? "active" : ""}`,
      onclick: () => {
        if (typeof onSelect === "function") {
          onSelect(c.id);
        }
      },
    });

    if (isActive) {
      li.setAttribute("aria-current", "page");
    }

    const titleSpan = el("span", { class: "conv-item-title", title: c.title }, c.title);

    const delBtn = el("button", {
      class: "conv-item-del-btn",
      "aria-label": `Xóa hội thoại ${c.title}`,
      title: "Xóa hội thoại",
      onclick: (e) => {
        e.stopPropagation();
        if (typeof onDelete === "function") {
          onDelete(c);
        }
      },
    }, "×");

    li.append(titleSpan, delBtn);
    ul.append(li);
  }
}

/**
 * Cập nhật số câu hỏi chưa xử lý trên badge của sidebar
 */
export function updateSidebarBadge(count = 0) {
  const badge = $("#sidebar-unanswered-badge");
  if (!badge) return;

  badge.textContent = String(count);
  badge.hidden = !count || count <= 0;
}

/**
 * Đặt mục điều hướng đang hoạt động trong sidebar admin
 */
export function setSidebarActiveTab(tabName) {
  $$(".admin-nav .nav-item").forEach((item) => {
    const isCurrent = item.dataset.tab === tabName;
    item.classList.toggle("active", isCurrent);
    if (isCurrent) {
      item.setAttribute("aria-current", "page");
    } else {
      item.removeAttribute("aria-current");
    }
  });
}

/**
 * Dựng toàn bộ nội dung của Sidebar bằng DOM API
 * @param {Object} options
 * @param {HTMLElement} [options.container] - Thẻ <aside id="sidebar">
 * @param {"chat"|"admin"} options.type - Loại trang: "chat" hoặc "admin"
 * @param {Object} options.user - Thông tin user { id, email, role }
 * @param {Function} [options.onNewChat] - Callback khi bấm nút tạo hội thoại mới
 */
export function renderSidebar({
  container = $("#sidebar"),
  type = "chat",
  user,
  onNewChat,
}) {
  if (!container || !user) return;

  container.replaceChildren();

  // 1. Thương hiệu (Brand)
  const isUserAdmin = user.role === "admin";
  const brandTitleText = type === "admin"
    ? "RAG Admin"
    : (isUserAdmin ? "RAG Assistant" : "Trợ lý tài liệu");

  const brandEl = el("div", { class: "sidebar-brand" },
    el("div", { class: "brand-icon" }, createSvg("documents", 20, 20)),
    el("div", { class: "brand-info" },
      el("div", { class: "brand-title" }, brandTitleText),
      el("div", { class: "brand-sub" }, "Hỏi đáp tài liệu nội bộ")
    )
  );

  // 2. Nút hành động đầu sidebar
  let actionEl;
  if (type === "chat") {
    actionEl = el("div", { class: "sidebar-action" },
      el("button", {
        id: "new-chat-btn",
        class: "btn btn-primary btn-block new-chat-btn",
        onclick: onNewChat,
      },
        createSvg("plus", 18, 18),
        el("span", {}, "Hội thoại mới")
      )
    );
  } else {
    // Trang Admin: link về trang Chat
    actionEl = el("div", { class: "sidebar-action" },
      el("a", {
        href: "/",
        class: "btn btn-outline btn-block",
        style: "text-decoration: none;",
        title: "Quay về trang chat tài liệu",
      },
        createSvg("chat", 16, 16),
        el("span", {}, "Về trang chat")
      )
    );
  }

  // 3. Khối nội dung chính của Sidebar
  let bodyEl;
  if (type === "chat") {
    // Trang Chat: Nhóm HỘI THOẠI (danh sách hội thoại)
    const convGroup = el("div", { class: "sidebar-group conv-group" },
      el("div", { class: "sidebar-group-title" }, "HỘI THOẠI"),
      el("div", { class: "conv-list-wrap" },
        el("ul", { id: "conv-list", class: "conv-list" })
      )
    );

    // Nếu user là Admin: thêm link chuyển sang trang Quản trị
    let adminLinkGroup = null;
    if (isUserAdmin) {
      adminLinkGroup = el("div", { class: "sidebar-group admin-group" },
        el("div", { class: "sidebar-group-title" }, "QUẢN TRỊ"),
        el("nav", { class: "admin-nav" },
          el("a", {
            href: "/admin",
            class: "nav-item",
            title: "Mở bảng điều khiển quản trị",
          },
            createSvg("dashboard", 18, 18),
            el("span", { class: "nav-label" }, "Trang quản trị"),
            el("span", { style: "font-size: 12px; color: var(--text-dim);" }, "→")
          )
        )
      );
    }

    bodyEl = adminLinkGroup ? [convGroup, adminLinkGroup] : [convGroup];
  } else {
    // Trang Admin: 4 mục điều hướng quản trị
    bodyEl = [
      el("div", { class: "sidebar-group admin-group", style: "border-top: none; flex: 1; overflow-y: auto;" },
        el("div", { class: "sidebar-group-title" }, "QUẢN TRỊ"),
        el("nav", { class: "admin-nav", "aria-label": "Khu vực quản trị" },
          el("a", {
            id: "admin-nav-dashboard",
            href: "#/dashboard",
            class: "nav-item active",
            "data-tab": "dashboard",
          },
            createSvg("dashboard", 18, 18),
            el("span", { class: "nav-label" }, "Tổng quan")
          ),
          el("a", {
            id: "admin-nav-users",
            href: "#/users",
            class: "nav-item",
            "data-tab": "users",
          },
            createSvg("users", 18, 18),
            el("span", { class: "nav-label" }, "Người dùng")
          ),
          el("a", {
            id: "admin-nav-documents",
            href: "#/documents",
            class: "nav-item",
            "data-tab": "documents",
          },
            createSvg("documents", 18, 18),
            el("span", { class: "nav-label" }, "Tài liệu")
          ),
          el("a", {
            id: "admin-nav-unanswered",
            href: "#/unanswered",
            class: "nav-item",
            "data-tab": "unanswered",
          },
            createSvg("unanswered", 18, 18),
            el("span", { class: "nav-label" }, "Chưa trả lời được"),
            el("span", {
              id: "sidebar-unanswered-badge",
              class: "badge badge-warning",
              hidden: true,
            }, "0")
          )
        )
      )
    ];
  }

  // 4. Chân Sidebar: Menu tài khoản (Đổi mật khẩu, Đăng xuất)
  const roleLabel = user.role === "admin" ? "Admin" : "Người dùng";
  const roleClass = user.role === "admin" ? "pill pill-accent user-role" : "pill pill-neutral user-role";

  const accountMenu = el("div", {
    id: "sidebar-account-menu",
    class: "account-menu",
    role: "menu",
    hidden: true,
    "aria-labelledby": "sidebar-account-btn",
  },
    el("button", {
      type: "button",
      id: "menu-change-password-btn",
      class: "account-menu-item",
      role: "menuitem",
      onclick: () => {
        closeAccountMenu();
        openChangePasswordDialog(accountBtn);
      },
    },
      createSvg("lock", 16, 16),
      el("span", {}, "Đổi mật khẩu")
    ),
    el("button", {
      type: "button",
      id: "sidebar-logout-btn",
      class: "account-menu-item text-danger",
      role: "menuitem",
      title: "Đăng xuất khỏi tài khoản",
      onclick: () => {
        closeAccountMenu();
        logout();
      },
    },
      createSvg("logout", 16, 16),
      el("span", {}, "Đăng xuất")
    )
  );

  const accountBtn = el("button", {
    type: "button",
    id: "sidebar-account-btn",
    class: "user-profile-btn",
    "aria-haspopup": "menu",
    "aria-expanded": "false",
    title: "Tài khoản (nhấn để mở menu)",
    onclick: (e) => {
      e.stopPropagation();
      toggleAccountMenu();
    },
  },
    el("div", { class: "user-avatar" }, createSvg("user", 16, 16)),
    el("div", { class: "user-meta" },
      el("div", { class: "user-email", title: user.email }, user.email),
      el("div", { class: roleClass }, roleLabel)
    ),
    el("div", { class: "account-caret-icon" }, createSvg("chevron-up", 14, 14))
  );

  function openAccountMenu() {
    accountMenu.hidden = false;
    accountBtn.setAttribute("aria-expanded", "true");
    accountBtn.classList.add("menu-open");
  }

  function closeAccountMenu() {
    accountMenu.hidden = true;
    accountBtn.setAttribute("aria-expanded", "false");
    accountBtn.classList.remove("menu-open");
  }

  function toggleAccountMenu() {
    if (accountMenu.hidden) {
      openAccountMenu();
    } else {
      closeAccountMenu();
    }
  }

  // Đóng menu khi click ra ngoài
  document.addEventListener("click", (e) => {
    if (!accountMenu.hidden && !accountMenu.contains(e.target) && !accountBtn.contains(e.target)) {
      closeAccountMenu();
    }
  });

  // Đóng menu khi bấm phím Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !accountMenu.hidden) {
      closeAccountMenu();
      accountBtn.focus();
    }
  });

  const footerEl = el("div", { class: "sidebar-footer" },
    el("div", { class: "account-menu-wrap" },
      accountMenu,
      accountBtn
    )
  );

  container.append(brandEl, actionEl, ...bodyEl, footerEl);

  // Khởi tạo drawer mobile
  initMobileDrawer();
}
