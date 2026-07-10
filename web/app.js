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
  forecastView: document.querySelector("#forecastView"),
  forecastAgentTabs: [...document.querySelectorAll(".forecast-agent-tab")],
  forecastMetricGrid: document.querySelector("#forecastMetricGrid"),
  forecastRunwayTitle: document.querySelector("#forecastRunwayTitle"),
  forecastPeriodPill: document.querySelector("#forecastPeriodPill"),
  forecastRunway: document.querySelector("#forecastRunway"),
  forecastAdvice: document.querySelector("#forecastAdvice"),
  forecastSourcePill: document.querySelector("#forecastSourcePill"),
  forecastRateList: document.querySelector("#forecastRateList"),
  forecastForm: document.querySelector("#forecastForm"),
  forecastSaveBtn: document.querySelector("#forecastSaveBtn"),
  forecastSubscriptionPlan: document.querySelector("#forecastSubscriptionPlan"),
  forecastAccountSync: document.querySelector("#forecastAccountSync"),
  forecastBudgetTokens: document.querySelector("#forecastBudgetTokens"),
  forecastPeriodEnd: document.querySelector("#forecastPeriodEnd"),
  forecastCycleDays: document.querySelector("#forecastCycleDays"),
  forecastFallbackUsed: document.querySelector("#forecastFallbackUsed"),
  forecastFallbackDaily: document.querySelector("#forecastFallbackDaily"),
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
  forecast: {
    source: "all",
    label: "额度预测",
    exportSource: "everything",
    subtitle: "本地用量速率与周期预算",
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
  cursor: {
    source: "cursor",
    label: "Cursor",
    exportSource: "everything",
    subtitle: "Cursor 本地用量数据",
    trendTitle: "Cursor 使用趋势",
    breakdownTitle: "Cursor Token 构成",
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
let forecastAgent = "codex";
let forecastSettings = null;
let forecastSnapshots = {};
let forecastQuotas = {};

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

const FORECAST_AGENT_META = {
  codex: { label: "Codex" },
  claude: { label: "Claude Code" },
  cursor: { label: "Cursor" },
};

const FORECAST_DEFAULT_PLANS = {
  codex: "ChatGPT Pro 5x",
  claude: "Claude Max 5x",
  cursor: "Cursor",
};

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
    subscriptionPlan: FORECAST_DEFAULT_PLANS[agent] || "",
    accountSyncEnabled: true,
    budgetTokens: null,
    periodEndsOn: null,
    cycleDays: 7,
    fallbackUsedTokens: null,
    fallbackDailyTokens: null,
  };
}

function forecastPlan(agent = forecastAgent) {
  return {
    ...defaultForecastPlan(agent),
    ...(forecastSettings?.agents?.[agent] || {}),
  };
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
  const windows = Array.isArray(snapshot?.windows) ? snapshot.windows : [];
  return windows
    .filter((window) => Number.isFinite(Number(window?.usedPercent)))
    .slice()
    .sort((a, b) => (Number(b.windowDurationMins) || 0) - (Number(a.windowDurationMins) || 0))[0] || null;
}

function accountQuotaSummary(snapshot) {
  const window = longestQuotaWindow(snapshot);
  if (window) {
    const used = clamp(Number(window.usedPercent), 0, 100);
    return {
      type: "percent",
      label: window.label || window.name || "账户窗口",
      used,
      remaining: Math.max(0, 100 - used),
      resetAt: window.resetsAt || null,
      windowDurationMins: Number(window.windowDurationMins) || null,
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

function quotaWindowPoints(quotaData) {
  const observations = Array.isArray(quotaData?.observations) ? quotaData.observations : [];
  const latestObservation = observations.at(-1);
  if (latestObservation) {
    const segment = [latestObservation];
    for (let index = observations.length - 2; index >= 0; index -= 1) {
      const previous = observations[index];
      const current = segment[0];
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
      if (previous.windowName !== latestObservation.windowName || !resetMatches || !quotaMonotonic || !usageMonotonic) break;
      segment.unshift(previous);
    }
    return segment
      .filter((observation) => Number.isFinite(Number(observation.usedPercent)))
      .map((observation) => ({
        day: String(observation.fetchedAt || "").slice(0, 10),
        fetchedAt: observation.fetchedAt,
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
      }))
      .sort((a, b) => String(a.fetchedAt).localeCompare(String(b.fetchedAt)));
  }
  if (!quotaData?.daily?.length) return [];
  const latest = quotaData.latest;
  const latestWindow = longestQuotaWindow(latest);
  if (!latestWindow?.resetsAt) return [];
  const windowName = latestWindow.name;
  const resetAt = latestWindow.resetsAt;
  return quotaData.daily
    .map((snapshot) => ({ snapshot, day: quotaSnapshotDay(snapshot) }))
    .filter((item) => item.day && item.day <= localDateKey())
    .map((item) => ({ ...item, window: (item.snapshot.windows || []).find((window) => window.name === windowName) }))
    .filter((item) => item.window?.resetsAt === resetAt && Number.isFinite(Number(item.window.usedPercent)))
    .sort((a, b) => a.day.localeCompare(b.day));
}

function fitQuotaBurn(days, quotaData, account, dailyTokenRate) {
  if (!account || account.type !== "percent" || !quotaData?.daily?.length || !dailyTokenRate) return null;
  const points = quotaWindowPoints(quotaData);
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
  const account = accountQuotaSummary(quotaData?.latest);
  const rawRate = buildForecastRate(days, plan.fallbackDailyTokens);
  const rawQuotaFit = fitQuotaBurn(days, quotaData, account, rawRate.weightedRate);
  const modelFit = globalThis.ForecastModel?.fitModelWeights(
    days,
    quotaWindowPoints(quotaData).map((point) => ({
      day: point.day,
      fetchedAt: point.fetchedAt,
      usedPercent: Number(point.window.usedPercent),
      totalTokens: point.usageTotalTokens,
      modelTotals: point.modelTotals,
    })),
    rawQuotaFit?.model?.slope
  ) || { active: false, sampleCount: rawQuotaFit?.sampleCount || 0, requiredSamples: 7, reason: "model-module-unavailable", weights: [] };
  const effectiveDays = modelFit.active ? globalThis.ForecastModel.applyModelWeights(days, modelFit) : days;
  const rate = modelFit.active ? buildForecastRate(effectiveDays, plan.fallbackDailyTokens) : rawRate;
  const quotaFit = modelFit.active ? fitQuotaBurn(effectiveDays, quotaData, account, rate.weightedRate) : rawQuotaFit;
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
    modelFit,
    quotaData,
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
  if (sampleCount < requiredSamples) return `模型等效 Token 等待 ${sampleCount} / ${requiredSamples} 个同周期观测点`;
  if (modelFit?.reason === "stable-model-mix") return "模型占比变化不足，暂时无法可靠区分模型权重";
  if (modelFit?.reason === "single-model-mix") return "当前周期只有一个主要模型，不需要模型换算";
  return "模型权重尚未通过稳定性检查，继续使用原始 Token";
}

function renderAccountRunway(forecast) {
  const account = forecast.account;
  const fit = forecast.quotaFit;
  els.forecastRunwayTitle.textContent = `${forecast.meta.label} 官方额度窗口`;
  els.forecastPeriodPill.textContent = account.type === "percent"
    ? `${formatAccountWindow(account.windowDurationMins)} · 重置 ${formatAccountTime(account.resetAt)}`
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
  const cursorBreakdown = forecast.agent === "cursor" ? forecast.quotaData?.latest?.cursorUsageBreakdown : null;
  const cursorDetails = cursorBreakdown
    ? ` · Auto + Composer ${Number(cursorBreakdown.autoPercentUsed || 0).toFixed(0)}% · API ${Number(cursorBreakdown.apiPercentUsed || 0).toFixed(0)}%`
    : "";
  dates.innerHTML = `<span>${escapeHtml(`${account.label}${cursorDetails}`)}</span><span>重置 ${escapeHtml(formatAccountTime(account.resetAt))}</span>`;
  els.forecastRunway.appendChild(dates);

  if (account.type === "percent" && fit?.model) {
    const tokenBasis = forecast.modelFit?.active ? "模型等效 Token" : "原始 Token";
    const segmentText = fit.observationMode ? "当前重置分段" : "同一额度窗口";
    els.forecastAdvice.innerHTML = `<strong>最小二乘拟合已启用。</strong><span>基于${segmentText}内 ${fit.sampleCount} 个观测点，将${tokenBasis}增量拟合为官方额度百分比。${escapeHtml(modelFitStatus(forecast.modelFit))}；预计 ${escapeHtml(formatRunway(forecast.exhaustionDays))} 后耗尽。</span>`;
  } else if (account.type === "percent") {
    const count = fit?.sampleCount || 0;
    const message = forecast.agent === "cursor"
      ? "主进度使用 Cursor 设置页的 Included in Pro 总百分比；Auto + Composer 与 API 单独保留。已收集"
      : "已收集";
    els.forecastAdvice.innerHTML = `<strong>官方额度已同步。</strong><span>${message} ${count} / 3 个当前重置分段观测点；达到 3 个后先启用原始 Token 拟合。额度重置或已用比例回落会自动开启新分段。${escapeHtml(modelFitStatus(forecast.modelFit))}。</span>`;
  } else {
    els.forecastAdvice.innerHTML = `<strong>Cursor 账期已同步。</strong><span>账户计划单位与 token 不是已确认的一对一口径；保留原始已用、剩余和账期，待 Cursor 每日事件数据积累后再启用拟合。</span>`;
  }
}

function renderForecastRunway(forecast) {
  els.forecastRunway.replaceChildren();
  els.forecastAdvice.replaceChildren();
  if (forecast.account) {
    renderAccountRunway(forecast);
    return;
  }
  els.forecastRunwayTitle.textContent = `${forecast.meta.label} 本周期节奏`;
  els.forecastPeriodPill.textContent = forecast.periodStart && forecast.periodEnd
    ? `${formatDateKey(forecast.periodStart)} - ${formatDateKey(forecast.periodEnd)}`
    : "等待周期配置";

  if (forecast.budgetTokens === null || !forecast.periodEnd) {
    els.forecastRunway.appendChild(emptyState("设置计划额度和周期结束日后生成耗尽预测"));
    const advice = document.createElement("div");
    advice.innerHTML = "<strong>预测需要周期基准。</strong><span>本地日志会自动计算已用量；计划额度与结束日需要你按自己的订阅周期填入。</span>";
    els.forecastAdvice.appendChild(advice);
    return;
  }

  const used = forecast.usedTokens || 0;
  const remaining = forecast.remainingTokens || 0;
  const projected = forecast.projectedTokens || used;
  const target = forecast.targetDailyTokens;
  const usedRatio = forecast.budgetTokens > 0 ? clamp(used / forecast.budgetTokens, 0, 1) : 0;
  const projectedRatio = forecast.budgetTokens > 0 ? clamp(projected / forecast.budgetTokens, 0, 1) : 0;
  const isOverBudget = used >= forecast.budgetTokens || projected > forecast.budgetTokens;

  const summary = document.createElement("div");
  summary.className = "runway-summary";
  [
    ["本周期已用", formatCompact(used)],
    ["可用余额", formatCompact(remaining)],
    ["建议日均", target === null ? "--" : formatCompact(target)],
  ].forEach(([label, value]) => appendRunwayStat(summary, label, value));
  els.forecastRunway.appendChild(summary);

  const trackWrap = document.createElement("div");
  trackWrap.className = "runway-track-wrap";
  const marker = document.createElement("div");
  marker.className = "runway-marker is-end";
  marker.style.left = `${projectedRatio * 100}%`;
  marker.innerHTML = `<span class="runway-marker-label">期末预测 ${escapeHtml(formatCompact(projected))}</span>`;
  const track = document.createElement("div");
  track.className = "runway-track";
  const usedSegment = document.createElement("div");
  usedSegment.className = `runway-used${isOverBudget ? " runway-over" : ""}`;
  usedSegment.style.width = `${usedRatio * 100}%`;
  const remainingSegment = document.createElement("div");
  remainingSegment.className = "runway-remaining";
  remainingSegment.style.width = `${Math.max(0, 100 - usedRatio * 100)}%`;
  track.append(usedSegment, remainingSegment);
  trackWrap.append(marker, track);
  els.forecastRunway.appendChild(trackWrap);

  const dates = document.createElement("div");
  dates.className = "runway-dates";
  dates.innerHTML = `<span>起始 ${escapeHtml(formatDateKey(forecast.periodStart))}</span><span>结束 ${escapeHtml(formatDateKey(forecast.periodEnd))}</span>`;
  els.forecastRunway.appendChild(dates);

  const advice = document.createElement("div");
  if (forecast.usedTokens === null) {
    advice.innerHTML = "<strong>没有可用已用量。</strong><span>此周期没有本地快照；可在右侧填写无日志时的已用 Token。</span>";
  } else if (remaining <= 0) {
    advice.innerHTML = "<strong>计划额度已用完。</strong><span>下一周期前建议暂停高 token 工作，或调整计划额度以反映实际可用量。</span>";
  } else if (!forecast.rate.weightedRate) {
    advice.innerHTML = "<strong>尚无法估算耗尽时间。</strong><span>导出本地日志后会计算速率；也可以填写无日志时的日均 Token。</span>";
  } else if (forecast.daysUntilEnd !== null && forecast.exhaustionDays < forecast.daysUntilEnd) {
    advice.innerHTML = `<strong>按当前节奏将提前耗尽。</strong><span>预计 ${escapeHtml(formatRunway(forecast.exhaustionDays))} 后用完，建议把日均控制在 ${escapeHtml(formatCompact(target || 0))} Token 以内。</span>`;
  } else if (forecast.daysUntilEnd !== null) {
    const leftover = Math.max(forecast.budgetTokens - projected, 0);
    advice.innerHTML = `<strong>当前节奏可覆盖本周期。</strong><span>按预测到期末将剩余 ${escapeHtml(formatCompact(leftover))} Token；若希望接近用完，日均目标为 ${escapeHtml(formatCompact(target || 0))} Token。</span>`;
  } else {
    advice.innerHTML = `<strong>预计剩余可用 ${escapeHtml(formatRunway(forecast.exhaustionDays))}。</strong><span>请设置周期结束日，以获得按期末对齐的日均目标。</span>`;
  }
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

function syncForecastForm(agent = forecastAgent) {
  const plan = forecastPlan(agent);
  els.forecastSubscriptionPlan.value = [...els.forecastSubscriptionPlan.options].some(
    (option) => option.value === plan.subscriptionPlan
  )
    ? plan.subscriptionPlan
    : "Custom";
  els.forecastBudgetTokens.value = plan.budgetTokens ?? "";
  els.forecastAccountSync.checked = plan.accountSyncEnabled !== false;
  els.forecastPeriodEnd.value = plan.periodEndsOn ?? "";
  els.forecastCycleDays.value = plan.cycleDays ?? 7;
  els.forecastFallbackUsed.value = plan.fallbackUsedTokens ?? "";
  els.forecastFallbackDaily.value = plan.fallbackDailyTokens ?? "";
}

function renderForecast(agent = forecastAgent) {
  const forecast = buildForecast(agent);
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
      fit?.model ? "拟合耗尽" : "拟合样本",
      fit?.model ? formatRunway(forecast.exhaustionDays) : `${fit?.sampleCount || 0} / 3`,
      fit?.model
        ? `R² ${fit.model.rSquared.toFixed(2)} · ${forecast.modelFit?.active ? "模型等效 Token" : "原始 Token"}`
        : "全局刷新或定时同步会追加观测点"
    );
    els.forecastSourcePill.textContent = forecast.quotaData?.latest
      ? `账户快照 · ${forecast.quotaData.latest.file?.name || "最新"}${forecast.modelFit?.active ? " · 模型校正" : ""}`
      : "未发现账户快照";
    renderForecastRunway(forecast);
    renderForecastRates(forecast);
    return;
  }

  const budgetLabel = forecast.budgetTokens === null ? "--" : formatCompact(forecast.budgetTokens);
  const usageSub = forecast.budgetTokens === null || forecast.usedTokens === null
    ? "等待周期额度与用量"
    : `${formatPercent(forecast.usedTokens / Math.max(forecast.budgetTokens, 1))} 已使用`;
  renderForecastMetric(
    "计划额度",
    budgetLabel,
    forecast.periodEnd
      ? `${forecast.plan.subscriptionPlan || "未设置方案"} · ${forecast.cycleDays} 天，结束 ${formatDateKey(forecast.periodEnd)}`
      : `${forecast.plan.subscriptionPlan || "未设置方案"} · 请填写周期结束日`
  );
  renderForecastMetric("本周期已用", forecast.usedTokens === null ? "--" : formatCompact(forecast.usedTokens), forecast.hasLocalUsage ? "来自本地每日快照" : "使用无日志兜底值");
  renderForecastMetric("综合日均", forecast.rate.weightedRate ? `${formatCompact(forecast.rate.weightedRate)} / 日` : "--", forecast.rate.isFallback ? "手动日均" : "今日、3 日、7 日加权");
  renderForecastMetric("预计耗尽", forecast.exhaustionDays === null ? "--" : formatRunway(forecast.exhaustionDays), forecast.predictedEnd ? `预计 ${formatDateKey(forecast.predictedEnd)}` : usageSub);
  els.forecastSourcePill.textContent = forecast.snapshot?.latestFile
    ? `本地快照 · ${forecast.snapshot.latestFile.name}`
    : forecast.rate.isFallback
      ? "手动兜底数据"
      : "未发现本地快照";
  renderForecastRunway(forecast);
  renderForecastRates(forecast);
}

function setForecastAgent(agent) {
  forecastAgent = FORECAST_AGENT_META[agent] ? agent : "codex";
  els.forecastAgentTabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.forecastAgent === forecastAgent);
  });
  const snapshot = forecastSnapshots[forecastAgent];
  els.sourcePath.textContent = snapshot?.latestFile ? snapshot.latestFile.path : snapshot?.logDir || `usage-logs/${forecastAgent}/daily`;
  syncForecastForm(forecastAgent);
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
    renderMetric("活跃来源", `${sourceCount || activeAgentCount(days)} 个`, "Codex / Claude Code / Cursor 本地数据");
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
    { key: "cursor", label: "Cursor", tone: "cursor" },
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
        <span>${source.quotaSnapshotCount || 0} daily quota files · ${source.quotaObservationCount || 0} reset-segment observations${source.quotaLatest ? ` · ${escapeHtml(source.quotaLatest.file?.name || "latest")}` : ""}</span>
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
  const isUsageView = !isSources && !isForecast;
  const showReset = view === "overview" || view === "codex";
  els.forecastView.classList.toggle("is-hidden", !isForecast);
  els.metricGrid.classList.toggle("is-hidden", isForecast);
  els.sourceCompare.classList.toggle("is-hidden", !(view === "overview" || isSources));
  els.detailGrid.classList.toggle("is-hidden", !isUsageView);
  els.lowerGrid.classList.toggle("is-hidden", !isUsageView);
  els.tablePanel.classList.toggle("is-hidden", !isUsageView);
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

async function fetchQuota(source) {
  const response = await fetch(`/api/quota?source=${encodeURIComponent(source)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchForecastSettings() {
  const response = await fetch("/api/forecast-settings", { cache: "no-store" });
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
  els.sourcePath.textContent = "usage-logs/{codex,claude,cursor,all}/daily";
  els.metricGrid.replaceChildren();
  renderMetric("数据源", `${sources.length} 个`, "Codex / Claude Code / Cursor / All");
  renderMetric("已有快照", `${ready} 个`, "至少导出一次后显示");
  renderMetric("计划任务", "12:00", "默认每天中午导出");
  renderMetric("存储位置", "项目内", "同一天刷新覆盖同名 JSON");
  renderSourceStatus(data);
  setStatus(`已读取 ${sources.length} 个数据源状态`, "ok");
}

async function loadForecastView() {
  setStatus("正在读取预测数据与周期配置...");
  const [settingsPayload, codex, claude, cursor, codexQuota, claudeQuota, cursorQuota] = await Promise.all([
    fetchForecastSettings(),
    fetchUsage("codex"),
    fetchUsage("claude"),
    fetchUsage("cursor"),
    fetchQuota("codex"),
    fetchQuota("claude"),
    fetchQuota("cursor"),
  ]);
  forecastSettings = settingsPayload.settings || { version: 1, agents: {} };
  forecastSnapshots = { codex, claude, cursor };
  forecastQuotas = { codex: codexQuota, claude: claudeQuota, cursor: cursorQuota };
  setForecastAgent(forecastAgent);
  const ready = Object.values(forecastSnapshots).filter((snapshot) => snapshot?.latestFile).length;
  const quotaReady = Object.values(forecastQuotas).filter((quota) => quota?.latest).length;
  setStatus(`已读取 ${ready} 个本地用量来源、${quotaReady} 个账户额度快照`, ready || quotaReady ? "ok" : "loading");
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

    if (currentView === "forecast") {
      await loadForecastView();
      return;
    }

    setStatus(`正在读取 ${config.label} JSON...`);

    if (currentView === "overview") {
      const [all, codex, claude, cursor] = await Promise.all([
        fetchUsage("all"),
        fetchUsage("codex"),
        fetchUsage("claude"),
        fetchUsage("cursor"),
      ]);
      renderUsage(all, "overview", { codex, claude, cursor });
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

async function saveForecastPlan(event) {
  event.preventDefault();
  const currentSettings = forecastSettings || { version: 1, agents: {} };
  const plan = {
    subscriptionPlan: els.forecastSubscriptionPlan.value,
    accountSyncEnabled: els.forecastAccountSync.checked,
    budgetTokens: inputNumberOrNull(els.forecastBudgetTokens.value),
    periodEndsOn: /^\d{4}-\d{2}-\d{2}$/.test(els.forecastPeriodEnd.value) ? els.forecastPeriodEnd.value : null,
    cycleDays: clamp(Math.round(inputNumberOrNull(els.forecastCycleDays.value) || 7), 1, 90),
    fallbackUsedTokens: inputNumberOrNull(els.forecastFallbackUsed.value),
    fallbackDailyTokens: inputNumberOrNull(els.forecastFallbackDaily.value),
  };
  const payload = {
    version: 1,
    agents: {
      ...(currentSettings.agents || {}),
      [forecastAgent]: plan,
    },
  };

  els.forecastSaveBtn.disabled = true;
  setStatus(`正在保存 ${FORECAST_AGENT_META[forecastAgent].label} 周期配置...`);
  try {
    const response = await fetch("/api/forecast-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    forecastSettings = data.settings;
    syncForecastForm(forecastAgent);
    renderForecast(forecastAgent);
    setStatus(`已保存 ${FORECAST_AGENT_META[forecastAgent].label} 周期配置`, "ok");
  } catch (error) {
    setStatus(`周期配置保存失败：${error.message}`, "error");
  } finally {
    els.forecastSaveBtn.disabled = false;
  }
}

els.viewTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const view = tab.dataset.view || "overview";
    history.replaceState(null, "", `#${view}`);
    loadView(view);
  });
});

els.forecastAgentTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setForecastAgent(tab.dataset.forecastAgent || "codex");
  });
});

els.forecastForm.addEventListener("submit", saveForecastPlan);

els.refreshBtn.addEventListener("click", () => exportAndRefresh("everything"));
els.exportBtn.addEventListener("click", () => exportAndRefresh("everything"));

const initialView = location.hash.replace("#", "") || "overview";
loadView(initialView);
loadResetCredits();
