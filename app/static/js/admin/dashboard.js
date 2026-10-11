import { api } from "../core/api.js";
import { el, $ } from "../ui/dom.js";
import { createSvg } from "../ui/icons.js";
import { fmtNum } from "../ui/format.js";
import { updateSidebarBadge } from "../ui/sidebar.js";

/**
 * Đọc tham số period và anchor từ hash của URL (ví dụ #/dashboard?period=month&anchor=2026-09-15)
 */
function getDashboardParamsFromHash() {
  const hash = window.location.hash || "";
  const qIdx = hash.indexOf("?");
  if (qIdx === -1) {
    return { period: "recent", anchor: null };
  }
  const searchParams = new URLSearchParams(hash.slice(qIdx + 1));
  const period = searchParams.get("period") || "recent";
  const anchor = searchParams.get("anchor") || null;
  return { period, anchor };
}

/**
 * Cập nhật hash của URL để lưu kỳ đang xem, hỗ trợ F5 và nút Back/Forward của trình duyệt
 */
function setDashboardParamsInHash(period, anchor) {
  const params = new URLSearchParams();
  if (period && period !== "recent") {
    params.set("period", period);
  }
  if (anchor) {
    params.set("anchor", anchor);
  }
  const queryStr = params.toString();
  const targetHash = queryStr ? `#/dashboard?${queryStr}` : `#/dashboard`;

  if (window.location.hash === targetHash) {
    // Nếu hash không thay đổi, gọi trực tiếp để refresh
    loadDashboard();
  } else {
    // Thay đổi hash sẽ kích hoạt sự kiện hashchange
    window.location.hash = targetHash;
  }
}

/**
 * Tính số tuần ISO từ đối tượng Date
 */
function getISOWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
}

/**
 * Định dạng nhãn hiển thị kỳ hiện tại (tuần, tháng, năm, 14 ngày)
 */
function formatPeriodLabel(data) {
  if (data.period === "week") {
    const [sy, sm, sd] = data.start.split("-").map(Number);
    const [ey, em, ed] = data.end.split("-").map(Number);
    const startDate = new Date(sy, sm - 1, sd);
    const weekNum = getISOWeekNumber(startDate);
    const pad = (n) => String(n).padStart(2, "0");
    return `Tuần ${weekNum} · ${pad(sd)}/${pad(sm)}–${pad(ed)}/${pad(em)}/${ey}`;
  } else if (data.period === "month") {
    const [y, m] = data.start.split("-");
    return `Tháng ${m}/${y}`;
  } else if (data.period === "year") {
    const [y] = data.start.split("-");
    return `Năm ${y}`;
  } else {
    return `${data.days || 14} ngày gần nhất`;
  }
}

/**
 * Tạo chip so sánh số câu hỏi với kỳ liền trước (theo quy tắc Phase UI-1):
 * - +N: Nền xanh nhạt
 * - −N: Nền xám trung tính (dấu trừ toán học \u2212)
 * - = 0: "Không đổi"
 * - kỳ trước = 0 & kỳ này > 0: "Mới"
 * - Cả 2 bằng 0, hoặc prev_anchor null, hoặc lỗi: Trả về null (ẩn chip)
 */
function createComparisonChip(curr, prev, period, days) {
  if (prev === null || prev === undefined) {
    return null; // Không có kỳ trước hoặc request lỗi -> ẩn chip
  }

  // Cả hai đều bằng 0 -> ẩn chip
  if (curr === 0 && prev === 0) {
    return null;
  }

  let periodLabel = "kỳ trước";
  if (period === "week") periodLabel = "tuần trước";
  else if (period === "month") periodLabel = "tháng trước";
  else if (period === "year") periodLabel = "năm trước";
  else periodLabel = `${days || 14} ngày trước`;

  // Nếu kỳ trước là 0 và kỳ này > 0 thì hiển thị "Mới"
  if (prev === 0 && curr > 0) {
    return el("span", { class: "comparison-chip chip-new", title: "Kỳ trước không có câu hỏi nào" }, "Mới");
  }

  const diff = curr - prev;

  if (diff > 0) {
    return el("span", { class: "comparison-chip chip-positive" }, `+${diff} so với ${periodLabel}`);
  } else if (diff < 0) {
    // Dấu trừ toán học − (\u2212)
    return el("span", { class: "comparison-chip chip-neutral" }, `\u2212${Math.abs(diff)} so với ${periodLabel}`);
  } else {
    // diff === 0
    return el("span", { class: "comparison-chip chip-neutral" }, "Không đổi");
  }
}

/**
 * Tạo biểu đồ cột tích hợp nằm trong thẻ chính CÂU HỎI TRONG KỲ (theo "Cách 1")
 * Chiều cao khoảng 120px, gồm header (tiêu đề + đỉnh điểm), các cột và trục hoành
 */
function createIntegratedChart(buckets, granularity) {
  if (!buckets || buckets.length === 0) {
    return el("div", { class: "kpi-main-chart-area empty" }, "Chưa có dữ liệu");
  }

  // 1. Tìm đỉnh điểm (bucket có câu hỏi lớn nhất; nếu bằng nhau lấy bucket đầu tiên; nếu max=0 thì ẩn)
  let peakBucket = null;
  let maxQ = 0;
  for (const b of buckets) {
    if (b.questions > maxQ) {
      maxQ = b.questions;
      peakBucket = b;
    }
  }

  let peakEl = null;
  if (maxQ > 0 && peakBucket) {
    let dateStr = "";
    if (granularity === "month") {
      dateStr = peakBucket.label; // ví dụ "T10"
    } else {
      if (peakBucket.key && peakBucket.key.includes("-")) {
        const parts = peakBucket.key.split("-");
        dateStr = `${parts[2]}/${parts[1]}`;
      } else {
        dateStr = peakBucket.label;
      }
    }
    const unitStr = granularity === "month" ? "câu/tháng" : "câu/ngày";
    peakEl = el("div", { class: "kpi-chart-peak" }, `Đỉnh điểm: ${maxQ} ${unitStr} (${dateStr})`);
  }

  // Tiêu đề nhỏ biểu đồ
  const chartTitleStr = granularity === "month"
    ? "Số câu hỏi mỗi tháng"
    : "Số câu hỏi mỗi ngày";
  const titleEl = el("div", { class: "kpi-chart-title" }, chartTitleStr);

  const headerEl = el("div", { class: "kpi-chart-header" },
    titleEl,
    peakEl || false
  );

  // 2. Vẽ các cột
  const CHART_MAX_H = 75; // Chiều cao tối đa của cột (px)
  const isDense = buckets.length > 20;

  const colElements = buckets.map((b) => {
    const isFuture = !!b.future;
    let heightPx = 0;
    let barClass = "kpi-chart-bar";

    if (isFuture) {
      heightPx = 0;
      barClass += " future";
    } else if (b.questions === 0) {
      heightPx = 3; // Giá trị 0 vẽ thanh mỏng 3px màu xám nhạt như ảnh 2
      barClass += " zero";
    } else {
      heightPx = maxQ > 0
        ? Math.max(6, Math.round((b.questions / maxQ) * CHART_MAX_H))
        : 3;
      barClass += " active";
    }

    const tip = isFuture
      ? `${b.label}: (Tương lai)`
      : `${b.label}: ${b.questions} câu hỏi, ${b.active_users} người dùng hoạt động`;

    return el("div", {
      class: `kpi-chart-col ${isFuture ? "future" : ""}`,
      title: tip,
    },
      el("div", {
        class: barClass,
        style: `height: ${heightPx}px`,
      })
    );
  });

  const barsWrapEl = el("div", { class: `kpi-chart-bars-wrap ${isDense ? "dense" : ""}` }, ...colElements);

  // 3. Trục hoành: Nhãn đầu và cuối
  let startLabel = "";
  let endLabel = "";

  if (granularity === "month") {
    startLabel = buckets[0]?.label || "T1";
    endLabel = buckets[buckets.length - 1]?.label || "T12";
  } else {
    const firstKey = buckets[0]?.key || "";
    const lastKey = buckets[buckets.length - 1]?.key || "";
    if (firstKey.includes("-")) {
      const parts = firstKey.split("-");
      startLabel = `${parts[2]}/${parts[1]}`;
    } else {
      startLabel = buckets[0]?.label || "";
    }
    if (lastKey.includes("-")) {
      const parts = lastKey.split("-");
      endLabel = `${parts[2]}/${parts[1]}`;
    } else {
      endLabel = buckets[buckets.length - 1]?.label || "";
    }
  }

  const axisEl = el("div", { class: "kpi-chart-axis" },
    el("span", { class: "kpi-chart-axis-label" }, startLabel),
    el("span", { class: "kpi-chart-axis-label" }, endLabel)
  );

  return el("div", { class: "kpi-main-chart-area" },
    headerEl,
    barsWrapEl,
    axisEl
  );
}


/**
 * Tải và hiển thị dữ liệu trang Tổng quan
 */
export async function loadDashboard() {
  const container = $("#dashboard-content");
  if (!container) return;

  container.replaceChildren(el("div", { class: "loading-state" }, "Đang tải dữ liệu tổng quan…"));

  const { period, anchor } = getDashboardParamsFromHash();

  const queryParams = new URLSearchParams();
  if (period) queryParams.set("period", period);
  if (anchor) queryParams.set("anchor", anchor);
  if (period === "recent") queryParams.set("days", "14");

  try {
    // 1. Tải song song stats kỳ hiện tại và danh sách documents
    const statsPromise = api(`/admin/stats?${queryParams.toString()}`);
    const docsPromise = api("/documents");

    const stats = await statsPromise;

    // 2. Tải song song stats kỳ liền trước để tính chip so sánh (nếu có prev_anchor)
    let prevStatsPromise = Promise.resolve(null);
    if (stats.prev_anchor) {
      const prevParams = new URLSearchParams();
      prevParams.set("period", stats.period);
      prevParams.set("anchor", stats.prev_anchor);
      if (stats.period === "recent") {
        prevParams.set("days", String(stats.days || 14));
      }
      prevStatsPromise = api(`/admin/stats?${prevParams.toString()}`).catch((e) => {
        console.warn("Không thể tải dữ liệu kỳ trước để tính so sánh:", e);
        return null;
      });
    }

    const [docs, prevStats] = await Promise.all([docsPromise, prevStatsPromise]);

    const t = stats.totals;
    const pt = stats.period_totals || {
      questions: 0,
      active_users: 0,
      tokens: { prompt: 0, completion: 0 },
    };

    // Cập nhật phụ đề trang
    const subtitleEl = $("#dashboard-subtitle");
    if (subtitleEl) {
      subtitleEl.textContent = `Hoạt động của hệ thống theo ${
        stats.period === "week"
          ? "tuần"
          : stats.period === "month"
          ? "tháng"
          : stats.period === "year"
          ? "năm"
          : "14 ngày gần nhất"
      }`;
    }

    // Cập nhật badge số câu hỏi chưa xử lý trên sidebar
    updateSidebarBadge(t.unanswered_open);

    const failedDocs = docs.filter((d) => d.status === "failed");

    
    // 1. THANH ĐIỀU KHIỂN KỲ THỐNG KÊ 
    
    const periodButtons = [
      { key: "recent", label: "14 ngày" },
      { key: "week", label: "Tuần" },
      { key: "month", label: "Tháng" },
      { key: "year", label: "Năm" },
    ].map((item) => {
      const isActive = stats.period === item.key;
      return el("button", {
        type: "button",
        class: `segment-btn ${isActive ? "active" : ""}`,
        onclick: () => setDashboardParamsInHash(item.key, null),
      }, item.label);
    });

    const segmentsEl = el("div", { class: "period-segments", role: "group", "aria-label": "Chọn khoảng thời gian" },
      ...periodButtons
    );

    const prevBtn = el("button", {
      type: "button",
      class: "icon-btn nav-arrow-btn",
      title: "Kỳ trước",
      "aria-label": "Kỳ trước",
      disabled: !stats.prev_anchor,
      onclick: () => setDashboardParamsInHash(stats.period, stats.prev_anchor),
    }, createSvg("chevron-left", 16, 16));

    const nextBtn = el("button", {
      type: "button",
      class: "icon-btn nav-arrow-btn",
      title: "Kỳ sau",
      "aria-label": "Kỳ sau",
      disabled: !stats.next_anchor,
      onclick: () => {
        if (stats.next_anchor) {
          setDashboardParamsInHash(stats.period, stats.next_anchor);
        }
      },
    }, createSvg("chevron-right", 16, 16));

    const todayBtn = el("button", {
      type: "button",
      class: "btn btn-outline btn-sm today-btn",
      title: "Xem kỳ hiện tại",
      onclick: () => setDashboardParamsInHash(stats.period, null),
    }, "Hôm nay");

    const currentLabelEl = el("div", { class: "period-current-label", id: "period-label" },
      formatPeriodLabel(stats)
    );

    const navigatorEl = el("div", { class: "period-navigator" },
      prevBtn,
      currentLabelEl,
      nextBtn,
      todayBtn
    );

    const controlsBar = el("div", { class: "dashboard-controls-bar card" },
      segmentsEl,
      navigatorEl
    );

    
    // 2. HÀNG 1: "CÂU HỎI TRONG KỲ" TÍCH HỢP BIỂU ĐỒ (CÁCH 1)
    
    // Tính Trung bình: tổng câu hỏi chia số bucket không thuộc tương lai
    const buckets = stats.buckets || [];
    const validBuckets = buckets.filter((b) => !b.future);
    let avgFormatted = "0";
    if (validBuckets.length > 0) {
      const totalValidQ = validBuckets.reduce((sum, b) => sum + b.questions, 0);
      const avgVal = totalValidQ / validBuckets.length;
      avgFormatted = avgVal.toLocaleString("vi-VN", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      });
    }
    const avgUnit = stats.granularity === "month" ? "câu/tháng" : "câu/ngày";
    const avgNote = `Trung bình ${avgFormatted} ${avgUnit}`;

    const prevQuestions = prevStats?.period_totals?.questions ?? null;
    const comparisonChip = createComparisonChip(pt.questions, prevQuestions, stats.period, stats.days);

    const mainMetricCol = el("div", { class: "kpi-main-metric-col" },
      el("div", { class: "kpi-main-label" }, "CÂU HỎI TRONG KỲ"),
      el("div", { class: "kpi-main-val" }, fmtNum(pt.questions)),
      comparisonChip || false,
      el("div", { class: "kpi-main-avg-note" }, avgNote)
    );

    const integratedChartEl = createIntegratedChart(buckets, stats.granularity);

    const mainCard = el("div", { class: "card kpi-main-card" },
      mainMetricCol,
      integratedChartEl
    );

    // Cột phụ gồm hai thẻ xếp dọc: Người dùng hoạt động + Token trong kỳ
    const activeUsersCard = el("div", { class: "card kpi-side-card" },
      el("div", { class: "kpi-side-label" }, "Người dùng hoạt động"),
      el("div", { class: "kpi-side-val" }, fmtNum(pt.active_users)),
      el("div", { class: "kpi-side-note" }, `trên tổng ${t.users} tài khoản`)
    );

    const periodTokenTotal = (pt.tokens?.prompt || 0) + (pt.tokens?.completion || 0);
    const promptTokens = pt.tokens?.prompt || 0;
    const completionTokens = pt.tokens?.completion || 0;

    let ratioBar;
    if (periodTokenTotal > 0) {
      const promptPct = Math.round((promptTokens / periodTokenTotal) * 100);
      const completionPct = 100 - promptPct;
      ratioBar = el("div", {
        class: "token-ratio-bar",
        title: `${fmtNum(promptTokens)} vào (${promptPct}%) · ${fmtNum(completionTokens)} ra (${completionPct}%)`
      },
        el("div", { class: "token-ratio-prompt", style: `width: ${promptPct}%` }),
        el("div", { class: "token-ratio-completion", style: `width: ${completionPct}%` })
      );
    } else {
      ratioBar = el("div", { class: "token-ratio-bar empty", title: "0 vào · 0 ra" },
        el("div", { class: "token-ratio-empty" })
      );
    }

    const tokenNote = periodTokenTotal > 0
      ? `${fmtNum(promptTokens)} vào · ${fmtNum(completionTokens)} ra`
      : "0 vào · 0 ra";

    const tokenCard = el("div", { class: "card kpi-side-card" },
      el("div", { class: "kpi-side-label" }, "Token trong kỳ"),
      el("div", { class: "kpi-side-val" }, fmtNum(periodTokenTotal)),
      ratioBar,
      el("div", { class: "kpi-side-note" }, tokenNote)
    );

    const sideCol = el("div", { class: "kpi-side-col" }, activeUsersCard, tokenCard);
    const row1Section = el("div", { class: "dashboard-kpi-row-1" }, mainCard, sideCol);

    
    // 3. HÀNG 2: "HIỆN TẠI" DẢI NGANG (CÁCH 1)
    
    const currentItems = [];

    // Nhãn nhỏ "HIỆN TẠI"
    currentItems.push(
      el("span", { class: "current-strip-badge" }, "HIỆN TẠI")
    );

    // Người dùng hoạt động / tổng
    currentItems.push(
      el("div", { class: "current-strip-item" },
        el("span", { class: "current-item-label" }, "Người dùng "),
        el("strong", { class: "current-item-val" }, `${t.users_active}/${t.users}`)
      )
    );

    // Tài liệu hoàn tất · N đoạn
    currentItems.push(
      el("div", { class: "current-strip-item" },
        el("span", { class: "current-item-label" }, "Tài liệu "),
        el("strong", { class: "current-item-val" }, String(t.documents_done)),
        el("span", { class: "current-item-sub" }, ` · ${fmtNum(t.chunks)} đoạn`)
      )
    );

    // Câu hỏi chưa trả lời
    if (t.unanswered_open > 0) {
      currentItems.push(
        el("div", { class: "current-strip-action-group" },
          el("span", { class: "pill-unanswered-warning" },
            `${t.unanswered_open} câu hỏi chưa trả lời`
          ),
          el("a", {
            href: "#/unanswered",
            class: "current-strip-link",
            "aria-label": "Chuyển tới mục Chưa trả lời được để xử lý",
          }, "Xử lý")
        )
      );
    } else {
      currentItems.push(
        el("span", { class: "pill-unanswered-ok" }, "Không có câu hỏi chờ xử lý")
      );
    }

    // Tài liệu lỗi (nếu có tài liệu failed)
    if (failedDocs.length > 0) {
      currentItems.push(
        el("div", { class: "current-strip-action-group" },
          el("span", { class: "pill-failed-danger" },
            `${failedDocs.length} tài liệu lỗi`
          ),
          el("a", {
            href: "#/documents",
            class: "current-strip-link link-danger",
            "aria-label": "Chuyển tới mục Tài liệu để kiểm tra lỗi",
          }, "Xử lý")
        )
      );
    }

    const currentStrip = el("div", { class: "card kpi-current-strip" }, ...currentItems);

    
    // 5. HÀNG 2 CỘT: TOP TÀI LIỆU & LƯỢNG TOKEN
    
    const topDocs = stats.top_documents || [];
    const maxCitations = Math.max(1, ...topDocs.map((d) => d.citations));
    const citationRows = topDocs.length > 0
      ? topDocs.map((d) => {
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
      : [el("div", { class: "loading-state" }, "Chưa có dữ liệu trích dẫn tài liệu trong kỳ này.")];

    const citationsCard = el("div", { class: "card" },
      el("div", { class: "card-header" },
        el("div", { class: "card-title" }, "Tài liệu được trích dẫn nhiều nhất (trong kỳ)")
      ),
      el("div", { class: "citation-list" }, ...citationRows),
      stats.truncated
        ? el("div", { class: "truncated-note" }, "* Số liệu tính trên 20.000 câu trả lời gần nhất trong kỳ.")
        : false
    );

    const tk = stats.tokens || { period: { prompt: 0, completion: 0 }, today: { prompt: 0, completion: 0 } };
    const tokensCard = el("div", { class: "card" },
      el("div", { class: "card-header" },
        el("div", { class: "card-title" }, "Lượng token")
      ),
      el("div", { class: "tokens-stats-list" },
        el("div", { class: "token-stat-item" },
          el("div", { class: "token-stat-label" }, `Trong kỳ (${formatPeriodLabel(stats)})`),
          el("div", { class: "token-stat-vals" },
            `${fmtNum(tk.period.prompt)} đầu vào · ${fmtNum(tk.period.completion)} đầu ra `)
        ),
        el("div", { class: "token-stat-item" },
          el("div", { class: "token-stat-label" }, "Hôm nay"),
          el("div", { class: "token-stat-vals" },
            `${fmtNum(tk.today.prompt)} đầu vào · ${fmtNum(tk.today.completion)} đầu ra `)
        )
      ),
      el("p", { class: "kpi-note", style: "margin-top: 14px;" },
        "Số liệu tính từ tin nhắn trợ lý có ghi nhận token."
      )
    );

    const twoColRow = el("div", { class: "dashboard-row" }, citationsCard, tokensCard);

    container.replaceChildren(
      controlsBar,
      row1Section,
      currentStrip,
      twoColRow
    );
  } catch (err) {
    container.replaceChildren(
      el("div", { class: "alert-banner alert-danger" }, err.message || "Không thể tải dữ liệu tổng quan")
    );
  }
}
