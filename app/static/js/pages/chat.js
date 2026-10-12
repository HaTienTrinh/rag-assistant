import { requireAuth, getAccessToken } from "../core/auth.js";
import { api, postJSON } from "../core/api.js";
import { el, $ } from "../ui/dom.js";
import { createSvg } from "../ui/icons.js";
import { toast } from "../ui/toast.js";
import { showConfirmDialog } from "../ui/dialog.js";
import { renderSidebar, updateSidebarConversations } from "../ui/sidebar.js";
import { openDocumentViewer } from "../ui/doc-viewer.js";
import { openChangePasswordDialog } from "../ui/change-password.js";

let me = null;
let activeConv = null;
let conversationsList = [];

// Tạo khối hiển thị danh sách nguồn trích dẫn đính kèm cuối tin nhắn
function createSourcesBox(sources) {
  if (!sources || sources.length === 0) return null;
  const sourcesBox = el("div", { class: "sources-box" });
  const details = el("details", { class: "sources-details" });
  const summary = el("summary", {}, `Nguồn (${sources.length})`);
  details.append(summary);

  const list = el("div", { class: "sources-list" });
  sources.forEach((s, idx) => {
    const item = el("div", {
      class: "source-item source-item-clickable",
      role: "button",
      tabindex: "0",
      title: "Bấm để xem tài liệu tại trang này",
      "aria-label": `Xem tài liệu ${s.filename}${s.page ? ` trang ${s.page}` : ""}`,
    });
    const whereTitle = s.filename + (s.page ? `, trang ${s.page}` : "");

    const whereEl = el("div", { class: "source-where" });
    const whereTitleSpan = el("span", { class: "source-where-text" }, `[${idx + 1}] ${whereTitle}`);
    const viewBadge = el("span", { class: "source-view-badge" }, "Xem ↗");
    whereEl.append(whereTitleSpan, viewBadge);

    const snippet = s.content && s.content.length > 220
      ? s.content.slice(0, 220) + "…"
      : (s.content || "");

    const snippetEl = el("div", { class: "source-snippet" });
    snippetEl.textContent = snippet;

    item.append(whereEl, snippetEl);

    // Sự kiện bấm vào nguồn để mở Popup Modal xem trước tài liệu tại chỗ
    const handleOpenDoc = (e) => {
      e.preventDefault();
      openDocumentViewer({
        docId: s.document_id,
        filename: s.filename,
        page: s.page,
        triggerEl: item,
      });
    };

    item.addEventListener("click", handleOpenDoc);
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        handleOpenDoc(e);
      }
    });

    list.append(item);
  });

  details.append(list);
  sourcesBox.append(details);
  return sourcesBox;
}

// Hiển thị bong bóng tin nhắn chat (User căn phải, Assistant căn trái)
function createMessageBubble(role, content, sources) {
  const row = el("div", { class: `msg-row ${role}-row` });
  const bubble = el("div", { class: `msg-bubble msg-${role}` });

  const textNode = el("div", { class: "msg-text" });
  textNode.textContent = content; // An toàn tuyệt đối chống XSS
  bubble.append(textNode);

  const sourcesBox = createSourcesBox(sources);
  if (sourcesBox) {
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

// Gửi câu hỏi đến server và hiển thị streaming token-by-token
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
  const typingText = el("span", { class: "typing-indicator" }, "Đang suy nghĩ…");
  pendingBubble.append(typingText);
  pendingRow.append(pendingBubble);
  box.append(pendingRow);
  scrollToBottom();

  const msgText = el("div", { class: "msg-text" });
  const cursor = el("span", { class: "typing-cursor" });

  try {
    // Nếu chưa có hội thoại, tạo mới trước
    if (!activeConv) {
      const conv = await postJSON("/conversations", {});
      activeConv = conv.id;
      history.replaceState(null, "", `#/chat/${activeConv}`);
    }

    const token = getAccessToken();
    const res = await fetch(`/conversations/${activeConv}/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ question: text, stream: true }),
    });

    if (!res.ok) {
      let errMsg = "Không xử lý được câu hỏi";
      try {
        const errData = await res.json();
        errMsg = errData.detail || errData.message || errMsg;
      } catch (_) {}
      throw new Error(errMsg);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let receivedFirstToken = false;
    let fullContent = "";
    let finalSources = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // Giữ lại phần dở dang nếu dòng chưa kết thúc

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        try {
          const data = JSON.parse(trimmed.slice(6));
          if (data.type === "delta") {
            if (!receivedFirstToken) {
              receivedFirstToken = true;
              pendingBubble.replaceChildren(msgText);
            }
            fullContent += data.text;
            msgText.textContent = fullContent;
            msgText.append(cursor);
            scrollToBottom();
          } else if (data.type === "sources") {
            finalSources = data.sources;
          } else if (data.type === "done") {
            cursor.remove();
            const sourcesBox = createSourcesBox(finalSources);
            if (sourcesBox) {
              pendingBubble.append(sourcesBox);
            }
            await loadConversations();
            scrollToBottom();
          } else if (data.type === "error") {
            throw new Error(data.message || "Lỗi khi xử lý câu hỏi");
          }
        } catch (e) {
          if (e.message && e.message.startsWith("Lỗi")) throw e;
        }
      }
    }

    cursor.remove();
  } catch (err) {
    cursor.remove();
    pendingRow.replaceWith(createErrorBubble(err.message));
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    scrollToBottom();
    const textarea = $("#question");
    if (textarea) {
      textarea.style.height = "44px";
      textarea.focus();
    }
  }
}

// Khởi tạo trang Chat
async function initChatPage() {
  me = await requireAuth();
  if (!me) return;

  if (me.must_change_password) {
    openChangePasswordDialog({
      forced: true,
      onSuccess: () => {
        me.must_change_password = false;
        handleChatRoute();
      },
    });
  }

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
      textarea.style.height = "44px";
      textarea.style.height = Math.min(140, Math.max(44, textarea.scrollHeight)) + "px";
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
      textarea.style.height = "44px";
      sendQuestion(text);
    });
  }

  // Xử lý route ban đầu và lắng nghe thay đổi hash
  window.addEventListener("hashchange", handleChatRoute);
  await handleChatRoute();
}

initChatPage();
