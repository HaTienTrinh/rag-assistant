/**
 * Định dạng thời gian từ chuỗi ISO UTC sang định dạng hiển thị tiếng Việt
 * Máy chủ trả về UTC không kèm múi giờ nên thêm hậu tố Z
 * @param {string|null} s - Chuỗi thời gian ISO
 * @returns {string}
 */
export function fmtTime(s) {
  if (!s) return "—";
  const iso = /(Z|[+-]\d\d:?\d\d)$/.test(s) ? s : s + "Z";
  return new Date(iso).toLocaleString("vi-VN");
}

/**
 * Định dạng số với dấu phân cách hàng nghìn theo tiếng Việt
 * @param {number|null} n - Số cần định dạng
 * @returns {string}
 */
export function fmtNum(n) {
  return (n ?? 0).toLocaleString("vi-VN");
}
