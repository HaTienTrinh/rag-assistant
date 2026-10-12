import { getAccessToken } from "../core/auth.js";
import { openCustomDialog, closeCustomDialog, showConfirmDialog } from "../ui/dialog.js";
import { toast } from "../ui/toast.js";
import { el } from "../ui/dom.js";
import { createSvg } from "../ui/icons.js";

// Trạng thái module phiên làm việc
let currentStep = 1;
let selectedFile = null;
let previewData = null;
let createdData = null;
let isProcessing = false;
let hasExportedOrCopied = false;
let areAllPasswordsVisible = false;
let rowPasswordVisibility = {}; // row_index -> boolean

let onUsersCreatedCallback = null;

// Tham chiếu phần tử DOM
let dialogEl = null;
let triggerBtnEl = null;
let fileInputEl = null;
let dropzoneEl = null;
let fileBadgeEl = null;
let dailyLimitInputEl = null;
let requireChangeCheckboxEl = null;
let downloadTemplateBtnEl = null;

let step1Container = null;
let step2Container = null;
let step3Container = null;

let stepper1 = null;
let stepper2 = null;
let stepper3 = null;

let step1Loading = null;
let step1Error = null;
let step1ErrorMsg = null;

let chipValid = null;
let chipInvalid = null;
let chipDuplicate = null;
let chipExists = null;
let chipTrash = null;

let filterErrorsOnlyEl = null;
let previewTbodyEl = null;
let step2Progress = null;
let step2ProgressText = null;

let step3SummaryText = null;
let toggleAllPwdBtn = null;
let toggleAllPwdText = null;
let copyAllBtn = null;
let downloadCsvBtn = null;
let resultsTbodyEl = null;

let footerCancelBtn = null;
let submitCreateBtn = null;
let finishCloseBtn = null;
let closeHeaderBtn = null;
let reselectFileBtn = null;

/**
 * Xóa toàn bộ dữ liệu trong bộ nhớ và làm sạch giao diện DOM khi đóng modal
 */
function cleanupAndReset() {
  currentStep = 1;
  selectedFile = null;
  previewData = null;
  createdData = null;
  isProcessing = false;
  hasExportedOrCopied = false;
  areAllPasswordsVisible = false;
  rowPasswordVisibility = {};

  if (fileInputEl) fileInputEl.value = "";
  if (fileBadgeEl) {
    fileBadgeEl.textContent = "";
    fileBadgeEl.hidden = true;
  }
  if (dailyLimitInputEl) dailyLimitInputEl.value = "";
  if (requireChangeCheckboxEl) requireChangeCheckboxEl.checked = true;

  if (step1Loading) step1Loading.hidden = true;
  if (step1Error) step1Error.hidden = true;
  if (step1ErrorMsg) step1ErrorMsg.textContent = "";

  if (filterErrorsOnlyEl) filterErrorsOnlyEl.checked = false;
  if (previewTbodyEl) previewTbodyEl.replaceChildren();
  if (resultsTbodyEl) resultsTbodyEl.replaceChildren();
  if (step2Progress) step2Progress.hidden = true;

  setControlsDisabled(false);
  goToStep(1);
}

/**
 * Khóa hoặc mở khóa các điều khiển trong hộp thoại khi đang xử lý
 */
function setControlsDisabled(disabled) {
  isProcessing = disabled;
  if (footerCancelBtn) footerCancelBtn.disabled = disabled;
  if (submitCreateBtn) submitCreateBtn.disabled = disabled;
  if (closeHeaderBtn) closeHeaderBtn.disabled = disabled;
  if (reselectFileBtn) reselectFileBtn.disabled = disabled;
  if (filterErrorsOnlyEl) filterErrorsOnlyEl.disabled = disabled;
  if (downloadTemplateBtnEl) downloadTemplateBtnEl.disabled = disabled;
}

/**
 * Chuyển đổi giữa các bước (1, 2, 3)
 */
function goToStep(step) {
  currentStep = step;

  if (step1Container) step1Container.hidden = step !== 1;
  if (step2Container) step2Container.hidden = step !== 2;
  if (step3Container) step3Container.hidden = step !== 3;

  // Cập nhật giao diện Stepper
  const updateStepper = (elNode, stepNum) => {
    if (!elNode) return;
    elNode.classList.remove("active", "completed");
    if (step === stepNum) {
      elNode.classList.add("active");
    } else if (step > stepNum) {
      elNode.classList.add("completed");
    }
  };

  updateStepper(stepper1, 1);
  updateStepper(stepper2, 2);
  updateStepper(stepper3, 3);

  // Cập nhật các nút ở footer
  if (step === 1) {
    if (footerCancelBtn) footerCancelBtn.hidden = false;
    if (submitCreateBtn) submitCreateBtn.hidden = true;
    if (finishCloseBtn) finishCloseBtn.hidden = true;
  } else if (step === 2) {
    if (footerCancelBtn) footerCancelBtn.hidden = false;
    if (submitCreateBtn) submitCreateBtn.hidden = false;
    if (finishCloseBtn) finishCloseBtn.hidden = true;
  } else if (step === 3) {
    if (footerCancelBtn) footerCancelBtn.hidden = true;
    if (submitCreateBtn) submitCreateBtn.hidden = true;
    if (finishCloseBtn) finishCloseBtn.hidden = false;
  }
}

/**
 * Tải file Excel mẫu qua API có token xác thực
 */
async function handleDownloadTemplate() {
  try {
    const token = getAccessToken();
    const res = await fetch("/admin/users-import/template", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.detail || "Không thể tải file mẫu");
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mau-tao-tai-khoan.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    toast(err.message || "Lỗi khi tải file mẫu", "error");
  }
}

/**
 * Xử lý khi chọn file: xác thực định dạng và tự động gọi dry_run
 */
async function handleFileSelection(file) {
  if (!file) return;

  const fname = file.name.toLowerCase();
  if (!fname.endsWith(".xlsx") && !fname.endsWith(".csv")) {
    if (step1Error) step1Error.hidden = false;
    if (step1ErrorMsg) step1ErrorMsg.textContent = "Chỉ chấp nhận file định dạng Excel (.xlsx) hoặc CSV (.csv)";
    return;
  }

  if (file.size > 2 * 1024 * 1024) {
    if (step1Error) step1Error.hidden = false;
    if (step1ErrorMsg) step1ErrorMsg.textContent = `Kích thước file (${(file.size / (1024 * 1024)).toFixed(2)} MB) vượt quá giới hạn 2 MB`;
    return;
  }

  selectedFile = file;
  if (fileBadgeEl) {
    fileBadgeEl.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    fileBadgeEl.hidden = false;
  }

  if (step1Error) step1Error.hidden = true;
  if (step1ErrorMsg) step1ErrorMsg.textContent = "";

  await runDryRun();
}

/**
 * Thực hiện gọi API dry_run để kiểm tra tính hợp lệ và xem trước
 */
async function runDryRun() {
  if (!selectedFile) return;

  if (step1Loading) step1Loading.hidden = false;
  if (step1Error) step1Error.hidden = true;
  setControlsDisabled(true);

  try {
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("dry_run", "true");

    const limitVal = dailyLimitInputEl?.value?.trim();
    if (limitVal) {
      formData.append("daily_limit", limitVal);
    }
    formData.append("require_password_change", requireChangeCheckboxEl?.checked ? "true" : "false");

    const token = getAccessToken();
    const res = await fetch("/admin/users-import", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      let detail = "Không thể đọc dữ liệu file";
      if (data && typeof data.detail === "string") {
        detail = data.detail;
      } else if (data && Array.isArray(data.detail)) {
        detail = data.detail.map((d) => d.msg || JSON.stringify(d)).join("; ");
      }
      throw new Error(detail);
    }

    previewData = data;
    renderPreview(data);
    goToStep(2);
  } catch (err) {
    if (step1Error) step1Error.hidden = false;
    if (step1ErrorMsg) step1ErrorMsg.textContent = err.message || "Lỗi khi xử lý file";
  } finally {
    if (step1Loading) step1Loading.hidden = true;
    setControlsDisabled(false);
  }
}

/**
 * Render chip tổng hợp và danh sách dòng xem trước ở Bước 2
 */
function renderPreview(data) {
  const summary = data.summary || {};
  if (chipValid) chipValid.textContent = summary.valid || 0;
  if (chipInvalid) chipInvalid.textContent = summary.invalid || 0;
  if (chipDuplicate) chipDuplicate.textContent = summary.duplicate_in_file || 0;
  if (chipExists) chipExists.textContent = summary.exists || 0;
  if (chipTrash) chipTrash.textContent = summary.in_trash || 0;

  const validCount = summary.valid || 0;
  if (submitCreateBtn) {
    submitCreateBtn.textContent = `Tạo ${validCount} tài khoản`;
    submitCreateBtn.disabled = validCount === 0;
  }

  filterAndRenderPreviewRows();
}

/**
 * Lọc và render bảng xem trước theo bộ lọc "Chỉ hiện dòng lỗi"
 */
function filterAndRenderPreviewRows() {
  if (!previewTbodyEl || !previewData) return;
  previewTbodyEl.replaceChildren();

  const onlyErrors = filterErrorsOnlyEl?.checked;
  const rows = previewData.rows || [];

  const filtered = onlyErrors ? rows.filter((r) => r.status !== "valid") : rows;

  if (filtered.length === 0) {
    const emptyRow = el("tr", { class: "table-empty-row" },
      el("td", { colspan: "4" }, onlyErrors ? "Không có dòng lỗi nào." : "Không có dữ liệu để hiển thị.")
    );
    previewTbodyEl.appendChild(emptyRow);
    return;
  }

  for (const r of filtered) {
    let pillClass = "pill-neutral";
    let statusLabel = r.status;

    if (r.status === "valid") {
      pillClass = "pill-success";
      statusLabel = "Hợp lệ";
    } else if (r.status === "invalid") {
      pillClass = "pill-danger";
      statusLabel = "Sai định dạng";
    } else if (r.status === "duplicate_in_file") {
      pillClass = "pill-warning";
      statusLabel = "Trùng trong file";
    } else if (r.status === "exists") {
      pillClass = "pill-neutral";
      statusLabel = "Đã tồn tại";
    } else if (r.status === "in_trash") {
      pillClass = "pill-neutral";
      statusLabel = "Thùng rác";
    }

    const tr = el("tr", {},
      el("td", {}, String(r.row)),
      el("td", { style: "font-weight: 500;" }, r.email),
      el("td", {}, el("span", { class: `pill ${pillClass}` }, statusLabel)),
      el("td", { style: "color: var(--text-muted);" }, r.message || "")
    );
    previewTbodyEl.appendChild(tr);
  }
}

/**
 * Thực hiện tạo tài khoản thật ở Bước 2 khi bấm "Tạo N tài khoản"
 */
async function executeCreation() {
  if (!selectedFile || isProcessing) return;

  const validCount = previewData?.summary?.valid || 0;
  if (validCount === 0) return;

  setControlsDisabled(true);
  if (step2Progress) step2Progress.hidden = false;
  if (step2ProgressText) {
    step2ProgressText.textContent = validCount > 50
      ? `Đang tạo ${validCount} tài khoản... quá trình này có thể mất vài chục giây do băm mật khẩu bảo mật, vui lòng đợi.`
      : `Đang tạo ${validCount} tài khoản, vui lòng đợi...`;
  }

  try {
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("dry_run", "false");

    const limitVal = dailyLimitInputEl?.value?.trim();
    if (limitVal) {
      formData.append("daily_limit", limitVal);
    }
    formData.append("require_password_change", requireChangeCheckboxEl?.checked ? "true" : "false");

    const token = getAccessToken();
    const res = await fetch("/admin/users-import", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      let detail = "Không thể tạo tài khoản hàng loạt";
      if (data && typeof data.detail === "string") {
        detail = data.detail;
      } else if (data && Array.isArray(data.detail)) {
        detail = data.detail.map((d) => d.msg || JSON.stringify(d)).join("; ");
      }
      throw new Error(detail);
    }

    createdData = data;
    renderResults(data);
    goToStep(3);
  } catch (err) {
    toast(err.message || "Lỗi khi tạo tài khoản", "error");
  } finally {
    if (step2Progress) step2Progress.hidden = true;
    setControlsDisabled(false);
  }
}

/**
 * Render bảng kết quả và mật khẩu tạm ở Bước 3
 */
function renderResults(data) {
  rowPasswordVisibility = {};
  areAllPasswordsVisible = false;
  updateToggleAllBtnText();

  const createdCount = data.summary?.created || 0;
  const total = data.total_rows || 0;
  const failedCount = total - createdCount;

  if (step3SummaryText) {
    step3SummaryText.textContent = failedCount > 0
      ? `Đã tạo thành công ${createdCount} tài khoản. Bỏ qua / thất bại ${failedCount} dòng.`
      : `Đã tạo thành công toàn bộ ${createdCount} tài khoản.`;
  }

  if (!resultsTbodyEl) return;
  resultsTbodyEl.replaceChildren();

  const rows = data.rows || [];
  for (const r of rows) {
    const isCreated = r.status === "created";
    const pwd = r.password || "";

    // Ô mật khẩu tạm (ẩn mặc định)
    let pwdCell;
    let actionsCell;

    if (isCreated && pwd) {
      const pwdValSpan = el("span", {
        class: "password-masked-val is-masked",
        id: `pwd-val-${r.row}`,
      }, "••••••••••••");

      const toggleBtn = el("button", {
        type: "button",
        class: "icon-btn",
        title: "Hiện/Ẩn mật khẩu",
        "aria-label": `Hiện hoặc ẩn mật khẩu dòng ${r.row}`,
        onclick: () => toggleRowPassword(r.row, pwd, pwdValSpan, toggleBtn),
      }, createSvg("eye", 14, 14));

      pwdCell = el("td", {},
        el("div", { class: "password-masked-wrap" }, pwdValSpan, toggleBtn)
      );

      const copyBtn = el("button", {
        type: "button",
        class: "btn btn-outline btn-sm",
        title: "Sao chép email và mật khẩu",
        onclick: () => copySingleCredential(r.email, pwd),
      }, createSvg("copy", 12, 12), el("span", {}, "Sao chép"));

      actionsCell = el("td", { style: "text-align: right;" }, copyBtn);
    } else {
      pwdCell = el("td", { style: "color: var(--text-muted); font-style: italic;" }, "—");
      actionsCell = el("td", { style: "text-align: right; color: var(--text-muted);" }, "—");
    }

    const tr = el("tr", {},
      el("td", {}, String(r.row)),
      el("td", { style: "font-weight: 500;" }, r.email),
      pwdCell,
      el("td", {},
        el("span", {
          class: isCreated ? "pill pill-success" : "pill pill-neutral"
        }, isCreated ? "Đã tạo" : (r.message || r.status))
      ),
      actionsCell
    );

    resultsTbodyEl.appendChild(tr);
  }
}

/**
 * Ẩn / hiện mật khẩu của một dòng đơn lẻ
 */
function toggleRowPassword(rowIdx, pwd, valSpan, btn) {
  const isCurrentlyVisible = !!rowPasswordVisibility[rowIdx];
  const nextVisible = !isCurrentlyVisible;
  rowPasswordVisibility[rowIdx] = nextVisible;

  if (nextVisible) {
    valSpan.textContent = pwd;
    valSpan.classList.remove("is-masked");
    btn.replaceChildren(createSvg("eye-off", 14, 14));
  } else {
    valSpan.textContent = "••••••••••••";
    valSpan.classList.add("is-masked");
    btn.replaceChildren(createSvg("eye", 14, 14));
  }
}

/**
 * Cập nhật nút Hiện/Ẩn tất cả mật khẩu
 */
function updateToggleAllBtnText() {
  if (toggleAllPwdText) {
    toggleAllPwdText.textContent = areAllPasswordsVisible
      ? "Ẩn tất cả mật khẩu"
      : "Hiện tất cả mật khẩu";
  }
}

/**
 * Bật / tắt hiển thị toàn bộ mật khẩu ở Bước 3
 */
function toggleAllPasswords() {
  areAllPasswordsVisible = !areAllPasswordsVisible;
  updateToggleAllBtnText();

  const rows = createdData?.rows || [];
  for (const r of rows) {
    if (r.status !== "created" || !r.password) continue;
    rowPasswordVisibility[r.row] = areAllPasswordsVisible;

    const valSpan = document.getElementById(`pwd-val-${r.row}`);
    if (valSpan) {
      if (areAllPasswordsVisible) {
        valSpan.textContent = r.password;
        valSpan.classList.remove("is-masked");
      } else {
        valSpan.textContent = "••••••••••••";
        valSpan.classList.add("is-masked");
      }
    }
  }
}

/**
 * Sao chép một tài khoản đơn lẻ
 */
function copySingleCredential(email, password) {
  const text = `${email}\t${password}`;
  navigator.clipboard.writeText(text).then(() => {
    toast(`Đã sao chép tài khoản ${email}`, "success");
    hasExportedOrCopied = true;
  }).catch(() => {
    toast("Không thể truy cập clipboard", "error");
  });
}

/**
 * Sao chép toàn bộ danh sách tài khoản đã tạo (email<TAB>mật khẩu)
 */
function copyAllCredentials() {
  const rows = createdData?.rows || [];
  const createdRows = rows.filter((r) => r.status === "created" && r.password);

  if (createdRows.length === 0) {
    toast("Không có tài khoản nào để sao chép", "warning");
    return;
  }

  const text = createdRows.map((r) => `${r.email}\t${r.password}`).join("\n");
  navigator.clipboard.writeText(text).then(() => {
    toast(`Đã sao chép ${createdRows.length} tài khoản vào clipboard`, "success");
    hasExportedOrCopied = true;
  }).catch(() => {
    toast("Không thể truy cập clipboard", "error");
  });
}

/**
 * Thoát ô CSV và chống tiêm công thức (CSV formula injection)
 */
function escapeCsvCell(val) {
  let str = String(val ?? "");
  // Chống injection: ô bắt đầu bằng =, +, -, @, \t, \r, \n -> thêm dấu nháy đơn '
  if (/^[=+\-@\t\r\n]/.test(str)) {
    str = "'" + str;
  }
  // Bọc dấu ngoặc kép nếu chứa dấu phẩy, ngoặc kép hoặc xuống dòng
  if (/[",\r\n]/.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Tải file CSV kết quả phía client với UTF-8 BOM
 */
function downloadResultsCsv() {
  const rows = createdData?.rows || [];
  if (rows.length === 0) {
    toast("Không có dữ liệu để xuất file", "warning");
    return;
  }

  const headers = ["Email", "Mật khẩu tạm", "Trạng thái"];
  const lines = [headers.map(escapeCsvCell).join(",")];

  for (const r of rows) {
    const email = r.email;
    const pwd = r.status === "created" ? (r.password || "") : "";
    const statusText = r.status === "created" ? "Đã tạo" : (r.message || r.status);
    lines.push([escapeCsvCell(email), escapeCsvCell(pwd), escapeCsvCell(statusText)].join(","));
  }

  // Thêm BOM UTF-8 (\uFEFF) để Excel hiển thị đúng dấu tiếng Việt
  const csvContent = "\uFEFF" + lines.join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const filename = `ket-qua-tao-tai-khoan-${yyyy}${mm}${dd}-${hh}${min}.csv`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  hasExportedOrCopied = true;
  toast("Đã tải xuống file kết quả", "success");
}

/**
 * Yêu cầu đóng modal: kiểm tra xác nhận nếu người dùng chưa tải CSV hoặc sao chép ở Bước 3
 */
function requestCloseModal() {
  if (isProcessing) return; // Chặn đóng trong lúc đang xử lý tạo

  const createdCount = createdData?.summary?.created || 0;
  if (currentStep === 3 && createdCount > 0 && !hasExportedOrCopied) {
    showConfirmDialog({
      title: "Chưa lưu danh sách mật khẩu",
      message: "Mật khẩu tạm chỉ hiển thị một lần và sẽ bị xóa khỏi bộ nhớ ngay khi đóng. Bạn có chắc chắn muốn đóng mà chưa tải file CSV hoặc sao chép mật khẩu?",
      isDanger: true,
      okText: "Vẫn đóng",
      cancelText: "Quay lại để lưu",
      onConfirm: () => {
        finishAndClose();
      },
    });
    return;
  }

  finishAndClose();
}

/**
 * Hoàn tất đóng modal, dọn sạch dữ liệu và kích hoạt làm mới danh sách
 */
function finishAndClose() {
  const createdCount = createdData?.summary?.created || 0;
  closeCustomDialog(dialogEl);
  cleanupAndReset();

  if (createdCount > 0) {
    toast(`Đã tạo thành công ${createdCount} tài khoản`, "success");
    if (typeof onUsersCreatedCallback === "function") {
      onUsersCreatedCallback();
    }
  }
}

/**
 * Khởi tạo toàn bộ sự kiện cho modal tạo tài khoản hàng loạt
 */
export function initUsersImportEvents(options = {}) {
  onUsersCreatedCallback = options.onUsersCreated || null;

  dialogEl = document.getElementById("bulk-import-dialog");
  triggerBtnEl = document.getElementById("open-bulk-import-modal-btn");
  fileInputEl = document.getElementById("bulk-file-input");
  dropzoneEl = document.getElementById("bulk-dropzone");
  fileBadgeEl = document.getElementById("bulk-file-info-badge");
  dailyLimitInputEl = document.getElementById("bulk-daily-limit");
  requireChangeCheckboxEl = document.getElementById("bulk-require-password-change");
  downloadTemplateBtnEl = document.getElementById("bulk-download-template-btn");

  step1Container = document.getElementById("bulk-step-1");
  step2Container = document.getElementById("bulk-step-2");
  step3Container = document.getElementById("bulk-step-3");

  stepper1 = document.getElementById("bulk-stepper-1");
  stepper2 = document.getElementById("bulk-stepper-2");
  stepper3 = document.getElementById("bulk-stepper-3");

  step1Loading = document.getElementById("bulk-step1-loading");
  step1Error = document.getElementById("bulk-step1-error");
  step1ErrorMsg = document.getElementById("bulk-step1-error-msg");

  chipValid = document.getElementById("bulk-summary-valid");
  chipInvalid = document.getElementById("bulk-summary-invalid");
  chipDuplicate = document.getElementById("bulk-summary-duplicate");
  chipExists = document.getElementById("bulk-summary-exists");
  chipTrash = document.getElementById("bulk-summary-trash");

  filterErrorsOnlyEl = document.getElementById("bulk-filter-errors-only");
  previewTbodyEl = document.getElementById("bulk-preview-tbody");
  step2Progress = document.getElementById("bulk-step2-progress");
  step2ProgressText = document.getElementById("bulk-step2-progress-text");

  step3SummaryText = document.getElementById("bulk-step3-summary-text");
  toggleAllPwdBtn = document.getElementById("bulk-toggle-all-passwords-btn");
  toggleAllPwdText = document.getElementById("bulk-toggle-all-passwords-text");
  copyAllBtn = document.getElementById("bulk-copy-all-btn");
  downloadCsvBtn = document.getElementById("bulk-download-csv-btn");
  resultsTbodyEl = document.getElementById("bulk-results-tbody");

  footerCancelBtn = document.getElementById("bulk-footer-cancel-btn");
  submitCreateBtn = document.getElementById("bulk-submit-create-btn");
  finishCloseBtn = document.getElementById("bulk-finish-close-btn");
  closeHeaderBtn = document.getElementById("bulk-dialog-close-btn");
  reselectFileBtn = document.getElementById("bulk-step2-reselect-btn");

  if (!dialogEl || !triggerBtnEl) return;

  // 1. Mở modal khi bấm nút "Tạo hàng loạt"
  triggerBtnEl.addEventListener("click", () => {
    cleanupAndReset();
    openCustomDialog(dialogEl, triggerBtnEl);
  });

  // 2. Chặn Esc khi đang xử lý, hoặc hỏi xác nhận khi ở Bước 3
  dialogEl.addEventListener("cancel", (e) => {
    if (isProcessing) {
      e.preventDefault();
      return;
    }
    const createdCount = createdData?.summary?.created || 0;
    if (currentStep === 3 && createdCount > 0 && !hasExportedOrCopied) {
      e.preventDefault();
      requestCloseModal();
    } else {
      cleanupAndReset();
    }
  });

  // 3. Nút đóng ở Header và Footer
  if (closeHeaderBtn) {
    closeHeaderBtn.addEventListener("click", requestCloseModal);
  }
  if (footerCancelBtn) {
    footerCancelBtn.addEventListener("click", requestCloseModal);
  }
  if (finishCloseBtn) {
    finishCloseBtn.addEventListener("click", requestCloseModal);
  }

  // 4. Tải file mẫu
  if (downloadTemplateBtnEl) {
    downloadTemplateBtnEl.addEventListener("click", handleDownloadTemplate);
  }

  // 5. Dropzone & File Input
  if (dropzoneEl && fileInputEl) {
    dropzoneEl.addEventListener("click", () => {
      fileInputEl.click();
    });

    dropzoneEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fileInputEl.click();
      }
    });

    fileInputEl.addEventListener("change", () => {
      if (fileInputEl.files && fileInputEl.files[0]) {
        handleFileSelection(fileInputEl.files[0]);
      }
    });

    dropzoneEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzoneEl.classList.add("dragover");
    });

    dropzoneEl.addEventListener("dragleave", () => {
      dropzoneEl.classList.remove("dragover");
    });

    dropzoneEl.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzoneEl.classList.remove("dragover");
      if (e.dataTransfer?.files && e.dataTransfer.files[0]) {
        handleFileSelection(e.dataTransfer.files[0]);
      }
    });
  }

  // 6. Bước 2: Chọn file khác
  if (reselectFileBtn) {
    reselectFileBtn.addEventListener("click", () => {
      goToStep(1);
    });
  }

  // 7. Bước 2: Lọc dòng lỗi
  if (filterErrorsOnlyEl) {
    filterErrorsOnlyEl.addEventListener("change", () => {
      filterAndRenderPreviewRows();
    });
  }

  // 8. Bước 2: Bấm nút tạo tài khoản
  if (submitCreateBtn) {
    submitCreateBtn.addEventListener("click", executeCreation);
  }

  // 9. Bước 3: Hiện/Ẩn tất cả mật khẩu
  if (toggleAllPwdBtn) {
    toggleAllPwdBtn.addEventListener("click", toggleAllPasswords);
  }

  // 10. Bước 3: Sao chép tất cả
  if (copyAllBtn) {
    copyAllBtn.addEventListener("click", copyAllCredentials);
  }

  // 11. Bước 3: Tải CSV
  if (downloadCsvBtn) {
    downloadCsvBtn.addEventListener("click", downloadResultsCsv);
  }
}
