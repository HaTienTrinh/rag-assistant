import { el } from "./dom.js";
import { createSvg } from "./icons.js";
import { openCustomDialog, closeCustomDialog } from "./dialog.js";
import { getAccessToken } from "../core/auth.js";
import { toast } from "./toast.js";

let viewerDialog = null;
let currentBlobUrl = null;

/**
 * Khởi tạo hoặc lấy thẻ <dialog> dùng cho xem trước tài liệu PDF/văn bản.
 */
function getOrCreateViewerDialog() {
  if (viewerDialog && document.body.contains(viewerDialog)) {
    return viewerDialog;
  }

  const titleEl = el("h3", { id: "doc-viewer-title", class: "dialog-title doc-viewer-title" });
  const pageBadge = el("span", { id: "doc-viewer-page-badge", class: "badge badge-teal" });
  const loadingEl = el("div", { id: "doc-viewer-loading", class: "doc-viewer-loading" }, "Đang tải tài liệu...");
  const iframeEl = el("iframe", { id: "doc-viewer-iframe", class: "doc-viewer-iframe", title: "Xem tài liệu" });
  const errorEl = el("div", { id: "doc-viewer-error", class: "doc-viewer-error", style: "display: none;" });

  const closeBtn = el(
    "button",
    {
      type: "button",
      class: "icon-btn dialog-close-btn",
      "data-close-dialog": "",
      "aria-label": "Đóng trình xem tài liệu",
    },
    createSvg("close", 18, 18)
  );

  const dialog = el(
    "dialog",
    {
      id: "doc-viewer-dialog",
      class: "custom-dialog doc-viewer-dialog",
      "aria-labelledby": "doc-viewer-title",
    },
    el(
      "div",
      { class: "dialog-card doc-viewer-card" },
      el(
        "div",
        { class: "dialog-header doc-viewer-header" },
        el(
          "div",
          { class: "doc-viewer-header-left" },
          createSvg("document", 18, 18),
          titleEl,
          pageBadge
        ),
        closeBtn
      ),
      el(
        "div",
        { class: "dialog-body doc-viewer-body" },
        loadingEl,
        errorEl,
        iframeEl
      )
    )
  );

  // Dọn dẹp tài nguyên khi đóng modal
  dialog.addEventListener("close", () => {
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }
    iframeEl.src = "about:blank";
    loadingEl.style.display = "none";
    errorEl.style.display = "none";
  });

  // Đóng khi click vào vùng nền mờ bên ngoài modal (backdrop)
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      closeCustomDialog(dialog);
    }
  });

  document.body.append(dialog);
  viewerDialog = dialog;
  return viewerDialog;
}

/**
 * Mở modal xem trước tài liệu và nhảy đến trang được trích dẫn (nếu có).
 * @param {Object} params
 * @param {number|null} [params.docId] - ID của tài liệu trong hệ thống
 * @param {string} params.filename - Tên file tài liệu
 * @param {number|null} [params.page] - Số trang cần nhảy đến
 * @param {HTMLElement|null} [params.triggerEl] - Nút kích hoạt mở dialog
 */
export async function openDocumentViewer({ docId, filename, page, triggerEl = null }) {
  const dialog = getOrCreateViewerDialog();
  const titleEl = dialog.querySelector("#doc-viewer-title");
  const pageBadge = dialog.querySelector("#doc-viewer-page-badge");
  const loadingEl = dialog.querySelector("#doc-viewer-loading");
  const errorEl = dialog.querySelector("#doc-viewer-error");
  const iframeEl = dialog.querySelector("#doc-viewer-iframe");

  // Gán thông tin hiển thị (dùng textContent chống XSS)
  titleEl.textContent = filename || "Tài liệu";
  if (page) {
    pageBadge.textContent = `Trang ${page}`;
    pageBadge.style.display = "inline-flex";
  } else {
    pageBadge.textContent = "";
    pageBadge.style.display = "none";
  }

  // Trạng thái ban đầu
  loadingEl.textContent = "Đang tải tài liệu...";
  loadingEl.style.display = "flex";
  errorEl.style.display = "none";
  iframeEl.style.display = "none";
  iframeEl.src = "about:blank";

  // Mở modal ngay để người dùng thấy phản hồi
  openCustomDialog(dialog, triggerEl);

  // Thu hồi URL blob cũ nếu còn
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }

  // Xác định đường dẫn tải file (ưu tiên docId, fallback theo filename)
  const endpoint = docId
    ? `/documents/${docId}/file`
    : `/documents/raw/by-name?filename=${encodeURIComponent(filename)}`;

  try {
    const token = getAccessToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    const res = await fetch(endpoint, { headers });
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error("Không tìm thấy file tài liệu trên máy chủ");
      } else if (res.status === 403) {
        throw new Error("Bạn không có quyền xem tài liệu này");
      }
      throw new Error(`Lỗi tải tài liệu (${res.status})`);
    }

    const blob = await res.blob();
    currentBlobUrl = URL.createObjectURL(blob);

    // Gắn URL và tham số số trang #page=N cho trình đọc PDF tích hợp
    const targetUrl = page ? `${currentBlobUrl}#page=${page}` : currentBlobUrl;
    iframeEl.src = targetUrl;

    iframeEl.onload = () => {
      loadingEl.style.display = "none";
      iframeEl.style.display = "block";
    };

    // Đề phòng trường hợp iframe không kích hoạt onload với PDF blob
    setTimeout(() => {
      loadingEl.style.display = "none";
      iframeEl.style.display = "block";
    }, 600);
  } catch (err) {
    loadingEl.style.display = "none";
    errorEl.textContent = err.message || "Không thể tải tài liệu để xem trước";
    errorEl.style.display = "flex";
    toast.error(err.message || "Lỗi xem tài liệu");
  }
}
