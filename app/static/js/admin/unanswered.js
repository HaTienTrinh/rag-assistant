import { api, sendJSON } from "../core/api.js";
import { el, $, $$ } from "../ui/dom.js";
import { fmtTime } from "../ui/format.js";
import { toast } from "../ui/toast.js";
import { showConfirmDialog } from "../ui/dialog.js";
import { updateSidebarBadge } from "../ui/sidebar.js";

let unansweredFilterStatus = "open";

const REASON_LABEL = {
  low_score: "Không tìm thấy đoạn phù hợp",
  llm_not_found: "Có đoạn gần đúng nhưng chưa đủ để trả lời",
};

/**
 * Tải danh sách câu hỏi chưa trả lời được theo bộ lọc
 */
export async function loadUnanswered() {
  const tbody = $("#unanswered-tbody");
  if (!tbody) return;

  tbody.replaceChildren(
    el("tr", { class: "table-empty-row" },
      el("td", { colspan: "5" }, "Đang tải danh sách câu hỏi chưa trả lời…")
    )
  );

  try {
    const rows = await api(`/admin/unanswered?status=${unansweredFilterStatus}`);

    // Luôn cập nhật badge số câu hỏi đang mở trên sidebar
    if (unansweredFilterStatus === "open") {
      updateSidebarBadge(rows.length);
    } else {
      // Nếu đang xem tab khác, gọi ngầm để đồng bộ badge chính xác
      api("/admin/unanswered?status=open").then((openRows) => {
        updateSidebarBadge(openRows.length);
      }).catch(() => {});
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

/**
 * Tạo một dòng table câu hỏi chưa trả lời
 */
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
          } catch (err) {
            toast(err.message, "error");
          }
        },
      });
    },
  }, "Xóa");

  return el("tr", { class: q.resolved ? "row-inactive" : "" },
    el("td", { class: "question-text-cell" }, q.question),
    el("td", {}, reasonText),
    el("td", { class: "score-cell" }, scoreText),
    el("td", {}, fmtTime(q.created_at)),
    el("td", { class: "col-actions" },
      el("div", { class: "actions-wrap" }, toggleBtn, deleteBtn)
    )
  );
}

/**
 * Gắn sự kiện chuyển tab lọc trạng thái
 */
export function initUnansweredEvents() {
  $$("#tab-unanswered .filter-tab").forEach((tab) => {
    if (!tab.dataset.initialized) {
      tab.dataset.initialized = "true";
      tab.addEventListener("click", () => {
        $$("#tab-unanswered .filter-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        unansweredFilterStatus = tab.dataset.filter;
        loadUnanswered();
      });
    }
  });
}
