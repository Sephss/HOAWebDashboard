/* ============================================================
   charts.js — Small, dependency-free SVG chart renderers.
   No charting library is used per the project requirements;
   everything below is hand-built SVG + vanilla JS.
   ============================================================ */

const PALETTE = ["#013717", "#BF942E", "#2D6CDF", "#159B4C", "#D64545", "#7B4FC9", "#C9640B", "#5C5F61"];

function el(tag, attrs = {}) {
  const ns = "http://www.w3.org/2000/svg";
  const e = document.createElementNS(ns, tag);
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  return e;
}

/** Attach a floating tooltip element to a wrapper (creates once, reuses). */
function ensureTooltip(wrap) {
  let tip = wrap.querySelector(".chart-tooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "chart-tooltip";
    wrap.appendChild(tip);
  }
  return tip;
}

function showTooltip(wrap, tip, x, y, text) {
  tip.textContent = text;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
  tip.classList.add("show");
}
function hideTooltip(tip) {
  tip.classList.remove("show");
}

/* ---------------------------------------------------------
   LINE / AREA CHART
   --------------------------------------------------------- */
export function renderLineChart(container, { labels, series, height = 220 }) {
  container.innerHTML = "";
  container.classList.add("chart-canvas-wrap");
  const w = container.clientWidth || 480;
  const padL = 34, padR = 12, padT = 16, padB = 26;
  const innerW = w - padL - padR;
  const innerH = height - padT - padB;

  const allVals = series.flatMap((s) => s.data);
  const maxVal = Math.max(1, ...allVals);
  const svg = el("svg", { width: w, height, viewBox: `0 0 ${w} ${height}` });

  // gridlines
  const gridSteps = 4;
  for (let i = 0; i <= gridSteps; i++) {
    const y = padT + (innerH / gridSteps) * i;
    svg.appendChild(el("line", { x1: padL, x2: w - padR, y1: y, y2: y, stroke: "var(--color-border)", "stroke-width": 1 }));
    const val = Math.round(maxVal - (maxVal / gridSteps) * i);
    const label = el("text", { x: 4, y: y + 4, "font-size": 10, fill: "var(--color-grey-light)" });
    label.textContent = val;
    svg.appendChild(label);
  }

  const stepX = labels.length > 1 ? innerW / (labels.length - 1) : innerW;

  series.forEach((s, si) => {
    const color = s.color || PALETTE[si % PALETTE.length];
    const points = s.data.map((v, i) => [padL + stepX * i, padT + innerH - (v / maxVal) * innerH]);

    // area fill
    if (s.area !== false) {
      const areaPath = `M${points[0][0]},${padT + innerH} ` + points.map((p) => `L${p[0]},${p[1]}`).join(" ") + ` L${points[points.length - 1][0]},${padT + innerH} Z`;
      const areaEl = el("path", { d: areaPath, fill: color, opacity: 0.08 });
      svg.appendChild(areaEl);
    }

    // line
    const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
    svg.appendChild(el("path", { d: linePath, fill: "none", stroke: color, "stroke-width": 2.5, "stroke-linecap": "round", "stroke-linejoin": "round" }));

    // dots
    const wrap = container;
    const tip = ensureTooltip(wrap);
    points.forEach((p, i) => {
      const dot = el("circle", { cx: p[0], cy: p[1], r: 3.5, fill: "var(--color-surface)", stroke: color, "stroke-width": 2, style: "cursor:pointer" });
      dot.addEventListener("mouseenter", () => showTooltip(wrap, tip, p[0], p[1], `${labels[i]}: ${s.data[i]}`));
      dot.addEventListener("mouseleave", () => hideTooltip(tip));
      svg.appendChild(dot);
    });
  });

  // x labels (sparse if many)
  const skip = labels.length > 10 ? Math.ceil(labels.length / 8) : 1;
  labels.forEach((lab, i) => {
    if (i % skip !== 0 && i !== labels.length - 1) return;
    const x = padL + stepX * i;
    const t = el("text", { x, y: height - 6, "font-size": 10, fill: "var(--color-grey-light)", "text-anchor": "middle" });
    t.textContent = lab;
    svg.appendChild(t);
  });

  container.appendChild(svg);
}

/* ---------------------------------------------------------
   BAR CHART
   --------------------------------------------------------- */
export function renderBarChart(container, { labels, data, color = "var(--color-primary)", height = 220 }) {
  container.innerHTML = "";
  container.classList.add("chart-canvas-wrap");
  const w = container.clientWidth || 480;
  const padL = 34, padR = 12, padT = 16, padB = 28;
  const innerW = w - padL - padR;
  const innerH = height - padT - padB;
  const maxVal = Math.max(1, ...data);

  const svg = el("svg", { width: w, height, viewBox: `0 0 ${w} ${height}` });
  const gridSteps = 4;
  for (let i = 0; i <= gridSteps; i++) {
    const y = padT + (innerH / gridSteps) * i;
    svg.appendChild(el("line", { x1: padL, x2: w - padR, y1: y, y2: y, stroke: "var(--color-border)", "stroke-width": 1 }));
    const val = Math.round(maxVal - (maxVal / gridSteps) * i);
    const t = el("text", { x: 4, y: y + 4, "font-size": 10, fill: "var(--color-grey-light)" });
    t.textContent = val;
    svg.appendChild(t);
  }

  const gap = 0.35;
  const bandW = innerW / data.length;
  const barW = bandW * (1 - gap);
  const wrap = container;
  const tip = ensureTooltip(wrap);

  data.forEach((v, i) => {
    const barH = (v / maxVal) * innerH;
    const x = padL + bandW * i + (bandW - barW) / 2;
    const y = padT + innerH - barH;
    const rect = el("rect", { x, y, width: barW, height: Math.max(barH, 1), rx: 4, fill: color, style: "cursor:pointer;transition:opacity .15s;" });
    rect.addEventListener("mouseenter", (e) => { rect.style.opacity = 0.75; showTooltip(wrap, tip, x + barW / 2, y, `${labels[i]}: ${v}`); });
    rect.addEventListener("mouseleave", () => { rect.style.opacity = 1; hideTooltip(tip); });
    svg.appendChild(rect);
  });

  const skip = labels.length > 10 ? Math.ceil(labels.length / 8) : 1;
  labels.forEach((lab, i) => {
    if (i % skip !== 0 && i !== labels.length - 1) return;
    const x = padL + bandW * i + bandW / 2;
    const t = el("text", { x, y: height - 6, "font-size": 10, fill: "var(--color-grey-light)", "text-anchor": "middle" });
    t.textContent = lab;
    svg.appendChild(t);
  });

  container.appendChild(svg);
}

/* ---------------------------------------------------------
   DONUT CHART
   --------------------------------------------------------- */
export function renderDonutChart(container, { data, size = 180, thickness = 26 }) {
  container.innerHTML = "";
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = size / 2 - thickness / 2;
  const cx = size / 2, cy = size / 2;
  const svg = el("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}` });

  svg.appendChild(el("circle", { cx, cy, r, fill: "none", stroke: "var(--color-border)", "stroke-width": thickness }));

  let cumulative = 0;
  const wrap = document.createElement("div");
  wrap.className = "donut-wrap";
  const chartWrap = document.createElement("div");
  chartWrap.className = "chart-canvas-wrap";
  chartWrap.style.width = `${size}px`;
  const tip = ensureTooltip(chartWrap);

  data.forEach((d, i) => {
    const color = d.color || PALETTE[i % PALETTE.length];
    const frac = d.value / total;
    const circumference = 2 * Math.PI * r;
    const dash = frac * circumference;
    const circle = el("circle", {
      cx, cy, r, fill: "none", stroke: color, "stroke-width": thickness,
      "stroke-dasharray": `${dash} ${circumference - dash}`,
      "stroke-dashoffset": -cumulative * circumference,
      transform: `rotate(-90 ${cx} ${cy})`,
      style: "cursor:pointer;transition:opacity .15s;",
    });
    circle.addEventListener("mouseenter", () => { circle.style.opacity = 0.75; showTooltip(chartWrap, tip, size / 2, size / 2 - r, `${d.label}: ${d.value} (${Math.round(frac * 100)}%)`); });
    circle.addEventListener("mouseleave", () => { circle.style.opacity = 1; hideTooltip(tip); });
    svg.appendChild(circle);
    cumulative += frac;
  });

  const centerText = el("text", { x: cx, y: cy - 3, "text-anchor": "middle", "font-size": 20, "font-weight": 800, fill: "var(--color-black)" });
  centerText.textContent = total;
  svg.appendChild(centerText);
  const centerLabel = el("text", { x: cx, y: cy + 15, "text-anchor": "middle", "font-size": 9, fill: "var(--color-grey)" });
  centerLabel.textContent = "TOTAL";
  svg.appendChild(centerLabel);

  chartWrap.appendChild(svg);
  wrap.appendChild(chartWrap);

  const legend = document.createElement("div");
  legend.className = "donut-legend";
  legend.innerHTML = data
    .map((d, i) => `
      <div class="donut-legend__item">
        <span class="donut-legend__dot" style="background:${d.color || PALETTE[i % PALETTE.length]}"></span>
        <span class="donut-legend__label">${d.label}</span>
        <span class="donut-legend__value">${d.value}</span>
      </div>
    `)
    .join("");
  wrap.appendChild(legend);

  container.appendChild(wrap);
}

/* ---------------------------------------------------------
   MINI HORIZONTAL BAR LIST (top N rankings)
   --------------------------------------------------------- */
export function renderMiniBarList(container, { data, color = "var(--color-primary)" }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  container.innerHTML = `
    <div class="mini-bar-list">
      ${data
        .map(
          (d) => `
        <div class="mini-bar-row">
          <div class="mini-bar-row__label" title="${d.label}">${d.label}</div>
          <div class="mini-bar-track"><div class="mini-bar-fill" style="width:${(d.value / max) * 100}%;background:${d.color || color}"></div></div>
          <div class="mini-bar-row__value">${d.value}</div>
        </div>`
        )
        .join("")}
    </div>
  `;
}

export { PALETTE };
