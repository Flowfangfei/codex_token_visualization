const els = {
  metricGrid: document.querySelector("#metricGrid"),
  metricTemplate: document.querySelector("#metricTemplate"),
  statusText: document.querySelector("#statusText"),
  statusDot: document.querySelector("#statusDot"),
  sourcePath: document.querySelector("#sourcePath"),
  sourceCompare: document.querySelector("#sourceCompare"),
  calendarHeatmapPanel: document.querySelector("#calendarHeatmapPanel"),
  calendarHeatmap: document.querySelector("#calendarHeatmap"),
  heatmapRangePill: document.querySelector("#heatmapRangePill"),
  heatmapSummary: document.querySelector("#heatmapSummary"),
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
};

let currentView = "overview";
let latestResetCredits = null;
let providerCatalog = [];
let providerMeta = {};
let visibleProviderIds = new Set();
let forecastAgent = null;
let forecastSnapshots = {};
let forecastQuotas = {};
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

function buildForecastRate(days, fallbackDailyTokens) {
  const today = localDateKey();
  const todayUsage = usageForDateRange(days, today, today);
  const now = new Date();
  const elapsedHours = Math.max(1, now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600);
  const todayRate = todayUsage > 0 ? (todayUsage / elapsedHours) * 24 : null;
  const threeDayStart = addDays(today, -2);
  const sevenDayStart = addDays(today, -6);
  const threeDayUsage = usageForDateRange(days, threeDayStart, today);
  const sevenDayUsage = usageForDateRange(days, sevenDayStart, today);
  const threeDayRate = threeDayUsage > 0 ? threeDayUsage / 3 : null;
  const sevenDayRate = sevenDayUsage > 0 ? sevenDayUsage / 7 : null;

  const weightedParts = [];
  if (todayRate) weightedParts.push({ value: todayRate, weight: 0.55 });
  if (threeDayRate) weightedParts.push({ value: threeDayRate, weight: todayRate ? 0.3 : 0.65 });
  if (sevenDayRate) weightedParts.push({ value: sevenDayRate, weight: todayRate ? 0.15 : 0.35 });

  const weightTotal = weightedParts.reduce((sum, part) => sum + part.weight, 0);
  const weightedRate = weightTotal
    ? weightedParts.reduce((sum, part) => sum + part.value * part.weight, 0) / weightTotal
    : inputNumberOrNull(fallbackDailyTokens);

  return {
    today,
    todayUsage,
    elapsedHours,
    todayRate,
    threeDayUsage,
    threeDayRate,
    sevenDayUsage,
    sevenDayRate,
    weightedRate,
    isFallback: !weightTotal && inputNumberOrNull(fallbackDailyTokens) !== null,
  };
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

function buildForecast(agent) {
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
  const selectedWindow = selectedQuotaWindow(quotaData?.latest, forecastWindowSelections[agent]);
  const selectedWindowName = selectedWindow?.name || null;
  const account = accountQuotaSummary(quotaData?.latest, selectedWindowName);
  const rawRate = buildForecastRate(days, plan.fallbackDailyTokens);
  const rawQuotaFit = fitQuotaBurn(days, quotaData, account, rawRate.weightedRate, null, selectedWindowName);
  const hasQuotaObservations = quotaObservationSegments(quotaData, selectedWindowName).length > 0;
  const historyIntervals = quotaHistoryIntervals(quotaData, selectedWindowName);
  const modelFit = hasQuotaObservations
    ? globalThis.ForecastModel?.fitModelWeightsFromIntervals(historyIntervals, rawQuotaFit?.model?.slope)
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
  const resolvedModelFit = modelFit || {
    active: false,
    sampleCount: historyIntervals.length || rawQuotaFit?.sampleCount || 0,
    requiredSamples: 7,
    reason: "model-module-unavailable",
    weights: [],
  };
  const effectiveDays = resolvedModelFit.active ? globalThis.ForecastModel.applyModelWeights(days, resolvedModelFit) : days;
  const rate = resolvedModelFit.active ? buildForecastRate(effectiveDays, plan.fallbackDailyTokens) : rawRate;
  const quotaFit = resolvedModelFit.active
    ? fitQuotaBurn(effectiveDays, quotaData, account, rate.weightedRate, resolvedModelFit, selectedWindowName)
    : rawQuotaFit;
  const budgetTokens = inputNumberOrNull(plan.budgetTokens);
  const remainingTokens = budgetTokens === null || usedTokens === null ? null : Math.max(budgetTokens - usedTokens, 0);
  const daysUntilEnd = periodEnd ? Math.max(0, (dayDistance(today, periodEnd) ?? -1) + 1) : null;
  const targetDailyTokens = remainingTokens !== null && daysUntilEnd && daysUntilEnd > 0 ? remainingTokens / daysUntilEnd : null;
  const manualExhaustionDays = remainingTokens !== null && rate.weightedRate > 0 ? remainingTokens / rate.weightedRate : null;
  const exhaustionDays = quotaFit?.model && Number.isFinite(quotaFit.runwayDays) ? quotaFit.runwayDays : manualExhaustionDays;
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
    els.forecastAdvice.innerHTML = `<strong>跨周期拟合已启用。</strong><span>基于${historyText}，将${tokenBasis} 增量拟合为官方额度百分比；旧周期按 28 天半衰期降低权重。额度重置只开启新分段，不会清空历史样本。${escapeHtml(modelFitStatus(forecast.modelFit))}；预计 ${escapeHtml(formatRunway(forecast.exhaustionDays))} 后耗尽。</span>`;
  } else if (account.type === "percent") {
    const intervalCount = fit?.intervalCount || 0;
    const requiredIntervals = fit?.requiredIntervals || 2;
    const currentPoints = fit?.currentSegmentPoints || fit?.sampleCount || 0;
    els.forecastAdvice.innerHTML = `<strong>官方额度已同步。</strong><span>已收集 ${intervalCount} / ${requiredIntervals} 个跨周期有效区间，当前周期 ${currentPoints} 个观测点；达到 ${requiredIntervals} 个有效区间后启用原始 Token 拟合。额度重置只开启新分段，历史样本会继续参与并随时间衰减。${escapeHtml(modelFitStatus(forecast.modelFit))}。</span>`;
  } else {
    els.forecastAdvice.innerHTML = `<strong>账户账期已同步。</strong><span>账户计划单位与 token 不是已确认的一对一口径；保留原始已用、剩余和账期，待每日事件数据积累后再启用拟合。</span>`;
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

function renderForecastRates(forecast) {
  els.forecastRateList.replaceChildren();
  const rate = forecast.rate;
  const adjusted = Boolean(forecast.modelFit?.active);
  const tokenUnit = adjusted ? "等效 Token" : "Token";
  const rows = [
    {
      label: "今天截至当前",
      value: rate.todayRate,
      caption: rate.todayRate ? `${formatCompact(rate.todayUsage)} ${tokenUnit} / ${rate.elapsedHours.toFixed(1)} 小时` : "今天暂无本地用量",
    },
    {
      label: "近 3 日日均",
      value: rate.threeDayRate,
      caption: rate.threeDayRate ? `近 3 个自然日 ${formatCompact(rate.threeDayUsage)} ${tokenUnit}` : "近 3 日暂无本地用量",
    },
    {
      label: "近 7 日日均",
      value: rate.sevenDayRate,
      caption: rate.sevenDayRate ? `近 7 个自然日 ${formatCompact(rate.sevenDayUsage)} ${tokenUnit}` : "近 7 日暂无本地用量",
    },
    {
      label: adjusted ? "模型等效日均" : "综合预测日均",
      value: rate.weightedRate,
      caption: rate.isFallback
        ? "使用手动日均兜底"
        : adjusted
          ? `原始 ${formatCompact(forecast.rawRate.weightedRate || 0)} / 日 · ${modelWeightSummary(forecast.modelFit)}`
          : "今日、3 日和 7 日节奏加权",
      weighted: true,
    },
  ];

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
      forecast.modelFit?.active ? "账户额度反向学习模型权重" : forecast.rate.isFallback ? "手动日均" : "今日、3 日、7 日加权"
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

function renderCalendarHeatmap(days) {
  els.calendarHeatmap.replaceChildren();
  const heatmapApi = globalThis.CalendarHeatmap;
  if (!heatmapApi || !days.length) {
    els.heatmapRangePill.textContent = "--";
    els.heatmapSummary.textContent = "暂无每日用量记录";
    els.calendarHeatmap.setAttribute("aria-label", "暂无每日 Token 用量记录");
    els.calendarHeatmap.appendChild(emptyState("暂无每日用量记录"));
    return;
  }

  const model = heatmapApi.buildCalendarHeatmap(days, {
    today: localDateKey(),
    minWeeks: 13,
    maxWeeks: 53,
  });
  if (!model.cells.length) {
    els.heatmapRangePill.textContent = "--";
    els.heatmapSummary.textContent = "暂无每日用量记录";
    els.calendarHeatmap.setAttribute("aria-label", "暂无每日 Token 用量记录");
    els.calendarHeatmap.appendChild(emptyState("暂无每日用量记录"));
    return;
  }

  els.heatmapRangePill.textContent = `${model.rangeStart} - ${model.rangeEnd}`;
  els.heatmapSummary.textContent = `${model.weekCount} 周共 ${formatCompact(model.totalTokens)} Token · ${model.activeDays} 个活跃日`;
  els.calendarHeatmap.setAttribute(
    "aria-label",
    `${model.rangeStart}至${model.rangeEnd}的每日 Token 用量，共${model.activeDays}个活跃日`
  );

  const shell = document.createElement("div");
  shell.className = "calendar-heatmap-shell";

  const weekdays = document.createElement("div");
  weekdays.className = "calendar-heatmap-weekdays";
  const spacer = document.createElement("span");
  spacer.setAttribute("aria-hidden", "true");
  weekdays.appendChild(spacer);
  ["一", "二", "三", "四", "五", "六", "日"].forEach((label, index) => {
    const dayLabel = document.createElement("span");
    dayLabel.textContent = index % 2 === 0 || index === 6 ? label : "";
    dayLabel.setAttribute("aria-hidden", "true");
    weekdays.appendChild(dayLabel);
  });
  shell.appendChild(weekdays);

  const content = document.createElement("div");
  content.className = "calendar-heatmap-content";
  content.style.setProperty("--week-count", model.weekCount);

  const months = document.createElement("div");
  months.className = "calendar-heatmap-months";
  months.setAttribute("aria-hidden", "true");
  model.months.forEach((month) => {
    const label = document.createElement("span");
    label.className = "calendar-heatmap-month";
    label.style.gridColumn = String(month.column);
    label.textContent = month.label;
    months.appendChild(label);
  });
  content.appendChild(months);

  const grid = document.createElement("div");
  grid.className = "calendar-heatmap-grid";
  model.cells.forEach((day) => {
    const cell = document.createElement("span");
    cell.className = `calendar-heatmap-cell level-${day.level}`;
    if (day.outside) {
      cell.classList.add("is-outside");
      cell.setAttribute("aria-hidden", "true");
    } else {
      const description = `${day.date} · ${formatNumber(day.totalTokens)} Token`;
      cell.title = description;
      cell.setAttribute("aria-label", description);
      cell.setAttribute("role", "img");
      if (day.date === localDateKey()) cell.classList.add("is-today");
    }
    grid.appendChild(cell);
  });
  content.appendChild(grid);
  shell.appendChild(content);
  els.calendarHeatmap.appendChild(shell);
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
  if (view === "overview") renderCalendarHeatmap(days);
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
  const isUsageView = !isSources && !isForecast;
  const showReset = (view === "overview" && visibleProviderIds.has("codex")) || Boolean(providerMeta[view]?.resetCredits);
  els.forecastView.classList.toggle("is-hidden", !isForecast);
  els.metricGrid.classList.toggle("is-hidden", isForecast);
  els.calendarHeatmapPanel.classList.toggle("is-hidden", view !== "overview");
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

async function loadView(view = currentView) {
  const hiddenProviderView = providerMeta[view] && !visibleProviderIds.has(view);
  const unavailableForecast = view === "forecast" && !forecastAgent;
  currentView = VIEW_CONFIGS[view] && !hiddenProviderView && !unavailableForecast ? view : "overview";
  const config = VIEW_CONFIGS[currentView];
  setActiveTab(currentView);
  setViewVisibility(currentView);

  try {
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
      const failed = (data.results || [])
        .filter((item) => !item.ok)
        .map((item) => {
          const error = String(item.error || item.warning || "");
          if (item.source === "quota:claude" && /claude auth login/i.test(error)) {
            return "quota:claude（需重新登录 Claude Code）";
          }
          return item.source;
        })
        .join(", ");
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

els.viewTabs.addEventListener("click", (event) => {
  const tab = event.target.closest(".view-tab");
  if (!tab) return;
  const view = tab.dataset.view || "overview";
  history.replaceState(null, "", `#${view}`);
  loadView(view);
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
