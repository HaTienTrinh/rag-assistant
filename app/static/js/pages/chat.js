import { requireAuth } from "../core/auth.js";
import { api, postJSON } from "../core/api.js";
import { el, $ } from "../ui/dom.js";
import { createSvg } from "../ui/icons.js";
import { toast } from "../ui/toast.js";
import { showConfirmDialog } from "../ui/dialog.js";
import { renderSidebar, updateSidebarConversations } from "../ui/sidebar.js";

let me = null;
let activeConv = null;
let conversationsList = [];

// Hiển thị bong bóng tin nhắn chat (User căn phải, Assistant căn trái)
function createMessageBubble(role, content, sources) {
  const row = el("div", { class: `msg-row ${role}-row` });
  const bubble = el("div", { class: `msg-bubble msg-${role}` });

  const textNode = el("div", { class: "msg-text" });
  textNode.textContent = content; // An toàn tuyệt đối chống XSS
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

// Tạo bong bóng thông báo lỗi (kể cả lỗi hết hạn mức 429)
function createErrorBubble(message) {
  const row = el("div", { class: "msg-row assistant-row" });
  const bubble = el("div", { class: "msg-bubble msg-assistant msg-error" });
  const text = el("div", { class: "msg-text" });
  text.textContent = message;
  bubble.append(text);
  row.append(bubble);
  return row;
}

function scrollToBottom() {
  const box = $("#messages");
  if (box) box.scrollTop = box.scrollHeight;
}

function showWelcome() {
  const box = $("#messages");
  if (!box) return;

  box.replaceChildren();
  const welcome = el("div", { class: "chat-welcome" },
    el("div", { class: "welcome-icon" }, createSvg("info", 24, 24)),
    el("h3", { class: "welcome-title" }, "Trợ lý hỏi đáp tài liệu"),
    el("p", { class: "welcome-text" }, "Hãy đặt câu hỏi về nội dung tài liệu.")
  );
  box.append(welcome);
}

// Tải danh sách hội thoại từ server và cập nhật sidebar
async function loadConversations() {
  try {
    conversationsList = await api("/conversations");
    updateSidebarConversations(
      conversationsList,
      activeConv,
      (id) => {
        if (activeConv !== id) {
          window.location.hash = `#/chat/${id}`;
        }
      },
      (conv) => {
        showConfirmDialog({
          title: "Xóa hội thoại",
          message: `Bạn có chắc muốn xóa hội thoại "${conv.title}"?`,
          okText: "Xóa",
          isDanger: true,
          onConfirm: async () => {
            try {
              await api(`/conversations/${conv.id}`, { method: "DELETE" });
              toast("Đã xóa hội thoại", "success");
              if (activeConv === conv.id) {
                window.location.hash = "#/chat";
              } else {
                await loadConversations();
              }
            } catch (err) {
              toast(err.message, "error");
            }
          },
        });
      }
    );
  } catch (err) {
    console.error("Lỗi tải danh sách hội thoại:", err);
  }
}

// Mở một hội thoại cụ thể và tải tin nhắn
async function loadConversationMessages(id) {
  activeConv = id;
  const box = $("#messages");
  if (!box) return;

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

  const input = $("#question");
  if (input) input.focus();
}

// Mở giao diện hội thoại mới
function openNewChat() {
  activeConv = null;
  window.location.hash = "#/chat";
  showWelcome();
  loadConversations();
  const input = $("#question");
  if (input) input.focus();
}

// Xử lý routing theo Hash trên trang chat
async function handleChatRoute() {
  const hash = window.location.hash || "#/chat";

  if (hash === "#/chat") {
    activeConv = null;
    showWelcome();
    await loadConversations();
    const input = $("#question");
    if (input) input.focus();
  } else if (hash.startsWith("#/chat/")) {
    const id = parseInt(hash.replace("#/chat/", ""), 10);
    if (!isNaN(id)) {
      await loadConversationMessages(id);
      await loadConversations();
    } else {
      window.location.hash = "#/chat";
    }
  } else {
    window.location.hash = "#/chat";
  }
}

// Gửi câu hỏi đến server
async function sendQuestion(text) {
  const box = $("#messages");
  if (!box) return;

  const welcome = box.querySelector(".chat-welcome");
  if (welcome) welcome.remove();

  const sendBtn = $("#send-btn");
  if (sendBtn) sendBtn.disabled = true;

  // Hiển thị tin nhắn người dùng
  box.append(createMessageBubble("user", text));

  // Hiển thị bong bóng chờ câu trả lời
  const pendingRow = el("div", { class: "msg-row assistant-row" });
  const pendingBubble = el("div", { class: "msg-bubble msg-assistant" });
  const typingText = el("span", { class: "typing-indicator" }, "Đang trả lời…");
  pendingBubble.append(typingText);
  pendingRow.append(pendingBubble);
  box.append(pendingRow);
  scrollToBottom();

  try {
    // Nếu chưa có hội thoại, tạo mới trước
    if (!activeConv) {
      const conv = await postJSON("/conversations", {});
      activeConv = conv.id;
      history.replaceState(null, "", `#/chat/${activeConv}`);
    }

    const res = await postJSON(`/conversations/${activeConv}/ask`, { question: text });
    pendingRow.replaceWith(createMessageBubble("assistant", res.message.content, res.message.sources));
    await loadConversations();
  } catch (err) {
    pendingRow.replaceWith(createErrorBubble(err.message));
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    scrollToBottom();
    const textarea = $("#question");
    if (textarea) {
      textarea.style.height = "auto";
      textarea.focus();
    }
  }
}

// Khởi tạo trang Chat
async function initChatPage() {
  me = await requireAuth();
  if (!me) return;

  // Dựng sidebar dùng chung loại "chat"
  renderSidebar({
    type: "chat",
    user: me,
    onNewChat: openNewChat,
  });

  // Gắn sự kiện nút tạo hội thoại mới trên mobile topbar
  const mobileNewChatBtn = $("#mobile-new-chat-btn");
  if (mobileNewChatBtn) {
    mobileNewChatBtn.addEventListener("click", openNewChat);
  }

  // Khung soạn thảo tin nhắn
  const form = $("#chat-form");
  const textarea = $("#question");

  if (textarea) {
    textarea.addEventListener("input", () => {
      textarea.style.height = "auto";
      textarea.style.height = Math.min(140, textarea.scrollHeight) + "px";
    });

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (form) form.requestSubmit();
      }
    });
  }

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = textarea ? textarea.value.trim() : "";
      const sendBtn = $("#send-btn");
      if (!text || (sendBtn && sendBtn.disabled)) return;
      textarea.value = "";
      textarea.style.height = "auto";
      sendQuestion(text);
    });
  }

  // Xử lý route ban đầu và lắng nghe thay đổi hash
  window.addEventListener("hashchange", handleChatRoute);
  await handleChatRoute();
}

initChatPage();
