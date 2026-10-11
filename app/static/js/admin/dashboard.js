import { api } from "../core/api.js";
import { el, $ } from "../ui/dom.js";
import { createSvg } from "../ui/icons.js";
import { fmtNum } from "../ui/format.js";
import { updateSidebarBadge } from "../ui/sidebar.js";

// Tải và hiển thị dữ liệu trang Tổng quan
export async function loadDashboard() {
  const container = $("#dashboard-content");
  if (!container) return;

  container.replaceChildren(el("div", { class: "loading-state" }, "Đang tải dữ liệu tổng quan…"));

  try {
    // Gọi đồng thời stats 14 ngày và danh sách documents để đếm tài liệu lỗi
    const [stats, docs] = await Promise.all([
      api("/admin/stats?days=14"),
      api("/documents"),
    ]);

    const t = stats.totals;

    // Cập nhật badge số câu hỏi chưa xử lý trên sidebar
    updateSidebarBadge(t.unanswered_open);

    const failedDocs = docs.filter((d) => d.status === "failed");

    // 1. Lưới 4 Thẻ KPI
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
          el("a", { href: "#/unanswered", class: "btn btn-outline btn-sm action-item-btn" }, "Xem danh sách →")
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
          el("a", { href: "#/documents", class: "btn btn-outline btn-sm action-item-btn" }, "Kiểm tra tài liệu →")
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

    // 3. Biểu đồ cột: "Số câu hỏi mỗi ngày" (CSS Flex thuần, tooltip chu đáo)
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

    // 4. Hàng 2 cột: Tài liệu trích dẫn nhiều nhất & Lượng token
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
          el("div", { class: "token-stat-label" }, "14 ngày gần nhất"),
          el("div", { class: "token-stat-vals" },
            `${fmtNum(tk.period.prompt)} đầu vào · ${fmtNum(tk.period.completion)} đầu ra `,
            el("strong", {}, `(tổng ${fmtNum(tk.period.prompt + tk.period.completion)})`)
          )
        ),
        el("div", { class: "token-stat-item" },
          el("div", { class: "token-stat-label" }, "Hôm nay"),
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
