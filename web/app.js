const els = {
  metricGrid: document.querySelector("#metricGrid"),
  metricTemplate: document.querySelector("#metricTemplate"),
  statusText: document.querySelector("#statusText"),
  statusDot: document.querySelector("#statusDot"),
  sourcePath: document.querySelector("#sourcePath"),
  sourceCompare: document.querySelector("#sourceCompare"),
  detailGrid: document.querySelector("#detailGrid"),
  lowerGrid: document.querySelector("#lowerGrid"),
  tablePanel: document.querySelector("#tablePanel"),
  trendChart: document.querySelector("#trendChart"),
  trendLabel: document.querySelector("#trendLabel"),
  trendTitle: document.querySelector("#trendTitle"),
  rangePill: document.querySelector("#rangePill"),
  latestDatePill: document.querySelector("#latestDatePill"),
  breakdown: document.querySelector("#breakdown"),
  breakdownLabel: document.querySelector("#breakdownLabel"),
  breakdownTitle: document.querySelector("#breakdownTitle"),
  modelsLabel: document.querySelector("#modelsLabel"),
  modelList: document.querySelector("#modelList"),
  snapshotList: document.querySelector("#snapshotList"),
  fileCountPill: document.querySelector("#fileCountPill"),
  dailyRows: document.querySelector("#dailyRows"),
  tableTitle: document.querySelector("#tableTitle"),
  refreshBtn: document.querySelector("#refreshBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  resetCredits: document.querySelector("#resetCredits"),
  resetSummary: document.querySelector("#resetSummary"),
  resetCreditList: document.querySelector("#resetCreditList"),
  viewTabs: [...document.querySelectorAll(".view-tab")],
};

const VIEW_CONFIGS = {
  overview: {
    source: "all",
    label: "总览",
    exportSource: "all",
    subtitle: "Codex + Claude Code",
    trendTitle: "总使用趋势",
    breakdownTitle: "最新总构成",
  },
  codex: {
    source: "codex",
    label: "Codex",
    exportSource: "codex",
    subtitle: "ChatGPT Codex 本地日志",
    trendTitle: "Codex 使用趋势",
    breakdownTitle: "Codex Token 构成",
  },
  claude: {
    source: "claude",
    label: "Claude Code",
    exportSource: "claude",
    subtitle: "Claude Code 本地日志",
    trendTitle: "Claude 使用趋势",
    breakdownTitle: "Claude Token 构成",
  },
  sources: {
    source: "all",
    label: "数据源",
    exportSource: "everything",
    subtitle: "本地导出和日志状态",
  },
};

let currentView = "overview";
let latestResetCredits = null;

const monthIndex = new Map(
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(
    (month, index) => [month, index]
  )
);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function dayDate(day) {
  return day?.date || day?.period || "--";
}

function dayCost(day) {
  return Number(day?.costUSD ?? day?.totalCost ?? day?.cost) || 0;
}

function totalsCost(totals, days) {
  return Number(totals?.costUSD ?? totals?.totalCost ?? totals?.cost) || days.reduce((sum, day) => sum + dayCost(day), 0);
}

function totalsTokens(totals, days) {
  return Number(totals?.totalTokens) || days.reduce((sum, day) => sum + (Number(day.totalTokens) || 0), 0);
}

function parseCcDate(value) {
  if (!value || typeof value !== "string") return new Date(0);

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));

  const text = value.match(/^([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})$/);
  if (text) return new Date(Date.UTC(Number(text[3]), monthIndex.get(text[1]) || 0, Number(text[2])));

  return new Date(value);
}

function sortDays(days) {
  return [...days].sort((a, b) => parseCcDate(dayDate(a)) - parseCcDate(dayDate(b)));
}

function formatTrendDate(value) {
  if (!value || typeof value !== "string") return "--";

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[2]}-${iso[3]}`;

  const text = value.match(/^([A-Z][a-z]{2})\s+(\d{1,2}),\s+\d{4}$/);
  if (text) return `${text[1]} ${Number(text[2])}`;

  return value.length > 8 ? value.slice(0, 8) : value;
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

function tokenParts(usage) {
  const input = Number(usage?.inputTokens) || 0;
  const legacyCached = Number(usage?.cachedInputTokens) || 0;
  const cacheRead = Number(usage?.cacheReadTokens) || 0;
  const cacheCreation = Number(usage?.cacheCreationTokens) || 0;
  const output = Number(usage?.outputTokens) || 0;
  const total = Number(usage?.totalTokens) || 0;
  const hasNamedCache =
    Object.prototype.hasOwnProperty.call(usage || {}, "cacheReadTokens") ||
    Object.prototype.hasOwnProperty.call(usage || {}, "cacheCreationTokens");

  if (hasNamedCache) {
    const promptInput = input + cacheRead + cacheCreation;

    return {
      cachedInput: cacheRead,
      cacheCreationInput: cacheCreation,
      nonCachedInput: input,
      output,
      promptInput,
      displayTotal: total || promptInput + output,
      cacheShare: promptInput > 0 ? cacheRead / promptInput : 0,
    };
  }

  const separateTotal = input + legacyCached + output;
  const combinedTotal = input + output;
  const tolerance = Math.max(2, total * 0.000001);
  const usesSeparateCached =
    legacyCached > 0 && (legacyCached > input || Math.abs(total - separateTotal) <= tolerance);

  const nonCachedInput = usesSeparateCached ? input : Math.max(input - legacyCached, 0);
  const promptInput = usesSeparateCached ? input + legacyCached : input;
  const displayTotal =
    total || (usesSeparateCached ? separateTotal : Math.max(combinedTotal, legacyCached + nonCachedInput + output));

  return {
    cachedInput: legacyCached,
    cacheCreationInput: 0,
    nonCachedInput,
    output,
    promptInput,
    displayTotal,
    cacheShare: promptInput > 0 ? legacyCached / promptInput : 0,
  };
}

function resetExpiryMs(credit) {
  const value = Number(credit?.expires_at_ms);
  return Number.isFinite(value) ? value : null;
}

function formatRemaining(credit) {
  const expiresAtMs = resetExpiryMs(credit);
  if (!expiresAtMs) return "--";

  const ms = expiresAtMs - Date.now();
  if (ms <= 0) return "已过期";

  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  return `${Math.max(1, hours)} 小时内`;
}

function renderResetCredits(data = latestResetCredits) {
  if (!els.resetSummary || !els.resetCreditList) return;

  latestResetCredits = data;
  els.resetCreditList.replaceChildren();

  if (!data?.ok) {
    els.resetCredits.classList.add("is-warning");
    els.resetSummary.textContent = data?.message || "无法读取重置额度。";
    return;
  }

  els.resetCredits.classList.remove("is-warning");
  const credits = Array.isArray(data.credits) ? data.credits : [];
  const availableCredits = credits.filter((credit) => credit.status === "available");
  const nextExpiry = availableCredits
    .map((credit) => ({ credit, expiresAtMs: resetExpiryMs(credit) }))
    .filter((item) => item.expiresAtMs && item.expiresAtMs > Date.now())
    .sort((a, b) => a.expiresAtMs - b.expiresAtMs)[0];

  if (nextExpiry) {
    els.resetSummary.textContent = `可用 ${data.available_count} 次；最近到期 ${nextExpiry.credit.expires_at}，剩余 ${formatRemaining(nextExpiry.credit)}`;
  } else {
    els.resetSummary.textContent = `可用 ${data.available_count} 次；未发现未来到期时间。`;
  }

  if (!credits.length) {
    els.resetCreditList.appendChild(emptyState("暂无 banked reset credit"));
    return;
  }

  credits.forEach((credit) => {
    const row = document.createElement("div");
    row.className = "reset-row";
    row.innerHTML = `
      <div class="reset-main">
        <div class="reset-title">${escapeHtml(credit.title || "Rate-limit reset")}</div>
        <div class="reset-meta">${escapeHtml(credit.status || "--")} · granted ${escapeHtml(credit.granted_at || "--")}</div>
      </div>
      <div class="reset-expiry">
        <strong>${escapeHtml(credit.expires_at || "--")}</strong>
        <span>${escapeHtml(formatRemaining(credit))}</span>
      </div>
    `;
    els.resetCreditList.appendChild(row);
  });
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

function sumRecent(days, read, count = 30) {
  return days.slice(-count).reduce((sum, day) => sum + read(day), 0);
}

function activeAgentCount(days) {
  const latest = days.at(-1);
  const agents = latest?.metadata?.agents;
  if (Array.isArray(agents)) return agents.length;
  return latest?.agent && latest.agent !== "all" ? 1 : 0;
}

function renderMetrics(days, totals, view, bundle = {}) {
  els.metricGrid.replaceChildren();
  const config = VIEW_CONFIGS[view] || VIEW_CONFIGS.overview;

  if (!days.length) {
    renderMetric("最新日期", "--", "暂无 JSON 快照");
    renderMetric("累计 Token", "--", `运行一次 ${config.label} 导出后显示`);
    renderMetric("缓存读取占比", "--", "基于 ccusage daily");
    renderMetric("费用估算", "--", "第三方本地估算");
    return;
  }

  const latest = days.at(-1);
  const latestTotal = Number(latest.totalTokens) || 0;
  const totalTokenCount = totalsTokens(totals, days);
  const totalCost = totalsCost(totals, days);
  const totalParts = tokenParts(totals?.totalTokens ? totals : days.reduce(
    (sum, day) => {
      const parts = tokenParts(day);
      sum.inputTokens += parts.nonCachedInput;
      sum.cacheReadTokens += parts.cachedInput;
      sum.cacheCreationTokens += parts.cacheCreationInput;
      sum.outputTokens += parts.output;
      sum.totalTokens += parts.displayTotal;
      return sum;
    },
    { inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0, totalTokens: 0 }
  ));
  const cacheShare = totalParts.promptInput > 0 ? totalParts.cachedInput / totalParts.promptInput : 0;

  if (view === "overview") {
    const recentCost = sumRecent(days, dayCost, 30);
    const recentTotal = sumRecent(days, (day) => Number(day.totalTokens) || 0, 30);
    const sourceCount = Object.values(bundle).filter((snapshot) => snapshot?.latestFile).length;

    renderMetric("今日总用量", formatCompact(latestTotal), `${dayDate(latest)} · ${formatCost(dayCost(latest))}`);
    renderMetric("累计 Token", formatCompact(totalTokenCount), `最近 30 条记录 ${formatCompact(recentTotal)}`);
    renderMetric("近 30 日费用", formatCost(recentCost), `累计估算 ${formatCost(totalCost)}`);
    renderMetric("活跃来源", `${sourceCount || activeAgentCount(days)} 个`, "Codex / Claude Code 本地日志");
    return;
  }

  const recentTotal = sumRecent(days, (day) => Number(day.totalTokens) || 0, 30);
  renderMetric("最新日期", formatCompact(latestTotal), `${dayDate(latest)} · ${formatCost(dayCost(latest))}`);
  renderMetric("累计 Token", formatCompact(totalTokenCount), `最近 30 条记录 ${formatCompact(recentTotal)}`);
  renderMetric("缓存读取占比", formatPercent(cacheShare), `${formatCompact(totalParts.cachedInput)} cache read`);
  renderMetric("费用估算", formatCost(totalCost), "本地 JSONL 统计，不等同订阅额度");
}

function renderTrend(days, label) {
  els.trendChart.replaceChildren();

  if (!days.length) {
    els.rangePill.textContent = "--";
    els.trendChart.appendChild(emptyState("暂无趋势数据"));
    return;
  }

  const recent = days.slice(-24);
  const maxTokens = Math.max(...recent.map((day) => Number(day.totalTokens) || 0), 1);
  const maxCost = Math.max(...recent.map(dayCost), 1);
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
    ...points.map((point) => `L ${point.x} ${point.y}`),
    `L ${points.at(-1).x} ${top + chartHeight}`,
    "Z",
  ].join(" ");

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "trend-svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${label} token 使用趋势`);

  for (let i = 0; i <= 3; i += 1) {
    const y = top + (chartHeight / 3) * i;
    const line = document.createElementNS(svg.namespaceURI, "line");
    line.setAttribute("class", "chart-grid");
    line.setAttribute("x1", left);
    line.setAttribute("x2", width - right);
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    svg.appendChild(line);

    const labelNode = document.createElementNS(svg.namespaceURI, "text");
    labelNode.setAttribute("class", "axis-label");
    labelNode.setAttribute("x", 0);
    labelNode.setAttribute("y", y + 4);
    labelNode.textContent = formatCompact(maxTokens * (1 - i / 3));
    svg.appendChild(labelNode);
  }

  recent.forEach((day, index) => {
    const x = left + index * step;
    const costHeight = (dayCost(day) / maxCost) * (chartHeight * 0.42);
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
      text.textContent = formatTrendDate(dayDate(day));
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
    title.textContent = `${dayDate(point.day)}: ${formatNumber(point.day.totalTokens)} tokens, ${formatCost(dayCost(point.day))}`;
    dot.appendChild(title);
  });

  els.rangePill.textContent = `${dayDate(recent[0])} - ${dayDate(recent.at(-1))}`;
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
  const parts = tokenParts(latest);
  const total = Math.max(parts.cachedInput + parts.cacheCreationInput + parts.nonCachedInput + parts.output, 1);
  const reasoning = Number(latest.reasoningOutputTokens) || 0;

  els.latestDatePill.textContent = dayDate(latest);

  const segments = [
    { label: "缓存读取", value: parts.cachedInput, color: "var(--sage)" },
    ...(parts.cacheCreationInput > 0
      ? [{ label: "缓存写入", value: parts.cacheCreationInput, color: "var(--brass)" }]
      : []),
    { label: "非缓存输入", value: parts.nonCachedInput, color: "var(--clay)" },
    { label: "输出", value: parts.output, color: "var(--teal)" },
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
      <span>${escapeHtml(segment.label)}</span>
      <span class="breakdown-value">${formatNumber(segment.value)}</span>
    `;
    list.appendChild(row);
  });
  els.breakdown.appendChild(list);

  const note = document.createElement("div");
  note.className = "reasoning-note";
  note.textContent = `推理输出 ${formatNumber(reasoning)} token；Token 构成按缓存读取、缓存写入、非缓存输入和输出拆分，推理输出单独列出。`;
  els.breakdown.appendChild(note);
}

function collectModels(days) {
  const totals = new Map();
  days.forEach((day) => {
    if (day.models && typeof day.models === "object") {
      Object.entries(day.models).forEach(([name, model]) => {
        totals.set(name, (totals.get(name) || 0) + (Number(model.totalTokens) || 0));
      });
    }

    if (Array.isArray(day.modelBreakdowns)) {
      day.modelBreakdowns.forEach((model) => {
        const name = model.modelName || model.name || "unknown";
        const parts = tokenParts(model);
        const total = Number(model.totalTokens) || parts.displayTotal;
        totals.set(name, (totals.get(name) || 0) + total);
      });
    }
  });

  return [...totals.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);
}

function modelNames(day) {
  if (day.models && typeof day.models === "object") return Object.keys(day.models);
  if (Array.isArray(day.modelsUsed)) return day.modelsUsed;
  if (Array.isArray(day.modelBreakdowns)) {
    return day.modelBreakdowns.map((model) => model.modelName || model.name).filter(Boolean);
  }
  return [];
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
        <div class="model-name">${escapeHtml(model.name)}</div>
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

  files.forEach((file, index) => {
    const row = document.createElement("div");
    row.className = "snapshot-row";
    row.innerHTML = `
      <div class="snapshot-main">
        <div class="snapshot-name">${index === 0 ? "Latest · " : ""}${escapeHtml(file.name)}</div>
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
    row.innerHTML = `<td colspan="9" class="muted">暂无每日明细</td>`;
    els.dailyRows.appendChild(row);
    return;
  }

  days
    .slice()
    .reverse()
    .forEach((day) => {
      const parts = tokenParts(day);
      const models = modelNames(day).join(", ") || "--";
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${escapeHtml(dayDate(day))}</td>
        <td>${formatNumber(day.totalTokens)}</td>
        <td>${formatNumber(parts.nonCachedInput)}</td>
        <td>${formatNumber(parts.cachedInput)}</td>
        <td>${formatNumber(parts.cacheCreationInput)}</td>
        <td>${formatNumber(day.outputTokens)}</td>
        <td>${formatNumber(day.reasoningOutputTokens)}</td>
        <td>${formatCost(dayCost(day))}</td>
        <td>${escapeHtml(models)}</td>
      `;
      els.dailyRows.appendChild(row);
    });
}

function sourceSummary(snapshot) {
  const days = sortDays(snapshot?.daily || []);
  const latest = days.at(-1);
  const total = totalsTokens(snapshot?.totals || {}, days);
  const cost = totalsCost(snapshot?.totals || {}, days);
  const recent = sumRecent(days, (day) => Number(day.totalTokens) || 0, 30);
  return { days, latest, total, cost, recent };
}

function renderOverviewSources(bundle) {
  els.sourceCompare.replaceChildren();
  const cards = [
    { key: "codex", label: "Codex", tone: "codex" },
    { key: "claude", label: "Claude Code", tone: "claude" },
  ];

  cards.forEach((card) => {
    const snapshot = bundle[card.key];
    const summary = sourceSummary(snapshot);
    const node = document.createElement("article");
    node.className = `source-card ${card.tone}`;
    node.innerHTML = `
      <div>
        <p class="section-label">${escapeHtml(card.label)}</p>
        <h3>${summary.latest ? formatCompact(summary.total) : "--"}</h3>
        <p>${summary.latest ? `${dayDate(summary.latest)} 最新 ${formatCompact(summary.latest.totalTokens)}` : "还没有本地快照"}</p>
      </div>
      <div class="source-card-meta">
        <span>${formatCost(summary.cost)}</span>
        <span>近 30 条 ${formatCompact(summary.recent)}</span>
      </div>
    `;
    els.sourceCompare.appendChild(node);
  });
}

function renderSourceStatus(payload) {
  const sources = payload.sources || [];
  els.sourceCompare.replaceChildren();
  sources.forEach((source) => {
    const node = document.createElement("article");
    node.className = "source-card status-card";
    const latest = source.latestFile;
    node.innerHTML = `
      <div>
        <p class="section-label">${escapeHtml(source.label)}</p>
        <h3>${source.detected ? "已检测" : "未检测"}</h3>
        <p>${latest ? `最新 ${escapeHtml(latest.name)}` : "尚未导出快照"}</p>
      </div>
      <div class="source-status-lines">
        <span>${escapeHtml(source.command)}</span>
        <span>${source.fileCount} files · ${source.dailyCount} daily rows</span>
        <span title="${escapeHtml(source.primaryLogDir)}">${escapeHtml(source.primaryLogDir)}</span>
      </div>
    `;
    els.sourceCompare.appendChild(node);
  });
}

function renderUsage(data, view, bundle = {}) {
  const config = VIEW_CONFIGS[view] || VIEW_CONFIGS.overview;
  const days = sortDays(data.daily || []);

  els.sourcePath.textContent = data.latestFile ? data.latestFile.path : data.logDir;
  els.trendLabel.textContent = view === "overview" ? "Combined Trend" : "Daily Trend";
  els.trendTitle.textContent = config.trendTitle || "最近使用量";
  els.breakdownLabel.textContent = view === "overview" ? "Latest Combined Day" : "Latest Day";
  els.breakdownTitle.textContent = config.breakdownTitle || "Token 构成";
  els.modelsLabel.textContent = view === "overview" ? "All Models" : "Models";
  els.tableTitle.textContent = `${config.label} 每日明细`;

  renderMetrics(days, data.totals || {}, view, bundle);
  renderTrend(days, config.label);
  renderBreakdown(days);
  renderModels(days);
  renderSnapshots(data);
  renderTable(days);

  if (view === "overview") {
    renderOverviewSources(bundle);
  }
}

function setViewVisibility(view) {
  const isSources = view === "sources";
  const showReset = view === "overview" || view === "codex";
  els.sourceCompare.classList.toggle("is-hidden", !(view === "overview" || isSources));
  els.detailGrid.classList.toggle("is-hidden", isSources);
  els.lowerGrid.classList.toggle("is-hidden", isSources);
  els.tablePanel.classList.toggle("is-hidden", isSources);
  els.resetCredits.classList.toggle("is-hidden", !showReset);
}

function setActiveTab(view) {
  els.viewTabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === view);
  });
}

async function fetchUsage(source) {
  const response = await fetch(`/api/usage?source=${encodeURIComponent(source)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function loadSourcesView() {
  setStatus("正在读取数据源状态...");
  const response = await fetch("/api/sources", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const sources = data.sources || [];
  const ready = sources.filter((source) => source.latestFile).length;
  els.sourcePath.textContent = "usage-logs/{codex,claude,all}/daily";
  els.metricGrid.replaceChildren();
  renderMetric("数据源", `${sources.length} 个`, "Codex / Claude Code / All");
  renderMetric("已有快照", `${ready} 个`, "至少导出一次后显示");
  renderMetric("计划任务", "12:00", "默认每天中午导出");
  renderMetric("存储位置", "项目内", "同一天刷新覆盖同名 JSON");
  renderSourceStatus(data);
  setStatus(`已读取 ${sources.length} 个数据源状态`, "ok");
}

async function loadView(view = currentView) {
  currentView = VIEW_CONFIGS[view] ? view : "overview";
  const config = VIEW_CONFIGS[currentView];
  setActiveTab(currentView);
  setViewVisibility(currentView);

  try {
    if (currentView === "sources") {
      await loadSourcesView();
      return;
    }

    setStatus(`正在读取 ${config.label} JSON...`);

    if (currentView === "overview") {
      const [all, codex, claude] = await Promise.all([
        fetchUsage("all"),
        fetchUsage("codex"),
        fetchUsage("claude"),
      ]);
      renderUsage(all, "overview", { codex, claude });
      setStatus(all.latestFile ? `已读取总览 ${all.latestFile.name}` : "未发现总览导出文件", all.latestFile ? "ok" : "loading");
      return;
    }

    const data = await fetchUsage(config.source);
    renderUsage(data, currentView);
    setStatus(data.latestFile ? `已读取 ${data.latestFile.name}` : `未发现 ${config.label} 导出文件`, data.latestFile ? "ok" : "loading");
  } catch (error) {
    setStatus(`读取失败：${error.message}`, "error");
  }
}

async function loadResetCredits() {
  if (!els.resetSummary) return;
  els.resetSummary.textContent = "正在读取可用重置额度...";

  try {
    const response = await fetch("/api/reset-credits", { cache: "no-store" });
    const data = await response.json();
    renderResetCredits(data);
  } catch (error) {
    renderResetCredits({
      ok: false,
      message: `读取重置额度失败：${error.message}`,
    });
  }
}

async function exportAndRefresh(scope = "current") {
  els.exportBtn.disabled = true;
  els.refreshBtn.disabled = true;
  const exportSource = scope === "everything" ? "everything" : VIEW_CONFIGS[currentView].exportSource;
  setStatus(exportSource === "everything" ? "正在导出全部数据源..." : `正在导出 ${VIEW_CONFIGS[currentView].label} 数据...`);

  try {
    const response = await fetch(`/api/export?source=${encodeURIComponent(exportSource)}`, { method: "POST" });
    const data = await response.json();
    if (!response.ok || (!data.ok && !data.partial)) {
      throw new Error(data.stderr || data.error || `HTTP ${response.status}`);
    }

    await loadView(currentView);
    if (data.partial) {
      const failed = (data.results || []).filter((item) => !item.ok).map((item) => item.source).join(", ");
      setStatus(`部分导出完成，失败来源：${failed}`, "error");
    } else {
      setStatus(exportSource === "everything" ? "已导出并刷新全部数据源" : "已导出并刷新当前视图", "ok");
    }
  } catch (error) {
    setStatus(`导出刷新失败：${error.message}`, "error");
  } finally {
    await loadResetCredits();
    els.exportBtn.disabled = false;
    els.refreshBtn.disabled = false;
  }
}

els.viewTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const view = tab.dataset.view || "overview";
    history.replaceState(null, "", `#${view}`);
    loadView(view);
  });
});

els.refreshBtn.addEventListener("click", () => exportAndRefresh("everything"));
els.exportBtn.addEventListener("click", () => exportAndRefresh("everything"));

const initialView = location.hash.replace("#", "") || "overview";
loadView(initialView);
loadResetCredits();
