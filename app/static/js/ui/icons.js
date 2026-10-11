/**
 * Tạo thẻ SVG an toàn không dùng innerHTML
 * @param {string} iconName - Tên icon
 * @param {number} width - Chiều rộng
 * @param {number} height - Chiều cao
 * @returns {SVGSVGElement}
 */
export function createSvg(iconName, width = 16, height = 16) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  const appendShapes = (...shapes) => {
    for (const [tag, attrs] of shapes) {
      const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [k, v] of Object.entries(attrs)) {
        node.setAttribute(k, v);
      }
      svg.append(node);
    }
  };

  switch (iconName) {
    case "check":
      appendShapes(["polyline", { points: "20 6 9 17 4 12" }]);
      break;

    case "alert":
      appendShapes(
        ["circle", { cx: "12", cy: "12", r: "10" }],
        ["line", { x1: "12", y1: "8", x2: "12", y2: "12" }],
        ["line", { x1: "12", y1: "16", x2: "12.01", y2: "16" }]
      );
      break;

    case "info":
      appendShapes(
        ["circle", { cx: "12", cy: "12", r: "10" }],
        ["line", { x1: "12", y1: "16", x2: "12", y2: "12" }],
        ["line", { x1: "12", y1: "8", x2: "12.01", y2: "8" }]
      );
      break;

    case "trash":
      appendShapes(
        ["polyline", { points: "3 6 5 6 21 6" }],
        ["path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }],
        ["line", { x1: "10", y1: "11", x2: "10", y2: "17" }],
        ["line", { x1: "14", y1: "11", x2: "14", y2: "17" }]
      );
      break;

    case "plus":
      appendShapes(
        ["line", { x1: "12", y1: "5", x2: "12", y2: "19" }],
        ["line", { x1: "5", y1: "12", x2: "19", y2: "12" }]
      );
      break;

    case "dashboard":
      appendShapes(
        ["rect", { x: "3", y: "3", width: "7", height: "9", rx: "1" }],
        ["rect", { x: "14", y: "3", width: "7", height: "5", rx: "1" }],
        ["rect", { x: "14", y: "12", width: "7", height: "9", rx: "1" }],
        ["rect", { x: "3", y: "16", width: "7", height: "5", rx: "1" }]
      );
      break;

    case "users":
      appendShapes(
        ["path", { d: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" }],
        ["circle", { cx: "9", cy: "7", r: "4" }],
        ["path", { d: "M23 21v-2a4 4 0 0 0-3-3.87" }],
        ["path", { d: "M16 3.13a4 4 0 0 1 0 7.75" }]
      );
      break;

    case "documents":
      appendShapes(
        ["path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }],
        ["polyline", { points: "14 2 14 8 20 8" }],
        ["line", { x1: "16", y1: "13", x2: "8", y2: "13" }],
        ["line", { x1: "16", y1: "17", x2: "8", y2: "17" }],
        ["polyline", { points: "10 9 9 9 8 9" }]
      );
      break;

    case "unanswered":
      appendShapes(
        ["circle", { cx: "12", cy: "12", r: "10" }],
        ["path", { d: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" }],
        ["line", { x1: "12", y1: "17", x2: "12.01", y2: "17" }]
      );
      break;

    case "chat":
      appendShapes(
        ["path", { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" }]
      );
      break;

    case "logout":
      appendShapes(
        ["path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }],
        ["polyline", { points: "16 17 21 12 16 7" }],
        ["line", { x1: "21", y1: "12", x2: "9", y2: "12" }]
      );
      break;

    case "hamburger":
      svg.setAttribute("stroke-width", "2");
      appendShapes(
        ["line", { x1: "3", y1: "12", x2: "21", y2: "12" }],
        ["line", { x1: "3", y1: "6", x2: "21", y2: "6" }],
        ["line", { x1: "3", y1: "18", x2: "21", y2: "18" }]
      );
      break;

    case "send":
      svg.setAttribute("stroke-width", "2");
      appendShapes(
        ["line", { x1: "22", y1: "2", x2: "11", y2: "13" }],
        ["polygon", { points: "22 2 15 22 11 13 2 9 22 2" }]
      );
      break;

    case "arrow-left":
      svg.setAttribute("stroke-width", "2");
      appendShapes(
        ["line", { x1: "19", y1: "12", x2: "5", y2: "12" }],
        ["polyline", { points: "12 19 5 12 12 5" }]
      );
      break;

    case "close":
      svg.setAttribute("stroke-width", "2");
      appendShapes(
        ["line", { x1: "18", y1: "6", x2: "6", y2: "18" }],
        ["line", { x1: "6", y1: "6", x2: "18", y2: "18" }]
      );
      break;

    case "user":
      appendShapes(
        ["path", { d: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" }],
        ["circle", { cx: "12", cy: "7", r: "4" }]
      );
      break;

    default:
      appendShapes(["circle", { cx: "12", cy: "12", r: "10" }]);
  }

  return svg;
}
