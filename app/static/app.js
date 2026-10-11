/* ==========================================================================
   RAG Assistant - App Shell & Chat Logic
   Vanilla ES2020+, XSS-Safe (No innerHTML for server data)
   ========================================================================== */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// State
let token = localStorage.getItem("token");
let me = null;
let activeConv = null;
let lastFocusedElement = null;

/* ---------- DOM Creation Utility (100% XSS-Safe) ---------- */
function el(tag, props = {}, ...children) {
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

/* ---------- SVG Icon Helper ---------- */
function createSvg(iconName, width = 16, height = 16) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  if (iconName === "check") {
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("points", "20 6 9 17 4 12");
    svg.append(polyline);
  } else if (iconName === "alert") {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "10");
    const l1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    l1.setAttribute("x1", "12"); l1.setAttribute("y1", "8"); l1.setAttribute("x2", "12"); l1.setAttribute("y2", "12");
    const l2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    l2.setAttribute("x1", "12"); l2.setAttribute("y1", "16"); l2.setAttribute("x2", "12.01"); l2.setAttribute("y2", "16");
    svg.append(circle, l1, l2);
  } else if (iconName === "info") {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "12"); circle.setAttribute("cy", "12"); circle.setAttribute("r", "10");
    const l1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    l1.setAttribute("x1", "12"); l1.setAttribute("y1", "16"); l1.setAttribute("x2", "12"); l1.setAttribute("y2", "12");
    const l2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    l2.setAttribute("x1", "12"); l2.setAttribute("y1", "8"); l2.setAttribute("x2", "12.01"); l2.setAttribute("y2", "8");
    svg.append(circle, l1, l2);
  } else if (iconName === "trash") {
    const l1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    l1.setAttribute("x1", "18"); l1.setAttribute("y1", "6"); l1.setAttribute("x2", "6"); l1.setAttribute("y2", "18");
    const l2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    l2.setAttribute("x1", "6"); l2.setAttribute("y1", "6"); l2.setAttribute("x2", "18"); l2.setAttribute("y2", "18");
    svg.append(l1, l2);
  }
  return svg;
}

/* ---------- Toast System ---------- */
function toast(message, type = "info") {
  const container = $("#toast-container");
  if (!container) return;

  const icons = {
    success: "check",
    error: "alert",
    warning: "alert",
    info: "info",
  };

  const toastItem = el("div", { class: `toast toast-${type}` },
    el("div", { class: "toast-icon" }, createSvg(icons[type] || "info", 18, 18)),
    el("div", { class: "toast-msg" }, message)
  );

  container.append(toastItem);

  setTimeout(() => {
    toastItem.style.opacity = "0";
    toastItem.style.transform = "translateY(-6px)";
    setTimeout(() => toastItem.remove(), 250);
  }, 4000);
}

/* ---------- Custom Modal Dialog Helpers ---------- */
function openCustomDialog(dialogEl, triggerEl = null) {
  if (!dialogEl) return;
  lastFocusedElement = triggerEl || document.activeElement;
  dialogEl.showModal();
}

function closeCustomDialog(dialogEl) {
  if (!dialogEl || !dialogEl.open) return;
  dialogEl.close();
  if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
    lastFocusedElement.focus();
  }
}

// Bind close button actions
document.addEventListener("click", (e) => {
  const closeBtn = e.target.closest("[data-close-dialog]");
  if (closeBtn) {
    const dialog = closeBtn.closest("dialog");
    if (dialog) closeCustomDialog(dialog);
  }
});

// Confirm Modal helper (Replaces window.confirm)
function showConfirmDialog({ title = "Xác nhận", message, isDanger = true, okText = "Xác nhận", cancelText = "Hủy", onConfirm }) {
  const dialog = $("#confirm-dialog");
  $("#confirm-dialog-title").textContent = title;
  $("#confirm-dialog-message").textContent = message;

  const okBtn = $("#confirm-ok-btn");
  okBtn.textContent = okText;
  okBtn.className = isDanger ? "btn btn-danger" : "btn btn-primary";

  const cancelBtn = $("#confirm-cancel-btn");
  cancelBtn.textContent = cancelText;

  // Clone button to remove previous listeners
  const newOkBtn = okBtn.cloneNode(true);
  okBtn.replaceWith(newOkBtn);

  newOkBtn.addEventListener("click", async () => {
    closeCustomDialog(dialog);
    if (typeof onConfirm === "function") {
      await onConfirm();
    }
  });

  openCustomDialog(dialog);
}

/* ---------- API Helper ---------- */
async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => null);

  if (res.status === 401 && path !== "/auth/login") {
    logout();
    throw new Error(data && typeof data.detail === "string" ? data.detail : "Phiên đăng nhập đã hết hạn");
  }

  if (!res.ok) {
    let detail = "Yêu cầu không hợp lệ";
    if (data && typeof data.detail === "string") {
      detail = data.detail;
    } else if (data && Array.isArray(data.detail)) {
      detail = data.detail.map((d) => d.msg || JSON.stringify(d)).join("; ");
    }
    throw new Error(detail);
  }
  return data;
}

function postJSON(path, body) {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sendJSON(method, path, body) {
  return api(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* ---------- Format Utilities ---------- */
function fmtTime(s) {
  if (!s) return "—";
  const iso = /(Z|[+-]\d\d:?\d\d)$/.test(s) ? s : s + "Z";
  return new Date(iso).toLocaleString("vi-VN");
}

function fmtNum(n) {
  return (n ?? 0).toLocaleString("vi-VN");
}

/* ---------- Authentication & Lifecycle ---------- */
function showView(view) {
  $("#login-view").hidden = view !== "login";
  $("#app-view").hidden = view !== "app";
}

function logout() {
  token = null;
  me = null;
  activeConv = null;
  localStorage.removeItem("token");
  if (window.adminClose) window.adminClose();
  showView("login");
  window.location.hash = "";
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errBox = $("#login-error");
  errBox.hidden = true;
  errBox.textContent = "";

  const submitBtn = $("#login-submit-btn");
  submitBtn.disabled = true;

  try {
    const data = await api("/auth/login", {
      method: "POST",
      body: new URLSearchParams({
        username: $("#email").value.trim(),
        password: $("#password").value,
      }),
    });
    token = data.access_token;
    localStorage.setItem("token", token);
    $("#password").value = "";
    await init();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.hidden = false;
  } finally {
    submitBtn.disabled = false;
  }
});

$("#logout-btn").addEventListener("click", logout);

/* Mobile Drawer Controls */
const mobileToggleBtn = $("#mobile-toggle-btn");
const mobileBackdrop = $("#sidebar-backdrop");
const sidebar = $("#sidebar");

function openSidebarDrawer() {
  sidebar.classList.add("drawer-open");
  mobileBackdrop.hidden = false;
}

function closeSidebarDrawer() {
  sidebar.classList.remove("drawer-open");
  mobileBackdrop.hidden = true;
}

if (mobileToggleBtn) {
  mobileToggleBtn.addEventListener("click", openSidebarDrawer);
}
if (mobileBackdrop) {
  mobileBackdrop.addEventListener("click", closeSidebarDrawer);
}

/* ---------- Router & Layout Switching ---------- */
async function handleRoute() {
  if (!token || !me) return;

  closeSidebarDrawer();

  const hash = window.location.hash || "#/chat";

  // Role security guard: Normal user cannot view admin screens
  if (me.role !== "admin" && hash.startsWith("#/admin")) {
    window.location.hash = "#/chat";
    return;
  }

  // Clear sidebar active states
  $$(".conv-item").forEach((el) => {
    el.classList.remove("active");
    el.removeAttribute("aria-current");
  });
  $$(".nav-item").forEach((el) => {
    el.classList.remove("active");
    el.removeAttribute("aria-current");
  });

  if (hash === "#/chat") {
    showChatView();
    activeConv = null;
    showWelcome();
    await loadConversations();
    $("#question").focus();
  } else if (hash.startsWith("#/chat/")) {
    const convId = parseInt(hash.replace("#/chat/", ""), 10);
    if (!isNaN(convId)) {
      showChatView();
      await loadConversationMessages(convId);
      await loadConversations();
    } else {
      window.location.hash = "#/chat";
    }
  } else if (hash === "#/admin/dashboard") {
    showAdminView("dashboard");
  } else if (hash === "#/admin/users") {
    showAdminView("users");
  } else if (hash === "#/admin/documents") {
    showAdminView("documents");
  } else if (hash === "#/admin/unanswered") {
    showAdminView("unanswered");
  } else {
    window.location.hash = "#/chat";
  }
}

window.addEventListener("hashchange", handleRoute);

function showChatView() {
  if (window.adminClose) window.adminClose();
  $("#chat-view").hidden = false;
  $("#admin-view").hidden = true;
}

function showAdminView(tabName) {
  $("#chat-view").hidden = true;
  $("#admin-view").hidden = false;

  // Set active nav link
  const navItem = $(`#nav-${tabName}`);
  if (navItem) {
    navItem.classList.add("active");
    navItem.setAttribute("aria-current", "page");
  }

  // Hide all admin pages, show target
  $$(".admin-page").forEach((p) => (p.hidden = p.id !== `tab-${tabName}`));

  if (window.switchAdminTab) {
    window.switchAdminTab(tabName);
  }
}

/* ---------- Chat Messages Rendering ---------- */
function createMessageBubble(role, content, sources) {
  const row = el("div", { class: `msg-row ${role}-row` });
  const bubble = el("div", { class: `msg-bubble msg-${role}` });

  const textNode = el("div", { class: "msg-text" });
  textNode.textContent = content; // XSS-safe!
  bubble.append(textNode);

  if (sources && sources.length > 0) {
    const sourcesBox = el("div", { class: "sources-box" });
    const details = el("details", { class: "sources-details" });
    const summary = el("summary", {}, `Nguồn (${sources.length})`);
    details.append(summary);

    const list = el("div", { class: "sources-list" });
    sources.forEach((s, idx) => {
      const item = el("div", { class: "source-item" });
      const whereTitle = s.filename + (s.page ? `, trang ${s.page}` : "");

      const whereEl = el("div", { class: "source-where" });
      whereEl.textContent = `[${idx + 1}] ${whereTitle}`;

      const snippet = s.content && s.content.length > 220
        ? s.content.slice(0, 220) + "…"
        : (s.content || "");

      const snippetEl = el("div", { class: "source-snippet" });
      snippetEl.textContent = snippet;

      item.append(whereEl, snippetEl);
      list.append(item);
    });

    details.append(list);
    sourcesBox.append(details);
    bubble.append(sourcesBox);
  }

  row.append(bubble);
  return row;
}

function scrollToBottom() {
  const box = $("#messages");
  box.scrollTop = box.scrollHeight;
}

function showWelcome() {
  const box = $("#messages");
  box.replaceChildren();

  const welcome = el("div", { class: "chat-welcome" },
    el("div", { class: "welcome-icon" },
      createSvg("info", 24, 24)
    ),
    el("h3", { class: "welcome-title" }, "Trợ lý hỏi đáp tài liệu"),
    el("p", { class: "welcome-text" }, "Hãy đặt câu hỏi về nội dung tài liệu.")
  );
  box.append(welcome);
}

function createErrorBubble(message) {
  const row = el("div", { class: "msg-row assistant-row" });
  const bubble = el("div", { class: "msg-bubble msg-assistant msg-error" });
  const text = el("div", { class: "msg-text" });
  text.textContent = message;
  bubble.append(text);
  row.append(bubble);
  return row;
}

/* ---------- Conversation List Management ---------- */
async function loadConversations() {
  try {
    const list = await api("/conversations");
    const ul = $("#conv-list");
    ul.replaceChildren();

    if (list.length === 0) {
      ul.append(el("li", { class: "conv-list-empty" }, "Chưa có hội thoại nào"));
      return;
    }

    for (const c of list) {
      const isActive = c.id === activeConv;
      const li = el("li", {
        class: `conv-item ${isActive ? "active" : ""}`,
        onclick: () => {
          if (activeConv !== c.id) {
            window.location.hash = `#/chat/${c.id}`;
          }
        },
      });
      if (isActive) li.setAttribute("aria-current", "page");

      const titleSpan = el("span", { class: "conv-item-title", title: c.title }, c.title);

      const delBtn = el("button", {
        class: "conv-item-del-btn",
        "aria-label": `Xóa hội thoại ${c.title}`,
        title: "Xóa hội thoại",
        onclick: (e) => {
          e.stopPropagation();
          showConfirmDialog({
            title: "Xóa hội thoại",
            message: `Bạn có chắc muốn xóa hội thoại "${c.title}"?`,
            okText: "Xóa",
            isDanger: true,
            onConfirm: async () => {
              try {
                await api(`/conversations/${c.id}`, { method: "DELETE" });
                toast("Đã xóa hội thoại", "success");
                if (activeConv === c.id) {
                  window.location.hash = "#/chat";
                } else {
                  await loadConversations();
                }
              } catch (err) {
                toast(err.message, "error");
              }
            },
          });
        },
      }, "×");

      li.append(titleSpan, delBtn);
      ul.append(li);
    }
  } catch (err) {
    console.error("Failed to load conversations:", err);
  }
}

async function loadConversationMessages(id) {
  activeConv = id;
  const box = $("#messages");
  box.replaceChildren();

  try {
    const messages = await api(`/conversations/${id}/messages`);
    if (messages.length === 0) {
      showWelcome();
    } else {
      messages.forEach((m) => {
        box.append(createMessageBubble(m.role, m.content, m.sources));
      });
      scrollToBottom();
    }
  } catch (err) {
    box.append(createErrorBubble(err.message));
  }
  $("#question").focus();
}

$("#new-chat-btn").addEventListener("click", () => {
  window.location.hash = "#/chat";
});

const mobileNewChatBtn = $("#mobile-new-chat-btn");
if (mobileNewChatBtn) {
  mobileNewChatBtn.addEventListener("click", () => {
    window.location.hash = "#/chat";
  });
}

/* ---------- Send Message Logic ---------- */
async function sendQuestion(text) {
  const box = $("#messages");
  const welcome = box.querySelector(".chat-welcome");
  if (welcome) welcome.remove();

  const sendBtn = $("#send-btn");
  sendBtn.disabled = true;

  // Append user bubble
  box.append(createMessageBubble("user", text));

  // Append pending typing indicator
  const pendingRow = el("div", { class: "msg-row assistant-row" });
  const pendingBubble = el("div", { class: "msg-bubble msg-assistant" });
  const typingText = el("span", { class: "typing-indicator" }, "Đang trả lời…");
  pendingBubble.append(typingText);
  pendingRow.append(pendingBubble);
  box.append(pendingRow);
  scrollToBottom();

  try {
    if (!activeConv) {
      const conv = await postJSON("/conversations", {});
      activeConv = conv.id;
      // Change hash without reloading
      history.replaceState(null, "", `#/chat/${activeConv}`);
    }

    const res = await postJSON(`/conversations/${activeConv}/ask`, { question: text });
    pendingRow.replaceWith(createMessageBubble("assistant", res.message.content, res.message.sources));
    await loadConversations();
  } catch (err) {
    pendingRow.replaceWith(createErrorBubble(err.message));
  } finally {
    sendBtn.disabled = false;
    scrollToBottom();
    const textarea = $("#question");
    textarea.style.height = "auto";
    textarea.focus();
  }
}

// Chat form submission & auto-resize textarea
const questionTextarea = $("#question");

questionTextarea.addEventListener("input", () => {
  questionTextarea.style.height = "auto";
  questionTextarea.style.height = Math.min(140, questionTextarea.scrollHeight) + "px";
});

questionTextarea.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("#chat-form").requestSubmit();
  }
});

$("#chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = questionTextarea.value.trim();
  if (!text || $("#send-btn").disabled) return;
  questionTextarea.value = "";
  questionTextarea.style.height = "auto";
  sendQuestion(text);
});

/* ---------- App Initialization ---------- */
async function init() {
  if (!token) return showView("login");

  try {
    me = await api("/auth/me");
  } catch {
    return;
  }

  // Update User Profile
  $("#user-email").textContent = me.email;
  $("#user-email").title = me.email;

  const roleBadge = $("#user-role-badge");
  roleBadge.textContent = me.role === "admin" ? "Admin" : "Người dùng";
  roleBadge.className = me.role === "admin" ? "pill pill-accent user-role" : "pill pill-neutral user-role";

  // Update Brand Title
  const brandTitle = $("#sidebar-brand-title");
  brandTitle.textContent = me.role === "admin" ? "RAG Admin" : "Trợ lý tài liệu";

  const mobileTitle = $("#mobile-brand-title");
  if (mobileTitle) mobileTitle.textContent = me.role === "admin" ? "RAG Admin" : "Trợ lý tài liệu";

  // Admin Section Visibility
  const adminSection = $("#admin-nav-group");
  adminSection.hidden = me.role !== "admin";

  showView("app");

  // Initial Route Check
  if (window.location.hash) {
    await handleRoute();
  } else {
    window.location.hash = "#/chat";
  }

  // If admin, update unanswered badge
  if (me.role === "admin" && window.syncAdminBadge) {
    window.syncAdminBadge();
  }
}

// Global hook to update sidebar unanswered badge
window.updateSidebarBadge = function(count) {
  const badge = $("#unanswered-badge");
  if (!badge) return;
  badge.textContent = count;
  badge.hidden = !count || count <= 0;
};

// Start application
init();