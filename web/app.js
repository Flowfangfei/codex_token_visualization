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
  updateBanner: document.querySelector("#updateBanner"),
  updateText: document.querySelector("#updateText"),
  updateLink: document.querySelector("#updateLink"),
  updateClose: document.querySelector("#updateClose"),
  resetCredits: document.querySelector("#resetCredits"),
  resetSummary: document.querySelector("#resetSummary"),
  resetCreditList: document.querySelector("#resetCreditList"),
  resetPlannerView: document.querySelector("#resetPlannerView"),
  resetPlannerProviders: document.querySelector("#resetPlannerProviders"),
  resetPlanLink: document.querySelector("#resetPlanLink"),
  forecastView: document.querySelector("#forecastView"),
  forecastAgentTabs: document.querySelector("#forecastAgentTabs"),
  quotaWindowTabs: document.querySelector("#quotaWindowTabs"),
  providerViewTabs: document.querySelector("#providerViewTabs"),
  forecastMetricGrid: document.querySelector("#forecastMetricGrid"),
  forecastRunwayTitle: document.querySelector("#forecastRunwayTitle"),
  forecastPeriodPill: document.querySelector("#forecastPeriodPill"),
  forecastRunway: document.querySelector("#forecastRunway"),
  forecastAdvice: document.querySelector("#forecastAdvice"),
  forecastSourcePill: document.querySelector("#forecastSourcePill"),
  forecastRateList: document.querySelector("#forecastRateList"),
  viewTabs: document.querySelector(".view-tabs"),
  displaySettingsBtn: document.querySelector("#displaySettingsBtn"),
  displaySettingsDialog: document.querySelector("#displaySettingsDialog"),
  displaySettingsClose: document.querySelector("#displaySettingsClose"),
  displaySettingsCount: document.querySelector("#displaySettingsCount"),
  providerSettingsList: document.querySelector("#providerSettingsList"),
  displaySettingsAll: document.querySelector("#displaySettingsAll"),
  displaySettingsCancel: document.querySelector("#displaySettingsCancel"),
  displaySettingsSave: document.querySelector("#displaySettingsSave"),
  forecastViewTab: document.querySelector('.view-tab[data-view="forecast"]'),
};

const VIEW_CONFIGS = {
  overview: {
    source: "all",
    label: "总览",
    exportSource: "all",
    subtitle: "全部已注册智能体",
    trendTitle: "总使用趋势",
    breakdownTitle: "最新总构成",
  },
  forecast: {
    source: "all",
    label: "额度预测",
    exportSource: "everything",
    subtitle: "本地用量速率与周期预算",
  },
  sources: {
    source: "all",
    label: "数据源",
    exportSource: "everything",
    subtitle: "本地导出和日志状态",
  },
  resets: {
    source: "all",
    label: "重置规划",
    exportSource: "everything",
  },
};

let currentView = "overview";
let latestResetCredits = null;
let providerCatalog = [];
let providerMeta = {};
let visibleProviderIds = new Set();
let forecastAgent = null;
let forecastSnapshots = {};
let forecastQuotas = {};
let resetPlannerGeneration = 0;
let resetPlannerWorker;
let resetPlannerRequest = 0;
const pendingResetPlans = new Map();
const forecastWindowSelections = {};
let visibleUpdateId = null;

function viewTabElements() {
  return [...document.querySelectorAll(".view-tab")];
}

function forecastTabElements() {
  return [...document.querySelectorAll(".forecast-agent-tab")];
}

function visibleProviders() {
  return providerCatalog.filter((provider) => visibleProviderIds.has(provider.id));
}

function configureProviders(providers, requestedVisibleProviders) {
  providerCatalog = Array.isArray(providers) ? providers.filter((entry) => entry?.id && entry?.label) : [];
  providerMeta = Object.fromEntries(providerCatalog.map((entry) => [entry.id, entry]));
  const navigableIds = providerCatalog.filter((entry) => entry.navigation !== false).map((entry) => entry.id);
  const requested = Array.isArray(requestedVisibleProviders) ? requestedVisibleProviders : navigableIds;
  const nextVisible = requested.filter((id) => navigableIds.includes(id));
  visibleProviderIds = new Set(nextVisible.length ? nextVisible : navigableIds.slice(0, 1));

  els.providerViewTabs.replaceChildren();
  els.forecastAgentTabs.replaceChildren();
  for (const provider of providerCatalog) {
    FORECAST_AGENT_META[provider.id] = provider;
    VIEW_CONFIGS[provider.id] = {
      source: provider.id,
      label: provider.label,
      exportSource: "everything",
      subtitle: provider.subtitle,
      trendTitle: provider.trendTitle,
      breakdownTitle: provider.breakdownTitle,
      resetCredits: provider.resetCredits,
    };
    if (provider.navigation !== false && visibleProviderIds.has(provider.id)) {
      const tab = document.createElement("button");
      tab.className = "view-tab";
      tab.type = "button";
      tab.dataset.view = provider.id;
      tab.textContent = provider.label;
      tab.style.setProperty("--provider-color", provider.color || "var(--rust)");
      els.providerViewTabs.appendChild(tab);
    }
    if (provider.forecast !== false && visibleProviderIds.has(provider.id)) {
      const tab = document.createElement("button");
      tab.className = "forecast-agent-tab";
      tab.type = "button";
      tab.dataset.forecastAgent = provider.id;
      tab.setAttribute("role", "tab");
      tab.textContent = provider.shortLabel || provider.label;
      tab.style.setProperty("--provider-color", provider.color || "var(--teal)");
      els.forecastAgentTabs.appendChild(tab);
    }
  }
  const forecastProviders = visibleProviders().filter((entry) => entry.forecast !== false);
  forecastAgent = forecastProviders.some((entry) => entry.id === forecastAgent)
    ? forecastAgent
    : forecastProviders[0]?.id || null;
  els.forecastViewTab.classList.toggle("is-hidden", forecastProviders.length === 0);
}

async function loadProviderCatalog() {
  const [providerResponse, settingsResponse] = await Promise.all([
    fetch("/api/providers", { cache: "no-store" }),
    fetch("/api/display-settings", { cache: "no-store" }),
  ]);
  if (!providerResponse.ok) throw new Error(`Provider registry HTTP ${providerResponse.status}`);
  if (!settingsResponse.ok) throw new Error(`Display settings HTTP ${settingsResponse.status}`);
  const [providerPayload, settingsPayload] = await Promise.all([providerResponse.json(), settingsResponse.json()]);
  configureProviders(providerPayload.providers, settingsPayload.settings?.visibleProviders);
}

function selectedProviderIds() {
  return [...els.providerSettingsList.querySelectorAll('input[type="checkbox"]:checked')]
    .map((input) => input.value);
}

function updateDisplaySettingsCount() {
  const count = selectedProviderIds().length;
  const available = providerCatalog.filter((entry) => entry.navigation !== false).length;
  els.displaySettingsCount.textContent = `${count} / ${available} 已显示`;
  els.displaySettingsSave.disabled = count === 0;
}

function renderDisplaySettings() {
  els.providerSettingsList.replaceChildren();
  for (const provider of providerCatalog.filter((entry) => entry.navigation !== false)) {
    const label = document.createElement("label");
    label.className = "provider-setting-row";
    label.innerHTML = `
      <input type="checkbox" value="${escapeHtml(provider.id)}" ${visibleProviderIds.has(provider.id) ? "checked" : ""} />
      <span class="provider-setting-swatch" style="background:${escapeHtml(provider.color || "#9b4732")}"></span>
      <span class="provider-setting-copy">
        <strong>${escapeHtml(provider.label)}</strong>
        <span>${provider.forecast === false ? "本地用量" : "用量与额度预测"}</span>
      </span>
    `;
    els.providerSettingsList.appendChild(label);
  }
  updateDisplaySettingsCount();
}

function openDisplaySettings() {
  renderDisplaySettings();
  els.displaySettingsDialog.showModal();
}

function closeDisplaySettings() {
  els.displaySettingsDialog.close();
}

async function saveDisplaySettings() {
  const selected = selectedProviderIds();
  if (!selected.length) return;
  els.displaySettingsSave.disabled = true;
  try {
    const response = await fetch("/api/display-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visibleProviders: selected }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    configureProviders(providerCatalog, payload.settings?.visibleProviders);
    closeDisplaySettings();
    if (
      (providerMeta[currentView] && !visibleProviderIds.has(currentView))
      || (currentView === "forecast" && !forecastAgent)
    ) {
      currentView = "overview";
      history.replaceState(null, "", "#overview");
    }
    await loadView(currentView);
  } catch (error) {
    setStatus(`保存显示设置失败：${error.message}`, "error");
    els.displaySettingsSave.disabled = false;
  }
}

function dismissedUpdateId() {
  try {
    return localStorage.getItem("ai-token-ledger-dismissed-update");
  } catch (_) {
    return null;
  }
}

function hideUpdateBanner({ remember = false } = {}) {
  els.updateBanner.classList.add("is-hidden");
  if (remember && visibleUpdateId) {
    try {
      localStorage.setItem("ai-token-ledger-dismissed-update", visibleUpdateId);
    } catch (_) {
      // Private browsing can disable persistent storage; closing still works for this page.
    }
  }
}

async function loadUpdateStatus() {
  hideUpdateBanner();
  try {
    const response = await fetch("/api/update-status", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    const safeUrl = typeof payload.compareUrl === "string" && payload.compareUrl.startsWith("https://github.com/");
    const updateId = typeof payload.updateId === "string" && /^[a-f0-9]{12}$/i.test(payload.updateId)
      ? payload.updateId
      : null;
    if (!payload.updateAvailable || !safeUrl || !updateId || dismissedUpdateId() === updateId) return;
    visibleUpdateId = updateId;
    const count = Math.max(1, Number(payload.aheadBy) || 1);
    els.updateText.textContent = `GitHub 的 ${payload.branch || "main"} 分支比本地多 ${count} 个提交。`;
    els.updateLink.href = payload.compareUrl;
    els.updateBanner.classList.remove("is-hidden");
  } catch (_) {
    hideUpdateBanner();
  }
}

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

const FORECAST_AGENT_META = {};

function localDateKey(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayKey(day) {
  const parsed = parseCcDate(dayDate(day));
  if (Number.isNaN(parsed.getTime())) return null;
  const pad = (value) => String(value).padStart(2, "0");
  return `${parsed.getUTCFullYear()}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())}`;
}

function addDays(dateKey, offset) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey || "")) return null;
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(offset || 0));
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function dayDistance(from, to) {
  if (!from || !to) return null;
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / 86400000);
}

function formatDateKey(value) {
  if (!value) return "--";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function formatRunway(days) {
  if (!Number.isFinite(days)) return "--";
  if (days <= 0) return "已耗尽";
  const wholeDays = Math.floor(days);
  const hours = Math.max(1, Math.round((days - wholeDays) * 24));
  if (wholeDays >= 14) return `${(days / 7).toFixed(1)} 周`;
  if (wholeDays > 0) return `${wholeDays} 天 ${hours} 小时`;
  return `${hours} 小时`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function defaultForecastPlan(agent = forecastAgent) {
  return {
    subscriptionPlan: providerMeta[agent]?.label || agent || "",
    accountSyncEnabled: true,
    budgetTokens: null,
    periodEndsOn: null,
    cycleDays: 7,
    fallbackUsedTokens: null,
    fallbackDailyTokens: null,
  };
}

function forecastPlan(agent = forecastAgent) {
  return defaultForecastPlan(agent);
}

function inputNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function usageForDateRange(days, start, end) {
  return days.reduce((sum, day) => {
    const key = dayKey(day);
    if (!key || (start && key < start) || (end && key > end)) return sum;
    return sum + (Number(day.totalTokens) || 0);
  }, 0);
}

function localUsageDays(snapshot) {
  return sortDays(snapshot?.daily || []).filter((day) => {
    const key = dayKey(day);
    return key && key <= localDateKey();
  });
}

function buildForecastRate(days, fallbackDailyTokens, context = {}, modelFit = null) {
  const observations = (context.observations || []).map((point) => ({ ...point,
    demandTokens: modelFit?.active ? globalThis.ForecastModel.equivalentTokensForDay({
      totalTokens: point.totalTokens,
      modelBreakdowns: Object.entries(point.models || {}).map(([modelName, totalTokens]) => ({ modelName, totalTokens })),
    }, modelFit) : point.totalTokens,
  }));
  return globalThis.ForecastDemand.estimate({ ...context, days, observations, fallbackDailyTokens });
}

function quotaSnapshotDay(snapshot) {
  const nameMatch = snapshot?.file?.name?.match(/(\d{4}-\d{2}-\d{2})/);
  if (nameMatch) return nameMatch[1];
  const date = new Date(snapshot?.fetchedAt || snapshot?.file?.modifiedAt || 0);
  return Number.isNaN(date.getTime()) ? null : localDateKey(date);
}

function longestQuotaWindow(snapshot) {
  return selectableQuotaWindows(snapshot)
    .filter((window) => Number.isFinite(Number(window?.usedPercent)))
    .slice()
    .sort((a, b) => (Number(b.windowDurationMins) || 0) - (Number(a.windowDurationMins) || 0))[0] || null;
}

function selectableQuotaWindows(snapshot) {
  return (Array.isArray(snapshot?.windows) ? snapshot.windows : [])
    .filter((window) => window?.selectable !== false && Number.isFinite(Number(window?.usedPercent)));
}

function selectedQuotaWindow(snapshot, requestedName) {
  const windows = selectableQuotaWindows(snapshot);
  return windows.find((window) => window.name === requestedName) || longestQuotaWindow(snapshot);
}

function accountQuotaSummary(snapshot, windowName = null) {
  const window = selectedQuotaWindow(snapshot, windowName);
  if (window) {
    const used = clamp(Number(window.usedPercent), 0, 100);
    return {
      type: "percent",
      label: window.label || window.name || "账户窗口",
      used,
      remaining: Math.max(0, 100 - used),
      resetAt: window.resetsAt || null,
      windowDurationMins: Number(window.windowDurationMins) || null,
      windowKind: window.windowKind || null,
    };
  }

  const quota = snapshot?.quota;
  if (quota && Number.isFinite(Number(quota.used)) && Number.isFinite(Number(quota.limit))) {
    const limit = Math.max(Number(quota.limit), 0);
    const used = Math.max(Number(quota.used), 0);
    return {
      type: "plan-units",
      label: quota.unit || "计划用量",
      used,
      remaining: Number.isFinite(Number(quota.remaining)) ? Math.max(Number(quota.remaining), 0) : Math.max(limit - used, 0),
      limit,
      resetAt: snapshot?.billingCycleEnd || null,
      periodStart: snapshot?.billingCycleStart || null,
    };
  }
  return null;
}

function leastSquares(points) {
  if (points.length < 3) return null;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const denominator = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  if (denominator <= 0) return null;
  const slope = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0) / denominator;
  const intercept = meanY - slope * meanX;
  const totalVariance = points.reduce((sum, point) => sum + (point.y - meanY) ** 2, 0);
  const residualVariance = points.reduce((sum, point) => sum + (point.y - (intercept + slope * point.x)) ** 2, 0);
  return {
    slope,
    intercept,
    rSquared: totalVariance > 0 ? 1 - residualVariance / totalVariance : 1,
    sampleCount: points.length,
  };
}

function mapQuotaObservation(observation) {
  return {
    day: String(observation.fetchedAt || "").slice(0, 10),
    fetchedAt: observation.fetchedAt,
    usedPercent: Number(observation.usedPercent),
    totalTokens: Number.isFinite(Number(observation.totalTokens)) ? Number(observation.totalTokens) : null,
    window: {
      name: observation.windowName,
      label: observation.windowLabel,
      usedPercent: Number(observation.usedPercent),
      resetsAt: observation.resetAt,
      windowDurationMins: observation.windowDurationMins,
    },
    usageTotalTokens: Number.isFinite(Number(observation.totalTokens)) ? Number(observation.totalTokens) : null,
    modelTotals: observation.models || {},
    segment: observation.segment,
    observation: true,
  };
}

function quotaObservationsShareSegment(previous, current) {
  if (!previous || !current || previous.windowName !== current.windowName) return false;
  const previousSegment = previous.segment === null || previous.segment === undefined ? null : String(previous.segment);
  const currentSegment = current.segment === null || current.segment === undefined ? null : String(current.segment);
  if (previousSegment !== null && currentSegment !== null && previousSegment !== currentSegment) return false;
  const previousReset = previous.resetAt ? new Date(previous.resetAt).getTime() : null;
  const currentReset = current.resetAt ? new Date(current.resetAt).getTime() : null;
  const resetMatches = previousReset === null && currentReset === null
    ? true
    : previousReset !== null && currentReset !== null && Math.abs(previousReset - currentReset) <= 5 * 60 * 1000;
  const quotaMonotonic = Number(current.usedPercent) + 0.5 >= Number(previous.usedPercent);
  const usageMonotonic =
    current.totalTokens === null ||
    previous.totalTokens === null ||
    Number(current.totalTokens) >= Number(previous.totalTokens);
  return resetMatches && quotaMonotonic && usageMonotonic;
}

function quotaObservationSegments(quotaData, activeWindowName = null) {
  const resolvedWindowName = activeWindowName || longestQuotaWindow(quotaData?.latest)?.name || null;
  const observations = [...(Array.isArray(quotaData?.observations) ? quotaData.observations : [])]
    .filter((observation) =>
      Number.isFinite(Number(observation.usedPercent)) &&
      (!resolvedWindowName || observation.windowName === resolvedWindowName))
    .sort((a, b) => String(a.fetchedAt || "").localeCompare(String(b.fetchedAt || "")));
  const segments = [];
  observations.forEach((observation) => {
    const currentSegment = segments.at(-1);
    const previous = currentSegment?.at(-1);
    if (!currentSegment || !quotaObservationsShareSegment(previous, observation)) {
      segments.push([observation]);
    } else {
      currentSegment.push(observation);
    }
  });
  return segments.map((segment) => segment.map(mapQuotaObservation));
}

function quotaHistoryIntervals(quotaData, windowName = null) {
  const segments = quotaObservationSegments(quotaData, windowName);
  return globalThis.ForecastModel?.buildSegmentIntervals(segments) || [];
}

function quotaWindowPoints(quotaData, activeWindowName = null) {
  const observationSegments = quotaObservationSegments(quotaData, activeWindowName);
  if (observationSegments.length) return observationSegments.at(-1);
  if (!quotaData?.daily?.length) return [];
  const latest = quotaData.latest;
  const latestWindow = selectedQuotaWindow(latest, activeWindowName);
  if (!latestWindow?.resetsAt) return [];
  const windowName = activeWindowName || latestWindow.name;
  const resetAt = latestWindow.resetsAt;
  return quotaData.daily
    .map((snapshot) => ({ snapshot, day: quotaSnapshotDay(snapshot) }))
    .filter((item) => item.day && item.day <= localDateKey())
    .map((item) => ({ ...item, window: (item.snapshot.windows || []).find((window) => window.name === windowName) }))
    .filter((item) => item.window?.resetsAt === resetAt && Number.isFinite(Number(item.window.usedPercent)))
    .sort((a, b) => a.day.localeCompare(b.day));
}

function fitQuotaBurn(days, quotaData, account, dailyTokenRate, modelFit = null, windowName = null) {
  if (
    !account ||
    account.type !== "percent" ||
    (!quotaData?.daily?.length && !quotaData?.observations?.length) ||
    !dailyTokenRate
  ) return null;
  const observationSegments = quotaObservationSegments(quotaData, windowName);
  if (observationSegments.length) {
    const rawIntervals = quotaHistoryIntervals(quotaData, windowName);
    const intervals = modelFit?.active
      ? globalThis.ForecastModel.applyModelWeightsToIntervals(rawIntervals, modelFit)
      : rawIntervals;
    const segmented = globalThis.ForecastModel?.fitSegmentedQuota(intervals) || {
      intervalCount: 0,
      requiredIntervals: 2,
      segmentCount: 0,
      model: null,
    };
    const currentSegmentPoints = observationSegments.at(-1)?.length || 0;
    const base = {
      sampleCount: currentSegmentPoints,
      requiredSamples: 3,
      currentSegmentPoints,
      historyObservationCount: observationSegments.reduce((sum, segment) => sum + segment.length, 0),
      intervalCount: segmented.intervalCount,
      requiredIntervals: segmented.requiredIntervals,
      totalSegmentCount: observationSegments.length,
      contributingSegmentCount: segmented.segmentCount,
      historicalMode: true,
      observationMode: true,
      model: segmented.model,
    };
    if (!segmented.model) return base;
    const percentPerDay = segmented.model.slope * dailyTokenRate;
    return {
      ...base,
      percentPerDay,
      runwayDays: percentPerDay > 0 ? account.remaining / percentPerDay : null,
    };
  }
  const points = quotaWindowPoints(quotaData, windowName);
  if (points.length < 3) return { sampleCount: points.length, requiredSamples: 3, model: null };

  const firstDay = points[0].day;
  const observationMode = points.every((point) => Number.isFinite(point.usageTotalTokens));
  const usageBaseline = observationMode ? points[0].usageTotalTokens : null;
  const regression = leastSquares(
    points.map((point) => ({
      x: observationMode
        ? Math.max(0, point.usageTotalTokens - usageBaseline)
        : usageForDateRange(days, firstDay, point.day),
      y: Number(point.window.usedPercent),
    }))
  );
  if (!regression || regression.slope <= 0) {
    return { sampleCount: points.length, requiredSamples: 3, model: null };
  }
  const percentPerDay = regression.slope * dailyTokenRate;
  const runwayDays = percentPerDay > 0 ? account.remaining / percentPerDay : null;
  return {
    sampleCount: points.length,
    requiredSamples: 3,
    model: regression,
    observationMode,
    percentPerDay,
    runwayDays,
  };
}

function buildForecast(agent, requestedWindowName = forecastWindowSelections[agent]) {
  const plan = forecastPlan(agent);
  const snapshot = forecastSnapshots[agent] || {};
  const days = localUsageDays(snapshot);
  const today = localDateKey();
  const periodEnd = /^\d{4}-\d{2}-\d{2}$/.test(plan.periodEndsOn || "") ? plan.periodEndsOn : null;
  const cycleDays = clamp(Math.round(inputNumberOrNull(plan.cycleDays) || 7), 1, 90);
  const periodStart = periodEnd ? addDays(periodEnd, -(cycleDays - 1)) : null;
  const usablePeriodEnd = periodEnd && periodEnd < today ? periodEnd : today;
  const periodDays = periodStart && usablePeriodEnd && periodStart <= usablePeriodEnd
    ? days.filter((day) => {
        const key = dayKey(day);
        return key && key >= periodStart && key <= usablePeriodEnd;
      })
    : [];
  const hasLocalUsage = periodDays.length > 0;
  const localUsed = usageForDateRange(periodDays, periodStart, usablePeriodEnd);
  const fallbackUsed = inputNumberOrNull(plan.fallbackUsedTokens);
  const usedTokens = hasLocalUsage ? localUsed : fallbackUsed;
  const quotaData = forecastQuotas[agent] || null;
  const quotaWindows = selectableQuotaWindows(quotaData?.latest);
  const selectedWindow = selectedQuotaWindow(quotaData?.latest, requestedWindowName);
  const selectedWindowName = selectedWindow?.name || null;
  const account = accountQuotaSummary(quotaData?.latest, selectedWindowName);
  const usageFetchedAt = snapshot.latestFile?.modifiedAt;
  const totalTokens = days.reduce((sum, day) => sum + (Number(day.totalTokens) || 0), 0);
  // A model-specific exhausted pool cannot establish that all provider work stopped.
  const demandContext = { observations: selectedWindow?.modelPatterns?.length ? [] : quotaData?.observations || [],
    windowName: selectedWindowName, usageFetchedAt, currentUsage: { fetchedAt: usageFetchedAt, totalTokens } };
  const rawRate = buildForecastRate(days, plan.fallbackDailyTokens, demandContext);
  const rawQuotaFit = fitQuotaBurn(days, quotaData, account, rawRate.weightedRate, null, selectedWindowName);
  const hasQuotaObservations = quotaObservationSegments(quotaData, selectedWindowName).length > 0;
  const historyIntervals = quotaHistoryIntervals(quotaData, selectedWindowName);
  let recentDays = days.filter((day) => dayKey(day) >= addDays(today, -6) && dayKey(day) <= today);
  if (rawRate.demand.referenceDays && !recentDays.some((day) => day.totalTokens > 0)) {
    const lastUsageDay = days.filter((day) => day.totalTokens > 0).at(-1);
    recentDays = lastUsageDay ? days.filter((day) => dayKey(day) >= addDays(dayKey(lastUsageDay), -6)) : recentDays;
  }
  const priorityModels = globalThis.ForecastModel?.recentModelNames(recentDays) || [];
  const modelFit = hasQuotaObservations
    ? globalThis.ForecastModel?.fitModelWeightsFromIntervals(historyIntervals, rawQuotaFit?.model?.slope,
        { priorityModels, maxFeatures: Math.min(4, Math.max(3, priorityModels.length + 1)) })
    : globalThis.ForecastModel?.fitModelWeights(
        days,
        quotaWindowPoints(quotaData, selectedWindowName).map((point) => ({
          day: point.day,
          fetchedAt: point.fetchedAt,
          usedPercent: Number(point.window.usedPercent),
          totalTokens: point.usageTotalTokens,
          modelTotals: point.modelTotals,
        })),
        rawQuotaFit?.model?.slope
      );
  const calibration = globalThis.ForecastModel?.assessModelCalibration(historyIntervals, recentDays, modelFit)
    || { ready: false, reason: "model-calibrating" };
  const resolvedModelFit = modelFit ? { ...modelFit,
    active: modelFit.active && calibration.ready,
    reason: calibration.ready ? modelFit.reason : calibration.reason,
  } : {
    active: false,
    sampleCount: historyIntervals.length || rawQuotaFit?.sampleCount || 0,
    requiredSamples: 7,
    reason: "model-module-unavailable",
    weights: [],
  };
  const effectiveDays = resolvedModelFit.active ? globalThis.ForecastModel.applyModelWeights(days, resolvedModelFit) : days;
  const rate = resolvedModelFit.active ? buildForecastRate(effectiveDays, plan.fallbackDailyTokens, demandContext, resolvedModelFit) : rawRate;
  const fittedQuota = resolvedModelFit.active
    ? fitQuotaBurn(effectiveDays, quotaData, account, rate.weightedRate, resolvedModelFit, selectedWindowName)
    : rawQuotaFit;
  const quotaFit = calibration.ready && rate.demand.ready ? fittedQuota : { ...fittedQuota, model: null, percentPerDay: null, runwayDays: null };
  const budgetTokens = inputNumberOrNull(plan.budgetTokens);
  const remainingTokens = budgetTokens === null || usedTokens === null ? null : Math.max(budgetTokens - usedTokens, 0);
  const daysUntilEnd = periodEnd ? Math.max(0, (dayDistance(today, periodEnd) ?? -1) + 1) : null;
  const targetDailyTokens = remainingTokens !== null && daysUntilEnd && daysUntilEnd > 0 ? remainingTokens / daysUntilEnd : null;
  const manualExhaustionDays = remainingTokens !== null && rate.weightedRate > 0 ? remainingTokens / rate.weightedRate : null;
  const exhaustionDays = quotaFit?.model && Number.isFinite(quotaFit.runwayDays) ? quotaFit.runwayDays
    : account?.type === "percent" && (!calibration.ready || !rate.demand.ready) ? null : manualExhaustionDays;
  const predictedEnd = exhaustionDays === null ? null : addDays(today, Math.ceil(exhaustionDays));
  const projectedTokens = budgetTokens !== null && usedTokens !== null && daysUntilEnd !== null
    ? usedTokens + (rate.weightedRate || 0) * daysUntilEnd
    : null;

  return {
    agent,
    meta: FORECAST_AGENT_META[agent] || { label: agent },
    snapshot,
    plan,
    days,
    effectiveDays,
    rawRate,
    rate,
    modelFit: resolvedModelFit,
    calibration,
    historyIntervals,
    quotaData,
    quotaWindows,
    selectedWindowName,
    account,
    quotaFit,
    today,
    periodStart,
    periodEnd,
    cycleDays,
    hasLocalUsage,
    usedTokens,
    budgetTokens,
    remainingTokens,
    daysUntilEnd,
    targetDailyTokens,
    exhaustionDays,
    predictedEnd,
    projectedTokens,
  };
}

function renderForecastMetric(label, value, sub) {
  const node = els.metricTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector(".metric-label").textContent = label;
  node.querySelector(".metric-value").textContent = value;
  node.querySelector(".metric-sub").textContent = sub;
  els.forecastMetricGrid.appendChild(node);
}

function renderQuotaWindowTabs(forecast) {
  els.quotaWindowTabs.replaceChildren();
  const windows = Array.isArray(forecast.quotaWindows) ? forecast.quotaWindows : [];
  els.quotaWindowTabs.classList.toggle("is-hidden", windows.length <= 1);
  if (windows.length <= 1) return;

  for (const window of windows) {
    const usedPercent = clamp(Number(window.usedPercent), 0, 100);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quota-window-tab";
    button.dataset.quotaWindow = window.name;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(window.name === forecast.selectedWindowName));
    button.classList.toggle("is-active", window.name === forecast.selectedWindowName);
    button.style.setProperty("--provider-color", forecast.meta.color || "var(--teal)");
    button.title = `${window.label || window.name}，重置 ${formatAccountTime(window.resetsAt)}`;
    button.innerHTML = `<span>${escapeHtml(window.label || window.name)}</span><strong>${escapeHtml(`${usedPercent.toFixed(0)}%`)}</strong>`;
    button.addEventListener("click", () => {
      forecastWindowSelections[forecast.agent] = window.name;
      renderForecast(forecast.agent);
    });
    els.quotaWindowTabs.appendChild(button);
  }
}

function formatAccountTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatAccountWindow(windowDurationMins) {
  const minutes = Number(windowDurationMins);
  if (!Number.isFinite(minutes) || minutes <= 0) return "额度窗口";
  if (minutes >= 1440) return `${Math.round(minutes / 1440)} 天账期`;
  if (minutes >= 60) return `${Math.round(minutes / 60)} 小时窗口`;
  return `${Math.round(minutes)} 分钟窗口`;
}

function appendRunwayStat(container, label, value) {
  const stat = document.createElement("div");
  stat.className = "runway-stat";
  stat.innerHTML = `<p class="runway-stat-label">${escapeHtml(label)}</p><div class="runway-stat-value">${escapeHtml(value)}</div>`;
  container.appendChild(stat);
}

function modelWeightSummary(modelFit) {
  if (!modelFit?.active) return "";
  return modelFit.weights
    .filter((item) => item.name !== "other-models" || Math.abs(item.weight - 1) > 0.01)
    .map((item) => `${item.name === "other-models" ? "其他模型" : item.name} x${item.weight.toFixed(2)}`)
    .join(" · ");
}

function modelFitStatus(modelFit) {
  if (modelFit?.active) return `模型权重已启用：${modelWeightSummary(modelFit) || "各模型接近基准权重"}`;
  if (modelFit?.reason === "model-calibrating") return "近期模型尚待额度校准，不沿用其他模型权重；历史记录保留";
  if (modelFit?.reason === "model-mix-changed") return "模型组合已变化，原始 Token 比率暂不适用；等待模型权重校准";
  if (modelFit?.reason === "model-fit-unstable") return "近期模型实际扣减与拟合偏差过大，暂缓数值预测；历史记录保留";
  const sampleCount = modelFit?.sampleCount || 0;
  const requiredSamples = modelFit?.requiredSamples || 7;
  const sampleUnit = modelFit?.intervalMode ? "跨周期有效区间" : "同周期观测点";
  if (sampleCount < requiredSamples) return `模型等效 Token 等待 ${sampleCount} / ${requiredSamples} 个${sampleUnit}`;
  if (modelFit?.reason === "stable-model-mix") return "模型占比变化不足，暂时无法可靠区分模型权重";
  if (modelFit?.reason === "single-model-mix") return "当前周期只有一个主要模型，不需要模型换算";
  return "模型权重尚未通过稳定性检查，继续使用原始 Token";
}

function renderAccountRunway(forecast) {
  const account = forecast.account;
  const fit = forecast.quotaFit;
  els.forecastRunwayTitle.textContent = `${forecast.meta.label} · ${account.label}`;
  els.forecastPeriodPill.textContent = account.type === "percent"
    ? `${account.windowKind === "monthly" ? "月度额度" : formatAccountWindow(account.windowDurationMins)} · 重置 ${formatAccountTime(account.resetAt)}`
    : `账期至 ${formatAccountTime(account.resetAt)}`;

  const summary = document.createElement("div");
  summary.className = "runway-summary";
  if (account.type === "percent") {
    appendRunwayStat(summary, "已用额度", `${account.used.toFixed(0)}%`);
    appendRunwayStat(summary, "可用额度", `${account.remaining.toFixed(0)}%`);
    appendRunwayStat(summary, "拟合燃烧率", fit?.model ? `${fit.percentPerDay.toFixed(1)}% / 日` : "采样中");
  } else {
    appendRunwayStat(summary, "已用计划单位", formatNumber(account.used));
    appendRunwayStat(summary, "剩余计划单位", formatNumber(account.remaining));
    appendRunwayStat(summary, "计划上限", formatNumber(account.limit));
  }
  els.forecastRunway.appendChild(summary);

  const total = account.type === "percent" ? 100 : Math.max(account.limit, 1);
  const usedRatio = clamp(account.used / total, 0, 1);
  const track = document.createElement("div");
  track.className = "runway-track";
  const usedSegment = document.createElement("div");
  usedSegment.className = "runway-used";
  usedSegment.style.width = `${usedRatio * 100}%`;
  const remainingSegment = document.createElement("div");
  remainingSegment.className = "runway-remaining";
  remainingSegment.style.width = `${Math.max(0, 100 - usedRatio * 100)}%`;
  track.append(usedSegment, remainingSegment);

  const trackWrap = document.createElement("div");
  trackWrap.className = "runway-track-wrap";
  if (account.type === "percent" && fit?.model && account.resetAt) {
    const remainingDays = Math.max(0, (new Date(account.resetAt).getTime() - Date.now()) / 86400000);
    const projected = clamp(account.used + fit.percentPerDay * remainingDays, 0, 100);
    const marker = document.createElement("div");
    marker.className = "runway-marker is-end";
    marker.style.left = `${projected}%`;
    marker.innerHTML = `<span class="runway-marker-label">重置时预测 ${escapeHtml(`${projected.toFixed(0)}%`)}</span>`;
    trackWrap.appendChild(marker);
  }
  trackWrap.appendChild(track);
  els.forecastRunway.appendChild(trackWrap);

  const dates = document.createElement("div");
  dates.className = "runway-dates";
  const quotaDetails = Array.isArray(forecast.quotaData?.latest?.quotaBreakdown)
    ? forecast.quotaData.latest.quotaBreakdown
        .filter((entry) => entry?.label !== account.label && Number.isFinite(Number(entry?.usedPercent)))
        .map((entry) => `${entry.label} ${Number(entry.usedPercent).toFixed(0)}%`)
        .join(" · ")
    : "";
  dates.innerHTML = `<span>${escapeHtml(`${account.label}${quotaDetails ? ` · ${quotaDetails}` : ""}`)}</span><span>重置 ${escapeHtml(formatAccountTime(account.resetAt))}</span>`;
  els.forecastRunway.appendChild(dates);

  if (account.type === "percent" && fit?.model) {
    const tokenBasis = forecast.modelFit?.active ? "模型等效 Token" : "原始 Token";
    const historyText = fit.historicalMode
      ? `跨 ${fit.contributingSegmentCount} 个重置周期的 ${fit.intervalCount} 个有效区间（当前周期 ${fit.currentSegmentPoints} 个观测点）`
      : `同一额度窗口内 ${fit.sampleCount} 个观测点`;
    const runwayText = forecast.exhaustionDays === 0 ? "当前额度已耗尽"
      : `预计 ${formatRunway(forecast.exhaustionDays)} 后耗尽`;
    els.forecastAdvice.innerHTML = `<strong>跨周期拟合已启用。</strong><span>基于${historyText}，将${tokenBasis} 增量拟合为官方额度百分比；旧周期按 28 天半衰期降低权重。额度重置只开启新分段，不会清空历史样本。${escapeHtml(modelFitStatus(forecast.modelFit))}；${escapeHtml(runwayText)}。</span>`;
  } else if (account.type === "percent" && !forecast.rate.demand.ready) {
    els.forecastAdvice.innerHTML = "<strong>受限期间需求尚不明确。</strong><span>可观测时段不足，暂缓耗尽时间与重置收益预测。官方余额仍正常展示；有工作待完成且额度已用尽时，可考虑最早到期的 reset。</span>";
  } else if (account.type === "percent" && !forecast.calibration?.ready) {
    const pending = (forecast.calibration?.unsupportedModels || []).join("、");
    els.forecastAdvice.innerHTML = `<strong>模型额度校准中。</strong><span>${escapeHtml(modelFitStatus(forecast.modelFit))}。${pending ? `待校准：${escapeHtml(pending)}。` : ""}主要模型至少需要 3 个有效扣减区间，并通过模型权重或稳定组合检查；反复刷新但没有新增消耗不会增加有效样本。官方余额和重置时间仍正常展示。</span>`;
  } else if (account.type === "percent") {
    const intervalCount = fit?.intervalCount || 0;
    const requiredIntervals = fit?.requiredIntervals || 2;
    const currentPoints = fit?.currentSegmentPoints || fit?.sampleCount || 0;
    els.forecastAdvice.innerHTML = `<strong>官方额度已同步。</strong><span>已收集 ${intervalCount} / ${requiredIntervals} 个跨周期有效区间，当前周期 ${currentPoints} 个观测点；达到 ${requiredIntervals} 个有效区间后启用原始 Token 拟合。额度重置只开启新分段，历史样本会继续参与并随时间衰减。${escapeHtml(modelFitStatus(forecast.modelFit))}。</span>`;
  } else {
    els.forecastAdvice.innerHTML = `<strong>账户账期已同步。</strong><span>账户计划单位与 token 不是已确认的一对一口径；保留原始已用、剩余和账期，待每日事件数据积累后再启用拟合。</span>`;
  }
  if (forecast.rate.demand.adjusted) {
    const note = document.createElement("span");
    note.textContent = demandStatus(forecast.rate.demand)
      + "。按可观测时段的平均节奏估计续工需求；恢复空档的时间与对应用量同时排除，账本不变。这不是全天开工或仍有待办的证明。";
    els.forecastAdvice.appendChild(note);
  }
}

function renderForecastRunway(forecast) {
  els.forecastRunway.replaceChildren();
  els.forecastAdvice.replaceChildren();
  if (forecast.account) {
    renderAccountRunway(forecast);
    return;
  }
  els.forecastRunwayTitle.textContent = `${forecast.meta.label} 账户额度`;
  els.forecastPeriodPill.textContent = "等待自动同步";
  els.forecastRunway.appendChild(emptyState("刷新后将自动读取账户额度与重置时间"));
  const advice = document.createElement("div");
  advice.innerHTML = "<strong>尚未取得账户额度快照。</strong><span>点击页面右上角刷新会同步全部已注册来源；本地 Token 速率仍会继续记录。</span>";
  els.forecastAdvice.appendChild(advice);
}

function demandStatus(demand) {
  if (!demand?.adjusted) return "未识别到可排除的受限时段";
  return `近 7 日排除 ${demand.removedHours.toFixed(1)} 小时，其中恢复空档 ${demand.recoveryHours.toFixed(1)} 小时、最近状态暂推 ${demand.provisionalHours.toFixed(1)} 小时；${demand.unknownDays} 日证据不足未参与估速`
    + (demand.referenceDays ? `；沿用最近 28 日内 ${demand.referenceDays} 个未受限完整日` : "");
}

function renderForecastRates(forecast) {
  els.forecastRateList.replaceChildren();
  const rate = forecast.rate;
  const adjusted = Boolean(forecast.modelFit?.active);
  const tokenUnit = adjusted ? "等效 Token" : "Token";
  const rows = [
    {
      label: "今天截至当前",
      value: rate.todayRate,
      caption: `${formatCompact(rate.todayUsage)} ${tokenUnit} 已记录 · ${rate.demand.availableHours[0].toFixed(1)} 可观测小时`,
    },
    {
      label: "近 3 日日均",
      value: rate.threeDayRate,
      caption: `已记录 ${formatCompact(rate.threeDayUsage)} ${tokenUnit} · ${rate.demand.availableHours[1].toFixed(1)} 可观测小时`,
    },
    {
      label: "近 7 日日均",
      value: rate.sevenDayRate,
      caption: `已记录 ${formatCompact(rate.sevenDayUsage)} ${tokenUnit} · ${rate.demand.availableHours[2].toFixed(1)} 可观测小时`,
    },
    {
      label: rate.demand.adjusted ? "受限修正后的需求日均" : adjusted ? "模型等效日均" : "综合预测日均",
      value: rate.weightedRate,
      caption: rate.isFallback
        ? "使用手动日均兜底"
        : adjusted
          ? `原始 ${formatCompact(forecast.rawRate.weightedRate || 0)} / 日 · ${modelWeightSummary(forecast.modelFit)}`
          : "今日、3 日和 7 日节奏加权",
      weighted: true,
    },
  ];
  if (rate.demand.adjusted) rows.push({ label: "实际记录日均（未修正）", value: rate.observedWeightedRate,
    caption: `${tokenUnit} · ${demandStatus(rate.demand)}` });

  rows.forEach((item) => {
    const row = document.createElement("div");
    row.className = `forecast-rate-row${item.weighted ? " is-weighted" : ""}`;
    row.innerHTML = `
      <p class="forecast-rate-caption">${escapeHtml(item.label)}</p>
      <div class="forecast-rate-value">${item.value ? `${escapeHtml(formatCompact(item.value))} / 日` : "--"}</div>
      <p class="forecast-rate-caption">${escapeHtml(item.caption)}</p>
    `;
    els.forecastRateList.appendChild(row);
  });
}

function renderForecast(agent = forecastAgent) {
  const forecast = buildForecast(agent);
  renderQuotaWindowTabs(forecast);
  els.forecastMetricGrid.replaceChildren();
  if (forecast.account) {
    const account = forecast.account;
    const fit = forecast.quotaFit;
    const available = account.type === "percent"
      ? `${account.remaining.toFixed(0)}%`
      : `${formatNumber(account.remaining)} / ${formatNumber(account.limit)}`;
    const used = account.type === "percent" ? `${account.used.toFixed(0)}%` : formatNumber(account.used);
    renderForecastMetric("官方可用额度", available, `${account.label} · 重置 ${formatAccountTime(account.resetAt)}`);
    renderForecastMetric("官方已用额度", used, forecast.quotaData?.latest?.provider || "账户快照");
    renderForecastMetric(
      forecast.modelFit?.active ? "模型等效日均" : "综合日均",
      forecast.rate.weightedRate ? `${formatCompact(forecast.rate.weightedRate)} / 日` : "--",
      forecast.rate.demand.adjusted ? "受限时长修正 · 非全天工作假设" : forecast.modelFit?.active ? "账户额度反向学习模型权重" : forecast.rate.isFallback ? "手动日均" : "今日、3 日、7 日加权"
    );
    renderForecastMetric(
      fit?.model ? "拟合耗尽" : "历史有效区间",
      fit?.model
        ? formatRunway(forecast.exhaustionDays)
        : `${fit?.intervalCount || 0} / ${fit?.requiredIntervals || 2}`,
      fit?.model
        ? `R² ${fit.model.rSquared.toFixed(2)} · ${fit.intervalCount || fit.sampleCount} 个区间 / ${fit.contributingSegmentCount || 1} 个周期 · ${forecast.modelFit?.active ? "模型等效 Token" : "原始 Token"}`
        : `${fit?.totalSegmentCount || 0} 个周期 · 当前 ${fit?.currentSegmentPoints || fit?.sampleCount || 0} 个观测点`
    );
    els.forecastSourcePill.textContent = forecast.quotaData?.latest
      ? `账户快照 · ${forecast.quotaData.latest.file?.name || "最新"}${fit?.historicalMode ? ` · 跨周期${fit.model ? "拟合" : "采样"}` : ""}${forecast.modelFit?.active ? " · 模型校正" : ""}`
      : "未发现账户快照";
    renderForecastRunway(forecast);
    renderForecastRates(forecast);
    return;
  }

  renderForecastMetric("账户额度", "--", "等待自动同步");
  renderForecastMetric("重置时间", "--", "由账户接口自动读取");
  renderForecastMetric("综合日均", forecast.rate.weightedRate ? `${formatCompact(forecast.rate.weightedRate)} / 日` : "--", "今日、3 日、7 日加权");
  renderForecastMetric("预计耗尽", "--", "取得账户额度后自动计算");
  els.forecastSourcePill.textContent = forecast.snapshot?.latestFile
    ? `本地快照 · ${forecast.snapshot.latestFile.name}`
    : "未发现本地快照";
  renderForecastRunway(forecast);
  renderForecastRates(forecast);
}

function setForecastAgent(agent) {
  const candidates = visibleProviders().filter((entry) => entry.forecast !== false);
  const fallback = candidates[0]?.id;
  forecastAgent = candidates.some((entry) => entry.id === agent) ? agent : fallback;
  forecastTabElements().forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.forecastAgent === forecastAgent);
    tab.setAttribute("aria-selected", String(tab.dataset.forecastAgent === forecastAgent));
  });
  if (!forecastAgent) return;
  const snapshot = forecastSnapshots[forecastAgent];
  els.sourcePath.textContent = snapshot?.latestFile ? snapshot.latestFile.path : snapshot?.logDir || `usage-logs/${forecastAgent}/daily`;
  renderForecast(forecastAgent);
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

function compactResetExpiry(value) {
  return String(value || "--")
    .replace(/:\d{2}\s+GMT[+-]\d{2}:\d{2}$/i, "")
    .trim();
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

  els.resetCredits.classList.toggle("is-warning", Boolean(data.partial));
  const credits = Array.isArray(data.credits) ? data.credits : [];
  const availableCredits = credits.filter((credit) => credit.status === "available");
  const nextExpiry = availableCredits
    .map((credit) => ({ credit, expiresAtMs: resetExpiryMs(credit) }))
    .filter((item) => item.expiresAtMs && item.expiresAtMs > Date.now())
    .sort((a, b) => a.expiresAtMs - b.expiresAtMs)[0];

  if (data.summary) {
    els.resetSummary.textContent = data.summary;
  } else if (nextExpiry) {
    els.resetSummary.textContent = `可用 ${data.available_count} 次；${compactResetExpiry(nextExpiry.credit.expires_at)} 到期，剩余 ${formatRemaining(nextExpiry.credit)}`;
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
    const meta = [credit.status || "--", credit.granted_at ? `granted ${credit.granted_at}` : null]
      .filter(Boolean)
      .join(" · ");
    row.innerHTML = `
      <div class="reset-main">
        <div class="reset-title">${escapeHtml(credit.title || "Rate-limit reset")}</div>
        <div class="reset-meta">${escapeHtml(meta)}</div>
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
    renderMetric("活跃来源", `${sourceCount || activeAgentCount(days)} 个`, visibleProviders().map((entry) => entry.shortLabel || entry.label).join(" / "));
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

function dayModels(day) {
  if (day?.models && typeof day.models === "object" && !Array.isArray(day.models)) {
    return Object.entries(day.models).map(([name, usage]) => ({ modelName: name, ...usage }));
  }
  return Array.isArray(day?.modelBreakdowns) ? day.modelBreakdowns : [];
}

function mergeUsageSnapshots(bundle) {
  const byDay = new Map();
  const files = [];
  for (const provider of visibleProviders()) {
    const snapshot = bundle[provider.id] || {};
    for (const file of snapshot.files || []) files.push({ ...file, name: `${provider.shortLabel || provider.label} · ${file.name}` });
    for (const sourceDay of snapshot.daily || []) {
      const date = dayKey(sourceDay) || dayDate(sourceDay);
      if (!date || date === "--") continue;
      const day = byDay.get(date) || {
        date,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        modelBreakdowns: [],
      };
      for (const field of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens", "reasoningOutputTokens", "totalTokens"]) {
        day[field] += Number(sourceDay[field]) || 0;
      }
      day.totalCost += dayCost(sourceDay);
      for (const model of dayModels(sourceDay)) {
        day.modelBreakdowns.push({
          ...model,
          modelName: `${provider.shortLabel || provider.label} · ${model.modelName || model.name || "unknown"}`,
        });
      }
      byDay.set(date, day);
    }
  }
  const daily = [...byDay.values()].sort((a, b) => parseCcDate(a.date) - parseCcDate(b.date));
  const totals = daily.reduce((sum, day) => {
    for (const field of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens", "reasoningOutputTokens", "totalTokens", "totalCost"]) {
      sum[field] += Number(day[field]) || 0;
    }
    return sum;
  }, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningOutputTokens: 0, totalTokens: 0, totalCost: 0 });
  const latestFiles = visibleProviders().map((provider) => bundle[provider.id]?.latestFile).filter(Boolean);
  return {
    source: "overview",
    label: "全部智能体",
    logDir: "usage-logs/{provider}/daily",
    latestFile: latestFiles.length ? { name: `${latestFiles.length} 个来源`, path: "后端 Provider 注册表动态聚合" } : null,
    files: files.sort((a, b) => new Date(b.modifiedAt || 0) - new Date(a.modifiedAt || 0)),
    daily,
    totals,
  };
}

function renderOverviewSources(bundle) {
  els.sourceCompare.replaceChildren();
  visibleProviders().forEach((provider) => {
    const snapshot = bundle[provider.id];
    const summary = sourceSummary(snapshot);
    const node = document.createElement("article");
    node.className = `source-card ${provider.tone || ""}`;
    node.style.setProperty("--provider-color", provider.color || "var(--rust)");
    node.innerHTML = `
      <div>
        <p class="section-label">${escapeHtml(provider.label)}</p>
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
        <span>${source.fileCount} 个滚动账本 · ${source.dailyCount} 个日明细</span>
        <span>${source.quotaFileCount || 0} 个额度文件 · ${source.quotaSnapshotCount || 0} 个日历史 · ${source.quotaObservationFileCount || 0} 个观测文件 · ${source.quotaObservationCount || 0} 个观测点${source.quotaLatest ? ` · ${escapeHtml(source.quotaLatest.file?.name || "latest")}` : ""}</span>
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
  const isForecast = view === "forecast";
  const isResetPlanner = view === "resets";
  const isUsageView = !isSources && !isForecast && !isResetPlanner;
  const showReset = (view === "overview" && visibleProviders().some((provider) => provider.resetCredits))
    || Boolean(providerMeta[view]?.resetCredits);
  els.forecastView.classList.toggle("is-hidden", !isForecast);
  els.resetPlannerView.classList.toggle("is-hidden", !isResetPlanner);
  els.metricGrid.classList.toggle("is-hidden", isForecast || isResetPlanner);
  els.sourceCompare.classList.toggle("is-hidden", !(view === "overview" || isSources));
  els.detailGrid.classList.toggle("is-hidden", !isUsageView);
  els.lowerGrid.classList.toggle("is-hidden", !isUsageView);
  els.tablePanel.classList.toggle("is-hidden", !isUsageView);
  els.resetCredits.classList.toggle("is-hidden", !showReset);
}

function setActiveTab(view) {
  viewTabElements().forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === view);
  });
}

async function fetchUsage(source) {
  const response = await fetch(`/api/usage?source=${encodeURIComponent(source)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchQuota(source) {
  const response = await fetch(`/api/quota?source=${encodeURIComponent(source)}`, { cache: "no-store" });
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
  els.sourcePath.textContent = "usage-logs/{provider}/daily";
  els.metricGrid.replaceChildren();
  renderMetric("数据源", `${sources.length} 个`, `${providerCatalog.length} 个智能体 + 聚合来源`);
  renderMetric("已有快照", `${ready} 个`, "至少导出一次后显示");
  renderMetric("计划任务", "12:00", "默认每天中午导出");
  renderMetric("存储位置", "项目内", "滚动 JSON，Token 日账本永久保留");
  renderSourceStatus(data);
  setStatus(`已读取 ${sources.length} 个数据源状态`, "ok");
}

async function loadForecastView() {
  setStatus("正在读取用量与账户额度...");
  const forecastProviders = visibleProviders().filter((entry) => entry.forecast !== false);
  const results = await Promise.all(forecastProviders.map(async (provider) => {
    const [usage, quota] = await Promise.all([fetchUsage(provider.id), fetchQuota(provider.id)]);
    return [provider.id, usage, quota];
  }));
  forecastSnapshots = Object.fromEntries(results.map(([id, usage]) => [id, usage]));
  forecastQuotas = Object.fromEntries(results.map(([id, , quota]) => [id, quota]));
  setForecastAgent(forecastAgent);
  const ready = Object.values(forecastSnapshots).filter((snapshot) => snapshot?.latestFile).length;
  const quotaReady = Object.values(forecastQuotas).filter((quota) => quota?.latest).length;
  setStatus(`已读取 ${ready} 个本地用量来源、${quotaReady} 个账户额度快照`, ready || quotaReady ? "ok" : "loading");
}

function plannerTime(value) {
  if (!Number.isFinite(Number(value))) return "--";
  return new Date(Number(value)).toLocaleString("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function calculateResetPlan(input) {
  if (!resetPlannerWorker) {
    resetPlannerWorker = new Worker("/reset-planner.js");
    resetPlannerWorker.onmessage = ({ data }) => {
      const pending = pendingResetPlans.get(data.id);
      if (!pending) return;
      pendingResetPlans.delete(data.id);
      if (data.error) pending.reject(new Error(data.error));
      else pending.resolve(data.result);
    };
    resetPlannerWorker.onerror = () => {
      for (const pending of pendingResetPlans.values()) pending.reject(new Error("规划计算暂不可用，请重新加载页面"));
      pendingResetPlans.clear();
      resetPlannerWorker.terminate();
      resetPlannerWorker = null;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++resetPlannerRequest;
    pendingResetPlans.set(id, { resolve, reject });
    resetPlannerWorker.postMessage({ id, input });
  });
}

function plannerMetric(label, value, sub) {
  return `<div class="reset-plan-metric"><span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong><small>${escapeHtml(sub)}</small></div>`;
}

function renderResetPlan(provider, forecast, result, loadError) {
  const section = document.createElement("section");
  section.className = "reset-plan-provider";
  section.dataset.resetProvider = provider.id;
  const header = `<div class="panel-heading"><h3>${escapeHtml(provider.label)}</h3>
    <span class="pill">${result?.availableCount ?? "--"} 次可用</span></div>`;
  const reasons = {
    "credits-unavailable": "暂时无法读取重置库存，刷新后再生成建议。",
    "credit-count-mismatch": "可用次数与明细状态不一致，暂不分配重置时间，请刷新账户状态。",
    "no-dated-credits": "尚无到期时间和适用范围明确的 reset，暂不安排。",
    "quota-unavailable": "当前周额度或自然重置时间缺失、已过期，请先刷新全部数据。",
    "stale-quota": "账户额度快照已超过 6 小时，请刷新全部数据后查看安排。",
    "stale-usage": "Token 快照过旧或与账户额度的采集时间相差超过 1 小时，请刷新全部数据后重算。",
    "no-recent-usage": "近期尚无可用 Token 速率，等待产生用量后重新计算。",
    "censored-demand-unavailable": "额度耗尽期间的需求尚不明确，可观测时段不足，暂缓定量规划。不会把受限零消耗当成低需求。有工作待完成且额度已用尽时，可考虑最早到期的 reset。",
    "insufficient-fit": "仍需至少 2 个有效消耗区间校准额度。当前建议：有工作待完成时，优先在额度接近耗尽后使用最早到期的 reset。",
    "weak-fit": "历史额度与 Token 的对应关系暂不稳定，等待更多有效区间后生成时间表。",
    "model-calibrating": "近期模型额度校准中：主要模型需至少 3 个有效扣减区间并通过权重检查，不沿用其他模型的旧权重。历史记录保留，官方余额仍正常展示。",
    "model-mix-changed": "近期模型组合已变化，原始 Token 比率暂不适用。等待模型权重校准后再生成定量规划，历史记录不会清空。",
    "model-fit-unstable": "近期模型实际扣减与拟合偏差过大，暂缓定量规划。官方余额、重置到期时间和历史记录仍保留，后续有效消耗会继续校准。",
    "unknown-reset-scope": "该来源尚未确认 reset 适用的额度窗口，暂不生成时间表。",
  };
  if (!result || result.status !== "ready") {
    const message = loadError || (result?.status === "empty" ? "目前没有可用的 banked reset。"
      : reasons[result?.reason] || "等待可用的额度与用量数据。");
    const expiry = result?.credits?.[0]?.expiresAt;
    section.innerHTML = `${header}<p class="reset-plan-message">${escapeHtml(message)}</p>
      ${expiry ? `<p class="reset-plan-basis">最早到期 ${plannerTime(expiry)} · 生成具体建议前不会假定每张 reset 对应的 Token 数。</p>` : ""}`;
    return section;
  }
  const plan = result.plan;
  const first = plan.actions[0];
  const unused = Math.max(0, result.credits.length - plan.actions.length - result.deferredCount);
  const scopeLabel = `全期最多可用额度 · ${result.policyUncertain ? "条件方案：" : ""}${plan.cycleMode === "restart" ? "使用后重新起算周期" : "保留原自然重置日"}`;
  const nextLabel = first
    ? (first.at <= Date.now() + 30 * 60000 ? "当前可考虑使用" : `${plannerTime(first.at)} 附近`)
    : "本情景暂不需要重置";
  const advice = first
    ? `预计届时剩余 ${first.discardedPercent.toFixed(1)}%，优先使用 ${plannerTime(first.expiresAt)} 到期的 reset。实际额度接近该水平且有工作待完成时再使用。`
    : "在相同的近期工作需求下，本次搜索未找到优于等待自然恢复的重置安排，可先保留库存。";
  const schedule = result.credits.map((credit) => {
    const action = plan.actions.find((entry) => entry.ordinal === credit.ordinal);
    const deferred = credit.expiresAt - 3600000 >= result.end;
    return `<tr><td>${escapeHtml(credit.title)}<small>${plannerTime(credit.expiresAt)} 到期</small></td>
      <td>${action ? plannerTime(action.at) : deferred ? "规划期外" : "暂不安排"}</td>
      <td>${action ? `${action.discardedPercent.toFixed(1)}%` : "--"}</td>
      <td>${action ? plannerTime(action.nextResetAt) : "--"}</td></tr>`;
  }).join("");
  const scenarios = result.scenarios.map((scenario, index) => {
    const alternatives = scenario.alternatives;
    const low = Math.min(...alternatives.map((entry) => entry.gainPercent));
    const high = Math.max(...alternatives.map((entry) => entry.gainPercent));
    const benefit = high - low > 0.05 ? `${low.toFixed(1)} 至 ${high.toFixed(1)}` : low.toFixed(1);
    return `<tr><td>${["较低 · 0.7×", "近期常态 · 1×", "较高 · 1.3×"][index]}</td>
      <td>${scenario.percentPerDay.toFixed(1)} 点 / 日</td><td>+${benefit} 点</td>
      <td>${alternatives.map((entry) => `${result.policyUncertain ? (entry.cycleMode === "restart" ? "重新起算：" : "原定周期：") : ""}${entry.actions[0] ? plannerTime(entry.actions[0].at) : "暂不需要"}`).join("<br>")}</td></tr>`;
  }).join("");
  const certificate = plan.certificate;
  const proofLabel = certificate.continuousOptimal ? "模型内已达连续时间上界"
    : `${Math.round(certificate.stepMs / 60000)} 分钟网格最优`;
  const gapLabel = !certificate.continuousOptimal && certificate.continuousGapPercent < 0.1
    ? "小于 0.1" : certificate.continuousGapPercent.toFixed(1);
  const urgent = result.urgentPlans.filter((entry) => entry.actions.length && entry.extraTodayPercent > 0.05);
  const stress = result.stress;
  section.innerHTML = `${header}
    <div class="reset-plan-advice"><span class="section-label">${escapeHtml(scopeLabel)}</span>
      <h4>${escapeHtml(nextLabel)}</h4><p>${escapeHtml(advice)}</p></div>
    ${urgent.length ? `<div class="reset-plan-urgent"><strong>今天优先续工</strong>
      ${urgent.map((entry) => `<p>${result.policyUncertain ? `${entry.cycleMode === "restart" ? "重新起算周期" : "保留原周期"}：` : ""}
        ${entry.actions[0].at <= Date.now() + 30 * 60000 ? "现在可考虑重置" : `${plannerTime(entry.actions[0].at)} 附近重置`}，
        未来 24 小时比等待自然恢复多用 ${entry.extraTodayPercent.toFixed(1)} 个额度百分点。</p>
        <p>${entry.versusRegularTodayPercent > 0.05 ? `相比全期方案，今天多用 ${entry.versusRegularTodayPercent.toFixed(1)} 点；全期少用 ${entry.horizonTradeoffPercent.toFixed(1)} 点额度。` : "与全期方案的近期收益一致。"}</p>`).join("")}
      <p>适用于今天确实要继续工作；先最大化未来 24 小时可支持量，再优化全期。短时限流仍以官方状态为准。</p>
    </div>` : ""}
    <div class="reset-plan-metrics">
      ${plannerMetric("预计额外可用额度", `+${plan.gainPercent.toFixed(1)} 点`, `相当于 ${(plan.gainPercent / 100).toFixed(2)} 份当前完整窗口额度`)}
      ${plannerMetric("不重置 / 按方案累计用量", `${plan.baselinePercent.toFixed(1)} / ${plan.servedPercent.toFixed(1)} 点`, `相同需求 · 规划至 ${plannerTime(result.end)}`)}
      ${plannerMetric("计划使用 / 暂不安排", `${plan.actions.length} / ${unused} 次`, `另有 ${result.excludedCount + result.deferredCount} 次范围或期限待确认`)}
      ${plannerMetric("提前重置丢弃余额", `${plan.discardedPercent.toFixed(1)} 点`, "累计额度百分点，不是当前余额百分比")}
    </div>
    <p class="reset-plan-basis">100 点 = 当前 ${Math.round(result.period / 86400000)} 天窗口的一份完整额度，跨多次恢复可累计超过 100 点。这里统计实际可用增益，不是 reset 面值之和。</p>
    <p class="reset-plan-basis">${plan.gainEquivalentTokens !== null ? `辅助折算：约多支持 ${formatCompact(plan.gainEquivalentTokens)} 模型等效 Token；` : "模型等效 Token 尚未启用；"}按近期模型组合估算约 ${formatCompact(plan.gainTokens)} 原始 Token。两种 Token 不混加，也不代表固定套餐容量。</p>
    <div class="reset-plan-table" tabindex="0" aria-label="${escapeHtml(provider.label)} 重置时间表">
      <table><thead><tr><th>Reset</th><th>建议时间</th><th>届时剩余</th><th>新的自然重置</th></tr></thead><tbody>${schedule}</tbody></table>
    </div>
    <p class="reset-plan-basis">当前剩余 ${result.remainingPercent.toFixed(0)}% · 自然重置 ${plannerTime(result.resetAt)} · ${result.intervalCount} 个有效区间 · 拟合 R² ${result.fitQuality.toFixed(2)} · ${forecast.modelFit?.active ? "已按近期模型组合换算" : "按原始 Token 拟合"}</p>
    ${result.demand?.adjusted ? `<p class="reset-plan-basis">受限需求修正：${escapeHtml(demandStatus(result.demand))}。实际记录日均 ${formatCompact(forecast.rawRate.observedWeightedRate || 0)} 原始 Token；续工需求估计 ${formatCompact(result.dailyTokens)} 原始 Token / 日。未知待办不自动补入账本，也不承诺这些需求一定发生。</p>` : ""}
    <details class="reset-plan-details reset-plan-proof"><summary>${proofLabel}</summary>
      <p>全期方案由动态规划计算，枚举允许的重置时刻而不截断候选状态。当前网格 ${Math.round(certificate.stepMs / 60000)} 分钟，另含到期和原定自然恢复边界；${certificate.gridPoints} 个时间点。</p>
      <p>在当前需求和周期假设下，连续时间的累计可用额度上界为 ${certificate.continuousUpperPercent.toFixed(1)} 点，当前安排距上界 ${gapLabel} 点。差为零时证明此模型内全局最优；非零时仅证明网格内最优，上界可能较松。</p>
      <p>这不是现实收益保证，也不是概率区间。使用后的周期规则、需求、模型组合或工作时段变化后，都要重新计算。</p>
    </details>
    ${result.target ? `<details class="reset-plan-details reset-plan-target"><summary>有更多待办时：参考日均 ${result.target.percentPerDay.toFixed(1)} 个额度百分点</summary>
      <p>约为当前节奏的 ${result.target.factor.toFixed(2)} 倍。在这组模拟中，可用完纳入规划的 ${result.credits.length - result.deferredCount} 次 reset，每次提前丢弃的余额不超过 5%。这是可行工作量参考，不是要求额外消耗 Token。</p>
      ${result.target.alternatives.map((alternative) => `<p><strong>${alternative.cycleMode === "restart" ? "重新起算周期" : "保留原自然重置日"}</strong> · 预计比同样高工作量下不使用 reset 多用 ${alternative.gainPercent.toFixed(1)} 点额度。</p>
        <ol class="reset-target-actions">${alternative.actions.map((action) => `<li>${plannerTime(action.at)} 附近 · 使用 ${plannerTime(action.expiresAt)} 到期的 reset · 届时剩余 ${action.discardedPercent.toFixed(1)}%</li>`).join("")}</ol>`).join("")}
    </details>` : ""}
    <details class="reset-plan-details reset-plan-stress"><summary>历史波动压力检验</summary>
      <p>排除 ${stress.excludedDays || 0} 个受限或不确定日，不将其当作零需求，也不拼接缺口两侧的日期。</p>
      ${stress.ready ? `<p>最近 ${stress.sampleDays} 个可用完整日，从 ${stress.blockCount} 个原日历连续 3 日块抽样，检验同一时间表的 8 条需求路径；其中 4 条额外假设每天集中在 6 小时内工作。</p>
        <p>相对各自路径下不重置：平均多用 ${stress.meanGainPercent.toFixed(1)} 点额度，范围 ${stress.minGainPercent.toFixed(1)} 至 ${stress.maxGainPercent.toFixed(1)} 点；${stress.negativeCases} / 8 条路径收益为负。</p>
        <p>固定安排平均仍有 ${stress.meanUnservedPercent.toFixed(1)} 点额度需求未能及时满足。改为有工作且用尽时才重置，平均相对固定安排多用 ${stress.meanReactiveAdvantagePercent.toFixed(1)} 点额度，${stress.reactiveWorseCases} / 8 条路径反而更差。</p>
        <p>保留连续高低负载日，不使用未来信息改写各条路径的时间表。此处不是概率预测或随机最优策略；6 小时集中工作是压力假设，并非从日总量推断的作息。</p>`
      : `<p>需要至少 14 个可用完整日、其中至少 4 日有用量，并存在连续 3 日块，当前有 ${stress.sampleDays} 日、${stress.blockCount || 0} 个块。暂不生成随机波动结论。</p>`}
    </details>
    <details class="reset-plan-details"><summary>消耗变化与计算假设</summary>
      <div class="reset-plan-table" tabindex="0" aria-label="消耗情景对比"><table><thead><tr><th>情景</th><th>额度需求</th><th>额外可用额度</th><th>首次重置</th></tr></thead><tbody>${scenarios}</tbody></table></div>
      <p>优化目标是当前账户窗口的累计可用额度。等效 Token 权重来自实际额度扣减与各模型用量的拟合，不使用 API 单价作订阅扣减倍数。等效 Token 基准会随重新拟合变化，只作本次预测的辅助刻度；不同提供商、套餐和额度窗口不能直接相加比较。</p>
      <p>0.7× / 1× / 1.3× 是消耗情景，并非置信区间。日均需求均匀分摊到小时，时间表是近似安排；睡眠、停工或模型改变后，应按实际余额重算。截止到期前预留约 1 小时操作时间。</p>
      <p>只估算当前周额度覆盖的本地工作量，其他共享产品消耗和短时限流可能降低实际收益。reset 只补满余额，不与原余额相加。此处仅提供建议，兑换仍在官方客户端完成。</p>
      <p>历史消耗可能被限流压低，真实需求可能更高。未及时满足的需求不会自动结转为未来待办。需要优先处理今天的工作时，参考续工方案；Token 日志不能确定任务价值或截止日。</p>
      ${result.policyUncertain ? "<p>该来源的重置周期规则尚未确认，上表分别计算保留原重置日与重新起算周期。主时间表采用增益较小情景，实际周期以兑换后的账户信息为准。</p>" : plan.cycleMode === "restart" ? "<p>Full reset 会改变周重置日期，按重置后立即开始工作、一个窗口时长后恢复估算。</p>" : "<p>按已注册规则保留原自然恢复时间，reset 仅恢复当前余额。</p>"}
      ${result.truncated ? "<p>计算范围最多 60 天、24 张可识别 reset；未纳入部分保留在库存，下次刷新重新评估。</p>" : ""}
    </details>`;
  return section;
}

async function fetchResetInventory(source) {
  try {
    const response = await fetch(`/api/reset-credits?source=${encodeURIComponent(source)}`, { cache: "no-store" });
    const data = await response.json();
    return { ...data, source, ok: response.ok && data.ok === true,
      message: data.message || (!response.ok ? `HTTP ${response.status}` : data.ok !== true ? "重置库存读取失败" : null),
      source_label: data.source_label || providerMeta[source]?.label || source };
  } catch (error) {
    return { source, source_label: providerMeta[source]?.label || source, ok: false, message: error.message };
  }
}

async function loadResetPlannerView() {
  const generation = resetPlannerGeneration;
  const providers = visibleProviders().filter((provider) => provider.resetCredits);
  els.resetPlannerProviders.replaceChildren(emptyState("正在分析重置库存与历史消耗..."));
  els.sourcePath.textContent = "本地用量 + 账户额度 + banked reset";
  setStatus("正在计算重置安排...");
  if (!providers.length) {
    els.resetPlannerProviders.replaceChildren(emptyState("当前显示的数据源没有可用的重置规划来源。"));
    setStatus("当前没有支持 banked reset 的显示来源", "ok");
    return;
  }
  const sections = [];
  const failures = [];
  for (const provider of providers) {
    try {
      const [usage, quota, credits] = await Promise.all([
        fetchUsage(provider.id), fetchQuota(provider.id),
        fetchResetInventory(provider.id),
      ]);
      if (generation !== resetPlannerGeneration || currentView !== "resets") return;
      if (!credits.ok) throw new Error(`重置库存读取失败：${credits.message}`);
      forecastSnapshots[provider.id] = usage;
      forecastQuotas[provider.id] = quota;
      const policy = credits.planningPolicy;
      const window = (quota?.latest?.windows || []).find((entry) => policy?.windowNames?.includes(entry.name)
        && Number(entry.windowDurationMins) >= 10080 && !entry.modelPatterns?.length);
      const forecast = buildForecast(provider.id, window?.name);
      const usedPercent = inputNumberOrNull(window?.usedPercent);
      const result = await calculateResetPlan({
        now: Date.now(), credits, policy,
        remainingPercent: inputNumberOrNull(window?.remainingPercent)
          ?? (usedPercent === null ? null : 100 - usedPercent),
        resetAt: window?.resetsAt, windowDurationMins: window?.windowDurationMins,
        fetchedAt: quota?.latest?.fetchedAt, dailyTokens: forecast.rawRate.weightedRate,
        equivalentDailyTokens: forecast.modelFit?.active ? forecast.rate.weightedRate : null,
        calibration: forecast.calibration,
        usageFetchedAt: usage.latestFile?.modifiedAt ?? null,
        percentPerDay: forecast.quotaFit?.percentPerDay,
        intervalCount: forecast.quotaFit?.intervalCount ?? Math.max(0, (forecast.quotaFit?.sampleCount || 0) - 1),
        rSquared: forecast.quotaFit?.model?.rSquared,
        demand: forecast.rate.demand,
        recentDailyTokens: forecast.rate.stressHistory,
      });
      if (generation !== resetPlannerGeneration || currentView !== "resets") return;
      sections.push(renderResetPlan(provider, forecast, result));
    } catch (error) {
      failures.push({ source: `reset:${provider.id}`, ok: false, error: error.message });
      sections.push(renderResetPlan(provider, null, null, `暂时无法分析：${error.message}`));
    }
    // Yield between providers so navigating away stays responsive during a large search.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (generation !== resetPlannerGeneration || currentView !== "resets") return;
  els.resetPlannerProviders.replaceChildren(...sections);
  setStatus(failures.length ? `重置规划部分读取失败：${failures.map((item) => `${item.source}（${item.error}）`).join("；")}`
    : "重置规划已更新，实际使用前请核对当前余额与到期时间", failures.length ? "error" : "ok");
  return failures;
}

async function loadView(view = currentView) {
  resetPlannerGeneration += 1;
  if (resetPlannerWorker && pendingResetPlans.size) {
    resetPlannerWorker.terminate();
    resetPlannerWorker = null;
    for (const pending of pendingResetPlans.values()) pending.reject(new Error("已切换页面，取消旧规划"));
    pendingResetPlans.clear();
  }
  const hiddenProviderView = providerMeta[view] && !visibleProviderIds.has(view);
  const unavailableForecast = view === "forecast" && !forecastAgent;
  currentView = VIEW_CONFIGS[view] && !hiddenProviderView && !unavailableForecast ? view : "overview";
  const config = VIEW_CONFIGS[currentView];
  setActiveTab(currentView);
  setViewVisibility(currentView);

  try {
    if (currentView === "resets") {
      return await loadResetPlannerView();
    }
    if (currentView === "sources") {
      await loadSourcesView();
      return;
    }

    if (currentView === "forecast") {
      await loadForecastView();
      return;
    }

    setStatus(`正在读取 ${config.label} JSON...`);

    if (currentView === "overview") {
      const entries = await Promise.all(visibleProviders().map(async (provider) => [provider.id, await fetchUsage(provider.id)]));
      const bundle = Object.fromEntries(entries);
      const overview = mergeUsageSnapshots(bundle);
      renderUsage(overview, "overview", bundle);
      setStatus(overview.latestFile ? `已聚合 ${overview.latestFile.name}` : "未发现智能体快照", overview.latestFile ? "ok" : "loading");
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
  if (!els.resetSummary) return [];
  const generation = resetPlannerGeneration;
  const sources = currentView === "overview"
    ? visibleProviders().filter((provider) => provider.resetCredits).map((provider) => provider.id)
    : providerMeta[currentView]?.resetCredits ? [currentView] : [];
  if (!sources.length) return [];
  els.resetSummary.textContent = "正在读取可用重置额度...";

  try {
    const payloads = await Promise.all(sources.map(fetchResetInventory));
    if (generation !== resetPlannerGeneration) return [];
    const failures = payloads.filter((payload) => !payload.ok)
      .map((payload) => ({ source: `reset:${payload.source}`, ok: false, error: payload.message }));
    if (failures.length) setStatus(`重置额度读取失败：${failures.map((item) => `${item.source}（${item.error}）`).join("；")}`, "error");
    if (payloads.length === 1) {
      renderResetCredits(payloads[0]);
      return failures;
    }
    const successful = payloads.filter((payload) => payload.ok);
    renderResetCredits({
      ok: successful.length > 0,
      partial: failures.length > 0,
      message: payloads.map((payload) => `${payload.source_label}：${payload.message || "读取失败"}`).join("；"),
      summary: payloads.map((payload) => payload.ok
        ? `${payload.source_label} 可用 ${Number(payload.available_count) || 0} 次`
        : `${payload.source_label}：${payload.message || "读取失败"}`).join("；"),
      available_count: successful.reduce((sum, payload) => sum + (Number(payload.available_count) || 0), 0),
      credits: successful.flatMap((payload) => (payload.credits || []).map((credit) => ({
        ...credit,
        title: `${payload.source_label} · ${credit.title || "Rate-limit reset"}`,
      }))),
    });
    return failures;
  } catch (error) {
    renderResetCredits({
      ok: false,
      message: `读取重置额度失败：${error.message}`,
    });
    setStatus(`重置额度读取失败：${error.message}`, "error");
    return sources.map((source) => ({ source: `reset:${source}`, ok: false, error: error.message }));
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

    const viewFailures = await loadView(currentView);
    const creditFailures = await loadResetCredits();
    const failures = [...new Map([
      ...(data.results || []).filter((item) => !item.ok || item.partial),
      ...(Array.isArray(viewFailures) ? viewFailures : []), ...creditFailures,
    ].map((item) => [item.source, item])).values()];
    if (data.partial || failures.length) {
      const failed = failures
        .map((item) => {
          const error = String(item.error || item.warning || item.warnings?.join("; ") || "");
          if (item.source === "quota:claude" && /claude auth login/i.test(error)) {
            return "quota:claude（需重新登录 Claude Code）";
          }
          return error ? `${item.source}（${error.slice(0, 220)}）` : item.source;
        })
        .join(", ") || "后台返回部分失败，请检查数据源状态";
      setStatus(`部分导出完成，失败来源：${failed}`, "error");
    } else {
      setStatus(exportSource === "everything" ? "已导出并刷新全部数据源" : "已导出并刷新当前视图", "ok");
    }
  } catch (error) {
    setStatus(`导出刷新失败：${error.message}`, "error");
  } finally {
    els.exportBtn.disabled = false;
    els.refreshBtn.disabled = false;
  }
}

els.viewTabs.addEventListener("click", (event) => {
  const tab = event.target.closest(".view-tab");
  if (!tab) return;
  const view = tab.dataset.view || "overview";
  history.replaceState(null, "", `#${view}`);
  loadView(view).then(loadResetCredits);
});

els.resetPlanLink.addEventListener("click", (event) => {
  event.preventDefault();
  history.replaceState(null, "", "#resets");
  loadView("resets");
});

els.forecastAgentTabs.addEventListener("click", (event) => {
  const tab = event.target.closest(".forecast-agent-tab");
  if (!tab) return;
  setForecastAgent(tab.dataset.forecastAgent);
});

els.refreshBtn.addEventListener("click", () => exportAndRefresh("everything"));
els.exportBtn.addEventListener("click", () => exportAndRefresh("everything"));
els.updateClose.addEventListener("click", () => hideUpdateBanner({ remember: true }));
els.displaySettingsBtn.addEventListener("click", openDisplaySettings);
els.displaySettingsClose.addEventListener("click", closeDisplaySettings);
els.displaySettingsCancel.addEventListener("click", closeDisplaySettings);
els.displaySettingsAll.addEventListener("click", () => {
  els.providerSettingsList.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = true;
  });
  updateDisplaySettingsCount();
});
els.providerSettingsList.addEventListener("change", updateDisplaySettingsCount);
els.displaySettingsSave.addEventListener("click", saveDisplaySettings);

async function bootstrap() {
  loadUpdateStatus();
  try {
    await loadProviderCatalog();
    const initialView = location.hash.replace("#", "") || "overview";
    await loadView(initialView);
    await loadResetCredits();
  } catch (error) {
    setStatus(`初始化失败：${error.message}`, "error");
  }
}

bootstrap();
