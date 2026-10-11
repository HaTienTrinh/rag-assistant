import { api, sendJSON } from "../core/api.js";
import { el, $, $$ } from "../ui/dom.js";
import { fmtTime } from "../ui/format.js";
import { toast } from "../ui/toast.js";
import { openCustomDialog, closeCustomDialog, showConfirmDialog } from "../ui/dialog.js";

let adminTimer = null;
let selectedDocId = null;
let docChunksOffset = 0;
const CHUNKS_PER_PAGE = 10;

const STATUS_LABEL = {
  pending: "Đang chờ",
  processing: "Đang xử lý",
  done: "Hoàn tất",
  failed: "Lỗi",
};

/** Dừng timer tự làm mới của trang Documents */
export function stopDocumentsTimer() {
  clearTimeout(adminTimer);
}

/** Tải danh sách tài liệu và hiển thị Master-Detail */
export async function loadDocuments() {
  stopDocumentsTimer();
  const container = $("#doc-items-container");
  if (!container) return;

  try {
    const docs = await api("/documents");
    const countLabel = $("#doc-list-count");
    if (countLabel) countLabel.textContent = `${docs.length} tài liệu`;

    // Hiển thị banner nếu có tài liệu lỗi
    const failedDocs = docs.filter((d) => d.status === "failed");
    const banner = $("#docs-error-banner");
    const bannerText = $("#docs-error-banner-text");

    if (banner && bannerText) {
      banner.hidden = failedDocs.length === 0;
      if (failedDocs.length > 0) {
        bannerText.textContent = `Có ${failedDocs.length} tài liệu bị lỗi trong quá trình xử lý. Vui lòng kiểm tra và xử lý lại.`;
      }
    }

    if (docs.length === 0) {
      container.replaceChildren(el("div", { class: "loading-state" }, "Chưa có tài liệu nào trong hệ thống."));
      selectDocument(null);
      return;
    }

    container.replaceChildren(...docs.map(createDocListItem));

    // Giữ tài liệu đang chọn hoặc chọn tài liệu đầu tiên
    if (!selectedDocId || !docs.some((d) => d.id === selectedDocId)) {
      selectDocument(docs[0].id);
    } else {
      selectDocument(selectedDocId);
    }

    // Tự động làm mới mỗi 3 giây nếu còn tài liệu đang chờ hoặc đang xử lý
    const isBusy = docs.some((d) => d.status === "pending" || d.status === "processing");
    if (isBusy) adminTimer = setTimeout(loadDocuments, 3000);
  } catch (err) {
    toast(err.message, "error");
  }
}

/** Tạo một hàng item trong danh sách tài liệu cột trái */
function createDocListItem(d) {
  const isSelected = d.id === selectedDocId;
  const statusLabel = STATUS_LABEL[d.status] || d.status;
  const pillClass = d.status === "done" ? "pill-success" : d.status === "processing" ? "pill-accent" : d.status === "failed" ? "pill-danger" : "pill-neutral";

  return el("div", {
    class: `doc-item-row ${isSelected ? "active" : ""}`,
    onclick: () => {
      selectDocument(d.id);
      const masterDetail = $("#doc-master-detail");
      if (masterDetail) {
        masterDetail.classList.remove("mobile-list-mode");
        masterDetail.classList.add("mobile-detail-mode");
      }
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
}

/** Chọn một tài liệu để xem chi tiết bên phải */
async function selectDocument(id) {
  selectedDocId = id;
  docChunksOffset = 0;
  const emptyView = $("#doc-detail-empty");
  const contentView = $("#doc-detail-content");

  if (!id) {
    if (emptyView) emptyView.hidden = false;
    if (contentView) contentView.hidden = true;
    return;
  }

  if (emptyView) emptyView.hidden = true;
  if (contentView) contentView.hidden = false;
  await loadDocumentDetails(id);
}

/** Tải thông tin chi tiết và hành động của tài liệu */
async function loadDocumentDetails(id) {
  try {
    const doc = await api(`/documents/${id}`);
    const filenameTitle = $("#doc-detail-filename");
    if (filenameTitle) filenameTitle.textContent = doc.filename;

    const metaContainer = $("#doc-detail-meta");
    if (metaContainer) {
      const statusPill = el("span", {
        class: `pill ${doc.status === "done" ? "pill-success" : doc.status === "failed" ? "pill-danger" : "pill-accent"}`,
      }, STATUS_LABEL[doc.status] || doc.status);
      const activePill = el("span", { class: `pill ${doc.is_active ? "pill-neutral" : "pill-danger"}` }, doc.is_active ? "Đang bật" : "Đã tắt");
      const chunksCountBadge = el("span", { class: "pill pill-neutral" }, `${doc.chunks ?? 0} đoạn`);
      const dateBadge = el("span", { class: "kpi-note" }, `Tải lên: ${fmtTime(doc.created_at)}`);
      metaContainer.replaceChildren(statusPill, activePill, chunksCountBadge, dateBadge);
    }

    // Các nút thao tác
    const isBusy = doc.status === "pending" || doc.status === "processing";
    const reprocessBtn = $("#doc-reprocess-btn");
    if (reprocessBtn) {
      reprocessBtn.disabled = isBusy;
      reprocessBtn.onclick = async () => {
        try {
          await api(`/documents/${doc.id}/reprocess`, { method: "POST" });
          toast("Đã đưa tài liệu vào hàng đợi xử lý lại", "success");
          await loadDocuments();
        } catch (err) {
          toast(err.message, "error");
        }
      };
    }

    const toggleBtn = $("#doc-toggle-active-btn");
    if (toggleBtn) {
      toggleBtn.textContent = doc.is_active ? "Tắt" : "Bật";
      toggleBtn.onclick = async () => {
        try {
          await sendJSON("PATCH", `/documents/${doc.id}`, { is_active: !doc.is_active });
          toast(doc.is_active ? "Đã tắt tài liệu" : "Đã bật tài liệu", "success");
          await loadDocuments();
        } catch (err) {
          toast(err.message, "error");
        }
      };
    }

    const deleteBtn = $("#doc-delete-btn");
    if (deleteBtn) {
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
              await loadDocuments();
            } catch (err) {
              toast(err.message, "error");
            }
          },
        });
      };
    }

    // Khối lỗi nếu có
    const errorBox = $("#doc-error-box");
    const errorText = $("#doc-error-box-text");
    if (errorBox && errorText) {
      if (doc.status === "failed" && doc.error) {
        errorBox.hidden = false;
        errorText.textContent = `Lỗi xử lý: ${doc.error}`;
      } else {
        errorBox.hidden = true;
      }
    }

    // Tải các đoạn đã tách (chunks)
    await loadDocumentChunks(id, docChunksOffset);
  } catch (err) {
    toast(err.message, "error");
  }
}

/** Tải danh sách các đoạn đã tách (chunks) kèm phân trang */
async function loadDocumentChunks(id, offset) {
  docChunksOffset = offset;
  const list = $("#chunks-list");
  if (!list) return;

  list.replaceChildren(el("div", { class: "loading-state" }, "Đang tải các đoạn đã tách…"));

  try {
    const data = await api(`/documents/${id}/chunks?limit=${CHUNKS_PER_PAGE}&offset=${offset}`);
    const total = data.total;
    const start = total === 0 ? 0 : offset + 1;
    const end = Math.min(offset + CHUNKS_PER_PAGE, total);

    const rangeLabel = $("#chunks-range-label");
    if (rangeLabel) rangeLabel.textContent = `${start}–${end} / ${total} đoạn`;

    const currentPage = total === 0 ? 1 : Math.floor(offset / CHUNKS_PER_PAGE) + 1;
    const totalPages = Math.max(1, Math.ceil(total / CHUNKS_PER_PAGE));
    const pageIndicator = $("#chunks-page-indicator");
    if (pageIndicator) pageIndicator.textContent = `Trang ${currentPage} / ${totalPages}`;

    const prevBtn = $("#chunks-prev-btn");
    const nextBtn = $("#chunks-next-btn");

    if (prevBtn) {
      prevBtn.disabled = offset === 0;
      prevBtn.onclick = () => loadDocumentChunks(id, Math.max(0, offset - CHUNKS_PER_PAGE));
    }

    if (nextBtn) {
      nextBtn.disabled = offset + CHUNKS_PER_PAGE >= total;
      nextBtn.onclick = () => loadDocumentChunks(id, offset + CHUNKS_PER_PAGE);
    }

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
          el("div", { class: "chunk-meta" }, `Đoạn #${c.id}` + (c.page ? ` · Trang ${c.page}` : "")),
          el("div", { class: "chunk-text" }, c.content)
        )
      )
    );
  } catch (err) {
    list.replaceChildren(el("div", { class: "alert-banner alert-danger" }, err.message));
  }
}

/** Gắn các sự kiện một lần cho trang Tài liệu (mobile back, upload modal & dropzone) */
export function initDocumentsEvents() {
  // 1. Nút quay lại trên Mobile
  const docBackBtn = $("#doc-back-btn");
  if (docBackBtn && !docBackBtn.dataset.initialized) {
    docBackBtn.dataset.initialized = "true";
    docBackBtn.addEventListener("click", () => {
      const masterDetail = $("#doc-master-detail");
      if (masterDetail) {
        masterDetail.classList.remove("mobile-detail-mode");
        masterDetail.classList.add("mobile-list-mode");
      }
    });
  }

  // 2. Modal Tải lên tài liệu
  const openUploadBtn = $("#open-upload-modal-btn");
  const uploadDialog = $("#upload-dialog");
  const uploadForm = $("#upload-dialog-form");
  const fileInput = $("#upload-file-input");
  const selectedName = $("#upload-file-selected-name");
  const uploadStatus = $("#upload-dialog-status");
  const dropzone = $("#upload-dropzone");

  if (openUploadBtn && !openUploadBtn.dataset.initialized) {
    openUploadBtn.dataset.initialized = "true";
    openUploadBtn.addEventListener("click", () => {
      if (uploadForm) uploadForm.reset();
      if (selectedName) selectedName.textContent = "";
      if (uploadStatus) uploadStatus.hidden = true;
      openCustomDialog(uploadDialog, openUploadBtn);
    });
  }

  if (fileInput && !fileInput.dataset.initialized) {
    fileInput.dataset.initialized = "true";
    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      if (selectedName) {
        selectedName.textContent = file ? `${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)` : "";
      }
    });
  }

  // Kéo thả file vào Dropzone
  if (dropzone && !dropzone.dataset.initialized) {
    dropzone.dataset.initialized = "true";
    ["dragenter", "dragover"].forEach((evt) => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add("dragover");
      });
    });

    ["dragleave", "drop"].forEach((evt) => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove("dragover");
      });
    });

    dropzone.addEventListener("drop", (e) => {
      const dt = e.dataTransfer;
      const files = dt?.files;
      if (files && files.length > 0 && fileInput) {
        fileInput.files = files;
        if (selectedName) {
          selectedName.textContent = `${files[0].name} (${(files[0].size / (1024 * 1024)).toFixed(2)} MB)`;
        }
      }
    });
  }

  // Submit form tải lên
  if (uploadForm && !uploadForm.dataset.initialized) {
    uploadForm.dataset.initialized = "true";
    uploadForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const file = fileInput ? fileInput.files[0] : null;
      if (!file) return;

      const submitBtn = $("#upload-submit-btn");
      if (submitBtn) submitBtn.disabled = true;
      if (uploadStatus) {
        uploadStatus.hidden = false;
        uploadStatus.textContent = "Đang tải file lên máy chủ…";
      }

      const form = new FormData();
      form.append("file", file);

      try {
        await api("/documents", { method: "POST", body: form });
        if (uploadStatus) uploadStatus.textContent = "Đã tải lên! Đang đóng...";
        toast("Đã tải lên tài liệu, hệ thống đang xử lý nền", "success");
        setTimeout(() => {
          closeCustomDialog(uploadDialog);
          loadDocuments();
        }, 500);
      } catch (err) {
        if (uploadStatus) uploadStatus.textContent = err.message;
        toast(err.message, "error");
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }
}

