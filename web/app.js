const els = {
  metricGrid: document.querySelector("#metricGrid"),
  metricTemplate: document.querySelector("#metricTemplate"),
  statusText: document.querySelector("#statusText"),
  statusDot: document.querySelector("#statusDot"),
  sourcePath: document.querySelector("#sourcePath"),
  trendChart: document.querySelector("#trendChart"),
  rangePill: document.querySelector("#rangePill"),
  latestDatePill: document.querySelector("#latestDatePill"),
  breakdown: document.querySelector("#breakdown"),
  modelList: document.querySelector("#modelList"),
  snapshotList: document.querySelector("#snapshotList"),
  fileCountPill: document.querySelector("#fileCountPill"),
  dailyRows: document.querySelector("#dailyRows"),
  refreshBtn: document.querySelector("#refreshBtn"),
  exportBtn: document.querySelector("#exportBtn"),
};

const monthIndex = new Map(
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(
    (month, index) => [month, index]
  )
);

function parseCcDate(value) {
  if (!value || typeof value !== "string") return new Date(0);
  const match = value.match(/^([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})$/);
  if (!match) return new Date(value);
  return new Date(Date.UTC(Number(match[3]), monthIndex.get(match[1]) || 0, Number(match[2])));
}

function sortDays(days) {
  return [...days].sort((a, b) => parseCcDate(a.date) - parseCcDate(b.date));
}

function formatCompact(value) {
  const number = Number(value) || 0;
  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: number >= 1000000 ? 2 : 1,
  }).format(number);
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
}

function formatCost(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function formatPercent(value) {
  return `${((Number(value) || 0) * 100).toFixed(1)}%`;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function setStatus(text, type = "loading") {
  els.statusText.textContent = text;
  els.statusDot.className = `status-dot ${type === "ok" ? "ok" : type === "error" ? "error" : ""}`;
}

function emptyState(message) {
  const div = document.createElement("div");
  div.className = "empty-state";
  div.textContent = message;
  return div;
}

function renderMetric(label, value, sub) {
  const node = els.metricTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector(".metric-label").textContent = label;
  node.querySelector(".metric-value").textContent = value;
  node.querySelector(".metric-sub").textContent = sub;
  els.metricGrid.appendChild(node);
}

function sumRecent(days, key, count = 30) {
  return days.slice(-count).reduce((sum, day) => sum + (Number(day[key]) || 0), 0);
}

function renderMetrics(days, totals) {
  els.metricGrid.replaceChildren();

  if (!days.length) {
    renderMetric("最新日期", "--", "暂无 JSON 快照");
    renderMetric("累计 Token", "--", "运行一次导出后显示");
    renderMetric("缓存输入占比", "--", "基于 ccusage daily");
    renderMetric("费用估算", "--", "第三方本地估算");
    return;
  }

  const latest = days.at(-1);
  const latestTotal = Number(latest.totalTokens) || 0;
  const totalTokens = Number(totals.totalTokens) || days.reduce((sum, day) => sum + (Number(day.totalTokens) || 0), 0);
  const inputTokens = Number(totals.inputTokens) || days.reduce((sum, day) => sum + (Number(day.inputTokens) || 0), 0);
  const cachedTokens =
    Number(totals.cachedInputTokens) || days.reduce((sum, day) => sum + (Number(day.cachedInputTokens) || 0), 0);
  const cacheShare = inputTokens > 0 ? cachedTokens / inputTokens : 0;
  const recentTotal = sumRecent(days, "totalTokens", 30);

  renderMetric("最新日期", formatCompact(latestTotal), `${latest.date} · ${formatCost(latest.costUSD)}`);
  renderMetric("累计 Token", formatCompact(totalTokens), `最近 30 条记录 ${formatCompact(recentTotal)}`);
  renderMetric("缓存输入占比", formatPercent(cacheShare), `${formatCompact(cachedTokens)} cached input`);
  renderMetric("费用估算", formatCost(totals.costUSD), "本地 JSONL 统计，不等同订阅额度");
}

function renderTrend(days) {
  els.trendChart.replaceChildren();

  if (!days.length) {
    els.rangePill.textContent = "--";
    els.trendChart.appendChild(emptyState("暂无趋势数据"));
    return;
  }

  const recent = days.slice(-24);
  const maxTokens = Math.max(...recent.map((day) => Number(day.totalTokens) || 0), 1);
  const maxCost = Math.max(...recent.map((day) => Number(day.costUSD) || 0), 1);
  const width = 900;
  const height = 300;
  const left = 42;
  const right = 22;
  const top = 22;
  const bottom = 48;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const step = recent.length > 1 ? chartWidth / (recent.length - 1) : chartWidth;

  const points = recent.map((day, index) => {
    const x = left + index * step;
    const y = top + chartHeight - ((Number(day.totalTokens) || 0) / maxTokens) * chartHeight;
    return { x, y, day };
  });

  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = [
    `M ${points[0].x} ${top + chartHeight}`,
    ...points.map((point, index) => `${index === 0 ? "L" : "L"} ${point.x} ${point.y}`),
    `L ${points.at(-1).x} ${top + chartHeight}`,
    "Z",
  ].join(" ");

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "trend-svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "最近 Codex token 使用趋势");

  for (let i = 0; i <= 3; i += 1) {
    const y = top + (chartHeight / 3) * i;
    const line = document.createElementNS(svg.namespaceURI, "line");
    line.setAttribute("class", "chart-grid");
    line.setAttribute("x1", left);
    line.setAttribute("x2", width - right);
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    svg.appendChild(line);

    const label = document.createElementNS(svg.namespaceURI, "text");
    label.setAttribute("class", "axis-label");
    label.setAttribute("x", 0);
    label.setAttribute("y", y + 4);
    label.textContent = formatCompact(maxTokens * (1 - i / 3));
    svg.appendChild(label);
  }

  recent.forEach((day, index) => {
    const x = left + index * step;
    const costHeight = ((Number(day.costUSD) || 0) / maxCost) * (chartHeight * 0.42);
    const bar = document.createElementNS(svg.namespaceURI, "rect");
    bar.setAttribute("class", "cost-bar");
    bar.setAttribute("x", x - 7);
    bar.setAttribute("y", top + chartHeight - costHeight);
    bar.setAttribute("width", 14);
    bar.setAttribute("height", costHeight);
    bar.setAttribute("rx", 3);
    svg.appendChild(bar);

    if (index === 0 || index === recent.length - 1 || index % 5 === 0) {
      const text = document.createElementNS(svg.namespaceURI, "text");
      text.setAttribute("class", "point-label");
      text.setAttribute("x", x);
      text.setAttribute("y", height - 14);
      text.setAttribute("text-anchor", "middle");
      text.textContent = day.date.replace(", 2026", "").replace(" ", " ");
      svg.appendChild(text);
    }
  });

  const pathArea = document.createElementNS(svg.namespaceURI, "path");
  pathArea.setAttribute("class", "chart-area");
  pathArea.setAttribute("d", area);
  svg.appendChild(pathArea);

  const line = document.createElementNS(svg.namespaceURI, "polyline");
  line.setAttribute("class", "chart-line");
  line.setAttribute("points", polyline);
  svg.appendChild(line);

  points.forEach((point) => {
    const dot = document.createElementNS(svg.namespaceURI, "circle");
    dot.setAttribute("class", "dot");
    dot.setAttribute("cx", point.x);
    dot.setAttribute("cy", point.y);
    dot.setAttribute("r", 4);
    svg.appendChild(dot);

    const title = document.createElementNS(svg.namespaceURI, "title");
    title.textContent = `${point.day.date}: ${formatNumber(point.day.totalTokens)} tokens, ${formatCost(point.day.costUSD)}`;
    dot.appendChild(title);
  });

  els.rangePill.textContent = `${recent[0].date} - ${recent.at(-1).date}`;
  els.trendChart.appendChild(svg);
}

function renderBreakdown(days) {
  els.breakdown.replaceChildren();

  if (!days.length) {
    els.latestDatePill.textContent = "--";
    els.breakdown.appendChild(emptyState("暂无 Token 构成"));
    return;
  }

  const latest = days.at(-1);
  const input = Number(latest.inputTokens) || 0;
  const cached = Number(latest.cachedInputTokens) || 0;
  const freshInput = Math.max(input - cached, 0);
  const output = Number(latest.outputTokens) || 0;
  const total = Math.max(input + output, 1);
  const reasoning = Number(latest.reasoningOutputTokens) || 0;

  els.latestDatePill.textContent = latest.date;

  const segments = [
    { label: "缓存输入", value: cached, color: "var(--sage)" },
    { label: "非缓存输入", value: freshInput, color: "var(--clay)" },
    { label: "输出", value: output, color: "var(--teal)" },
  ];

  const stack = document.createElement("div");
  stack.className = "breakdown-stack";
  segments.forEach((segment) => {
    const div = document.createElement("div");
    div.className = "stack-segment";
    div.style.width = `${Math.max((segment.value / total) * 100, segment.value > 0 ? 0.6 : 0)}%`;
    div.style.background = segment.color;
    stack.appendChild(div);
  });
  els.breakdown.appendChild(stack);

  const list = document.createElement("div");
  list.className = "breakdown-list";
  segments.forEach((segment) => {
    const row = document.createElement("div");
    row.className = "breakdown-item";
    row.innerHTML = `
      <span class="swatch" style="background:${segment.color}"></span>
      <span>${segment.label}</span>
      <span class="breakdown-value">${formatNumber(segment.value)}</span>
    `;
    list.appendChild(row);
  });
  els.breakdown.appendChild(list);

  const note = document.createElement("div");
  note.className = "reasoning-note";
  note.textContent = `推理输出 ${formatNumber(reasoning)} token；ccusage 的 totalTokens 按输入 + 输出统计，推理输出单独列出。`;
  els.breakdown.appendChild(note);
}

function collectModels(days) {
  const totals = new Map();
  days.forEach((day) => {
    Object.entries(day.models || {}).forEach(([name, model]) => {
      totals.set(name, (totals.get(name) || 0) + (Number(model.totalTokens) || 0));
    });
  });

  return [...totals.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);
}

function renderModels(days) {
  els.modelList.replaceChildren();
  const models = collectModels(days);

  if (!models.length) {
    els.modelList.appendChild(emptyState("暂无模型数据"));
    return;
  }

  const max = Math.max(...models.map((model) => model.total), 1);
  models.forEach((model) => {
    const row = document.createElement("div");
    row.className = "model-row";
    row.innerHTML = `
      <div class="model-main">
        <div class="model-name">${model.name}</div>
        <div class="model-track">
          <div class="model-fill" style="width:${(model.total / max) * 100}%"></div>
        </div>
      </div>
      <div class="model-value">${formatCompact(model.total)}</div>
    `;
    els.modelList.appendChild(row);
  });
}

function renderSnapshots(data) {
  els.snapshotList.replaceChildren();
  const files = data.files || [];
  els.fileCountPill.textContent = `${files.length} files`;

  if (!files.length) {
    els.snapshotList.appendChild(emptyState("还没有导出文件"));
    return;
  }

  files.slice(0, 6).forEach((file, index) => {
    const row = document.createElement("div");
    row.className = "snapshot-row";
    row.innerHTML = `
      <div class="snapshot-main">
        <div class="snapshot-name">${index === 0 ? "Latest · " : ""}${file.name}</div>
        <div class="snapshot-date">${new Date(file.modifiedAt).toLocaleString("zh-CN")}</div>
      </div>
      <div class="snapshot-meta">${formatBytes(file.size)}</div>
    `;
    els.snapshotList.appendChild(row);
  });
}

function renderTable(days) {
  els.dailyRows.replaceChildren();

  if (!days.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="8" class="muted">暂无每日明细</td>`;
    els.dailyRows.appendChild(row);
    return;
  }

  days
    .slice()
    .reverse()
    .forEach((day) => {
      const models = Object.keys(day.models || {}).join(", ") || "--";
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${day.date}</td>
        <td>${formatNumber(day.totalTokens)}</td>
        <td>${formatNumber(day.inputTokens)}</td>
        <td>${formatNumber(day.cachedInputTokens)}</td>
        <td>${formatNumber(day.outputTokens)}</td>
        <td>${formatNumber(day.reasoningOutputTokens)}</td>
        <td>${formatCost(day.costUSD)}</td>
        <td>${models}</td>
      `;
      els.dailyRows.appendChild(row);
    });
}

function render(data) {
  const days = sortDays(data.daily || []);
  els.sourcePath.textContent = data.latestFile ? data.latestFile.path : data.logDir;
  renderMetrics(days, data.totals || {});
  renderTrend(days);
  renderBreakdown(days);
  renderModels(days);
  renderSnapshots(data);
  renderTable(days);
}

async function loadUsage() {
  setStatus("正在读取本地 JSON...");
  try {
    const response = await fetch("/api/usage", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    render(data);
    setStatus(data.latestFile ? `已读取 ${data.latestFile.name}` : "未发现导出文件", data.latestFile ? "ok" : "loading");
  } catch (error) {
    setStatus(`读取失败：${error.message}`, "error");
  }
}

async function exportAndRefresh(source = "button") {
  els.exportBtn.disabled = true;
  els.refreshBtn.disabled = true;
  const statusPrefix = source === "refresh" ? "正在导出最新数据并刷新..." : "正在运行 ccusage 导出...";
  setStatus(statusPrefix);
  try {
    const response = await fetch("/api/export", { method: "POST" });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.stderr || data.error || `HTTP ${response.status}`);
    }
    render(data.snapshot);
    const fileName = data.snapshot?.latestFile?.name || "当天快照";
    setStatus(`已导出并刷新：${fileName}，当天重复刷新会覆盖同一个 JSON`, "ok");
  } catch (error) {
    setStatus(`导出刷新失败：${error.message}`, "error");
  } finally {
    els.exportBtn.disabled = false;
    els.refreshBtn.disabled = false;
  }
}

els.refreshBtn.addEventListener("click", () => exportAndRefresh("refresh"));
els.exportBtn.addEventListener("click", () => exportAndRefresh("export"));

loadUsage();
