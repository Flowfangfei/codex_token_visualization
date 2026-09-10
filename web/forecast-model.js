(function attachForecastModel(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ForecastModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createForecastModel() {
  "use strict";

  const TOKEN_SCALE = 1_000_000;
  const OTHER_MODEL = "other-models";

  function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function usageTotal(usage) {
    const explicit = numberOrZero(usage?.totalTokens);
    if (explicit) return explicit;
    return (
      numberOrZero(usage?.inputTokens) +
      numberOrZero(usage?.outputTokens) +
      numberOrZero(usage?.cacheReadTokens ?? usage?.cachedInputTokens) +
      numberOrZero(usage?.cacheCreationTokens)
    );
  }

  function dayKey(day) {
    return String(day?.date ?? day?.period ?? "").slice(0, 10);
  }

  function dayModelTokens(day) {
    const totals = new Map();
    if (day?.models && typeof day.models === "object" && !Array.isArray(day.models)) {
      Object.entries(day.models).forEach(([name, usage]) => {
        totals.set(name, (totals.get(name) || 0) + usageTotal(usage));
      });
    }
    if (Array.isArray(day?.modelBreakdowns)) {
      day.modelBreakdowns.forEach((usage) => {
        const name = String(usage?.modelName ?? usage?.name ?? "unknown-model");
        totals.set(name, (totals.get(name) || 0) + usageTotal(usage));
      });
    }

    const reportedTotal = numberOrZero(day?.totalTokens);
    const modeledTotal = [...totals.values()].reduce((sum, value) => sum + value, 0);
    if (!totals.size) {
      if (reportedTotal) totals.set(OTHER_MODEL, reportedTotal);
    } else if (reportedTotal > modeledTotal) {
      totals.set(OTHER_MODEL, (totals.get(OTHER_MODEL) || 0) + reportedTotal - modeledTotal);
    }
    return totals;
  }

  function solveLinearSystem(matrix, vector) {
    const size = vector.length;
    const augmented = matrix.map((row, index) => [...row, vector[index]]);
    for (let column = 0; column < size; column += 1) {
      let pivot = column;
      for (let row = column + 1; row < size; row += 1) {
        if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
      }
      if (Math.abs(augmented[pivot][column]) < 1e-10) return null;
      [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
      const divisor = augmented[column][column];
      for (let index = column; index <= size; index += 1) augmented[column][index] /= divisor;
      for (let row = 0; row < size; row += 1) {
        if (row === column) continue;
        const factor = augmented[row][column];
        for (let index = column; index <= size; index += 1) {
          augmented[row][index] -= factor * augmented[column][index];
        }
      }
    }
    return augmented.map((row) => row[size]);
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
    return { slope, intercept, rSquared: totalVariance > 0 ? 1 - residualVariance / totalVariance : 1 };
  }

  function featureVectorFromModels(models, primaryModels) {
    const values = primaryModels.map((name) => models.get(name) || 0);
    const primarySet = new Set(primaryModels);
    values.push(
      [...models.entries()].reduce((sum, [name, value]) => sum + (primarySet.has(name) ? 0 : value), 0)
    );
    return values;
  }

  function featureVector(day, primaryModels) {
    return featureVectorFromModels(dayModelTokens(day), primaryModels);
  }

  function objectModelTokens(value) {
    return new Map(
      Object.entries(value || {})
        .map(([name, tokens]) => [name, numberOrZero(tokens)])
        .filter(([, tokens]) => tokens > 0)
    );
  }

  function subtractModelTotals(current, baseline) {
    const names = new Set([...current.keys(), ...baseline.keys()]);
    return new Map([...names].map((name) => [name, Math.max(0, (current.get(name) || 0) - (baseline.get(name) || 0))]));
  }

  function fitModelWeights(days, quotaPoints, rawSlope, options = {}) {
    const maxFeatures = Math.max(2, Math.min(4, Number(options.maxFeatures) || 3));
    const minimumSnapshots = Math.max(7, Number(options.minimumSnapshots) || 7);
    const points = [...(quotaPoints || [])]
      .filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(point?.day || "") && Number.isFinite(Number(point?.usedPercent)))
      .sort((a, b) => String(a.fetchedAt || a.day).localeCompare(String(b.fetchedAt || b.day)));
    const base = {
      active: false,
      sampleCount: points.length,
      requiredSamples: minimumSnapshots,
      reason: "insufficient-snapshots",
      weights: [],
    };
    if (points.length < minimumSnapshots) return base;
    if (!Number.isFinite(rawSlope) || rawSlope <= 0) return { ...base, reason: "raw-fit-unavailable" };

    const observationMode = points.every(
      (point) => point?.modelTotals && typeof point.modelTotals === "object" && Number.isFinite(Number(point.totalTokens))
    );
    const firstDay = points[0].day;
    const lastDay = points.at(-1).day;
    const periodDays = observationMode
      ? []
      : (days || []).filter((day) => {
          const key = dayKey(day);
          return key >= firstDay && key <= lastDay;
        });
    const modelTotals = new Map();
    if (observationMode) {
      const baseline = objectModelTokens(points[0].modelTotals);
      subtractModelTotals(objectModelTokens(points.at(-1).modelTotals), baseline).forEach((value, name) => {
        modelTotals.set(name, value);
      });
    } else {
      periodDays.forEach((day) => {
        dayModelTokens(day).forEach((value, name) => modelTotals.set(name, (modelTotals.get(name) || 0) + value));
      });
    }
    const grandTotal = [...modelTotals.values()].reduce((sum, value) => sum + value, 0);
    const ranked = [...modelTotals.entries()]
      .filter(([, value]) => grandTotal > 0 && value / grandTotal >= 0.02)
      .sort((a, b) => b[1] - a[1]);
    if (ranked.length < 2) return { ...base, reason: "single-model-mix" };

    const primaryModels = ranked.slice(0, maxFeatures - 1).map(([name]) => name);
    const featureNames = [...primaryModels, OTHER_MODEL];
    const requiredSamples = Math.max(minimumSnapshots, featureNames.length + 3);
    if (points.length < requiredSamples) return { ...base, requiredSamples, reason: "insufficient-snapshots" };

    const intervalVectors = observationMode
      ? points.slice(1).map((point, index) => {
          const previous = objectModelTokens(points[index].modelTotals);
          const current = objectModelTokens(point.modelTotals);
          return featureVectorFromModels(subtractModelTotals(current, previous), primaryModels);
        })
      : periodDays.map((day) => featureVector(day, primaryModels));
    const dailyShares = intervalVectors
      .filter((values) => values.reduce((sum, value) => sum + value, 0) > 0)
      .map((values) => {
        const total = values.reduce((sum, value) => sum + value, 0);
        return values.map((value) => value / total);
      });
    const hasMixVariation = featureNames.some((_, index) => {
      const values = dailyShares.map((shares) => shares[index]);
      return values.length && Math.max(...values) - Math.min(...values) >= 0.08;
    });
    if (!hasMixVariation) return { ...base, requiredSamples, reason: "stable-model-mix" };

    const observationBaseline = observationMode ? objectModelTokens(points[0].modelTotals) : null;
    const cumulativeRows = points.map((point) => {
      if (observationMode) {
        const delta = subtractModelTotals(objectModelTokens(point.modelTotals), observationBaseline);
        return {
          x: featureVectorFromModels(delta, primaryModels).map((value) => value / TOKEN_SCALE),
          y: Number(point.usedPercent),
        };
      }
      const totals = Array(featureNames.length).fill(0);
      periodDays.forEach((day) => {
        const key = dayKey(day);
        if (key > point.day) return;
        featureVector(day, primaryModels).forEach((value, index) => {
          totals[index] += value / TOKEN_SCALE;
        });
      });
      return { x: totals, y: Number(point.usedPercent) };
    });
    const scales = featureNames.map((_, index) => Math.max(...cumulativeRows.map((row) => row.x[index]), 1));
    const normalizedRows = cumulativeRows.map((row) => ({
      x: row.x.map((value, index) => value / scales[index]),
      y: row.y,
    }));
    const priorPerMillion = rawSlope * TOKEN_SCALE;
    const lambda = Math.max(0.01, Number(options.lambda) || 0.05);
    const size = featureNames.length + 1;
    const matrix = Array.from({ length: size }, () => Array(size).fill(0));
    const vector = Array(size).fill(0);
    normalizedRows.forEach((row) => {
      const values = [1, ...row.x];
      values.forEach((left, leftIndex) => {
        vector[leftIndex] += left * row.y;
        values.forEach((right, rightIndex) => {
          matrix[leftIndex][rightIndex] += left * right;
        });
      });
    });
    featureNames.forEach((_, index) => {
      const coefficientIndex = index + 1;
      matrix[coefficientIndex][coefficientIndex] += lambda;
      vector[coefficientIndex] += lambda * priorPerMillion * scales[index];
    });
    const coefficients = solveLinearSystem(matrix, vector);
    if (!coefficients) return { ...base, requiredSamples, reason: "ill-conditioned" };

    const weights = featureNames.map((name, index) => {
      const perMillion = coefficients[index + 1] / scales[index];
      return { name, weight: Math.min(4, Math.max(0.25, perMillion / priorPerMillion)) };
    });
    const weightMap = Object.fromEntries(weights.map((item) => [item.name, item.weight]));
    const equivalentPoints = cumulativeRows.map((row) => ({
      x: row.x.reduce((sum, value, index) => sum + value * TOKEN_SCALE * weights[index].weight, 0),
      y: row.y,
    }));
    const equivalentFit = leastSquares(equivalentPoints);
    if (!equivalentFit || equivalentFit.slope <= 0) {
      return { ...base, requiredSamples, reason: "invalid-weighted-fit" };
    }
    const rawPoints = cumulativeRows.map((row) => ({
      x: row.x.reduce((sum, value) => sum + value * TOKEN_SCALE, 0),
      y: row.y,
    }));
    const rawFit = leastSquares(rawPoints);
    if (rawFit && equivalentFit.rSquared + 0.03 < rawFit.rSquared) {
      return { ...base, requiredSamples, reason: "weighted-fit-worse" };
    }
    return {
      active: true,
      sampleCount: points.length,
      requiredSamples,
      reason: null,
      weights,
      weightMap,
      primaryModels,
      observationMode,
      rSquared: equivalentFit.rSquared,
      rawRSquared: rawFit?.rSquared ?? null,
    };
  }

  function equivalentTokensForDay(day, modelFit) {
    if (!modelFit?.active) return numberOrZero(day?.totalTokens);
    const models = dayModelTokens(day);
    const primarySet = new Set(modelFit.primaryModels || []);
    const otherWeight = Number(modelFit.weightMap?.[OTHER_MODEL]) || 1;
    return [...models.entries()].reduce((sum, [name, value]) => {
      const weight = primarySet.has(name) ? Number(modelFit.weightMap?.[name]) || 1 : otherWeight;
      return sum + value * weight;
    }, 0);
  }

  function applyModelWeights(days, modelFit) {
    if (!modelFit?.active) return days || [];
    return (days || []).map((day) => ({
      ...day,
      rawTotalTokens: numberOrZero(day?.totalTokens),
      totalTokens: equivalentTokensForDay(day, modelFit),
    }));
  }

  function buildSegmentIntervals(segments) {
    const intervals = [];
    (segments || []).forEach((segment, segmentIndex) => {
      const points = [...(segment || [])]
        .filter(
          (point) =>
            Number.isFinite(Number(point?.usedPercent)) &&
            Number.isFinite(Number(point?.totalTokens))
        )
        .sort((a, b) => String(a.fetchedAt || "").localeCompare(String(b.fetchedAt || "")));
      if (points.length < 2) return;
      let anchor = points[0];
      for (let index = 1; index < points.length; index += 1) {
        const current = points[index];
        const deltaPercent = Number(current.usedPercent) - Number(anchor.usedPercent);
        if (deltaPercent < 0.05) continue;
        const deltaTokens = Number(current.totalTokens) - Number(anchor.totalTokens);
        if (deltaTokens <= 0) {
          anchor = current;
          continue;
        }
        const modelDeltas = Object.fromEntries(
          subtractModelTotals(objectModelTokens(current.modelTotals), objectModelTokens(anchor.modelTotals))
        );
        intervals.push({
          segmentIndex,
          startedAt: anchor.fetchedAt || null,
          endedAt: current.fetchedAt || null,
          deltaPercent,
          deltaTokens,
          modelDeltas,
        });
        anchor = current;
      }
    });
    return intervals;
  }

  function recencyWeight(endedAt, referenceTime, halfLifeDays) {
    const ended = new Date(endedAt || referenceTime).getTime();
    const reference = new Date(referenceTime).getTime();
    if (!Number.isFinite(ended) || !Number.isFinite(reference)) return 1;
    const ageDays = Math.max(0, (reference - ended) / 86400000);
    return Math.pow(0.5, ageDays / halfLifeDays);
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function weightedOriginFit(intervals, options = {}) {
    const valid = (intervals || []).filter(
      (interval) => Number(interval?.deltaTokens) > 0 && Number(interval?.deltaPercent) > 0
    );
    if (valid.length < 2) return null;
    const referenceTime =
      options.referenceTime || valid.map((interval) => interval.endedAt).filter(Boolean).sort().at(-1) || new Date().toISOString();
    const halfLifeDays = Math.max(7, Number(options.halfLifeDays) || 28);
    const recencyWeights = valid.map((interval) => recencyWeight(interval.endedAt, referenceTime, halfLifeDays));
    const slopeForWeights = (weights) => {
      const numerator = valid.reduce(
        (sum, interval, index) => sum + weights[index] * Number(interval.deltaTokens) * Number(interval.deltaPercent),
        0
      );
      const denominator = valid.reduce(
        (sum, interval, index) => sum + weights[index] * Number(interval.deltaTokens) ** 2,
        0
      );
      return denominator > 0 ? numerator / denominator : null;
    };
    const initialSlope = slopeForWeights(recencyWeights);
    if (!Number.isFinite(initialSlope) || initialSlope <= 0) return null;
    const residuals = valid.map(
      (interval) => Number(interval.deltaPercent) - initialSlope * Number(interval.deltaTokens)
    );
    const residualMedian = median(residuals);
    const scale = Math.max(1e-6, 1.4826 * median(residuals.map((value) => Math.abs(value - residualMedian))));
    const robustWeights = residuals.map((residual, index) => {
      const distance = Math.abs(residual - residualMedian);
      const huber = distance <= 1.5 * scale ? 1 : (1.5 * scale) / distance;
      return recencyWeights[index] * huber;
    });
    const slope = slopeForWeights(robustWeights);
    if (!Number.isFinite(slope) || slope <= 0) return null;
    const weightTotal = robustWeights.reduce((sum, value) => sum + value, 0);
    const meanY = valid.reduce(
      (sum, interval, index) => sum + robustWeights[index] * Number(interval.deltaPercent),
      0
    ) / weightTotal;
    const residualVariance = valid.reduce((sum, interval, index) => {
      const residual = Number(interval.deltaPercent) - slope * Number(interval.deltaTokens);
      return sum + robustWeights[index] * residual ** 2;
    }, 0);
    const totalVariance = valid.reduce((sum, interval, index) => {
      const centered = Number(interval.deltaPercent) - meanY;
      return sum + robustWeights[index] * centered ** 2;
    }, 0);
    return {
      slope,
      intercept: 0,
      rSquared: totalVariance > 0 ? 1 - residualVariance / totalVariance : 1,
      sampleCount: valid.length,
      effectiveSampleWeight: weightTotal,
      halfLifeDays,
    };
  }

  function fitSegmentedQuota(intervals, options = {}) {
    const valid = (intervals || []).filter(
      (interval) => Number(interval?.deltaTokens) > 0 && Number(interval?.deltaPercent) > 0
    );
    const segmentCount = new Set(valid.map((interval) => interval.segmentIndex)).size;
    const model = weightedOriginFit(valid, options);
    return {
      intervalCount: valid.length,
      requiredIntervals: 2,
      segmentCount,
      model,
    };
  }

  function recentModelNames(days) {
    const totals = new Map();
    for (const day of days || []) {
      const models = dayModelTokens(day);
      const total = [...models.values()].reduce((sum, value) => sum + value, 0);
      for (const [name, value] of models) {
        if (total > 0 && value / total >= 0.05) totals.set(name, (totals.get(name) || 0) + value);
      }
    }
    return [...totals].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }

  // A new model must earn its own quota calibration, not inherit the pooled "other" weight.
  // These coverage thresholds are safeguards, not statistical confidence guarantees.
  function assessModelCalibration(intervals, recentDays, modelFit) {
    const names = recentModelNames(recentDays);
    const valid = (intervals || []).filter((entry) => entry.deltaTokens > 0 && entry.deltaPercent > 0);
    const support = Object.fromEntries(names.map((name) => [name, valid.filter((entry) =>
      (Number(entry.modelDeltas?.[name]) || 0) / entry.deltaTokens >= 0.05).length]));
    const unsupportedModels = names.filter((name) => name === OTHER_MODEL || support[name] < 3);
    const base = { ready: false, support, requiredIntervals: 3, unsupportedModels };
    if (!names.length || unsupportedModels.length) return { ...base, reason: "model-calibrating" };
    if (modelFit?.active) {
      const unweighted = names.filter((name) => !modelFit.primaryModels?.includes(name)
        || !(Number.isFinite(modelFit.weightMap?.[name]) && modelFit.weightMap[name] > 0));
      if (unweighted.length) return { ...base, unsupportedModels: unweighted, reason: "model-calibrating" };
      const weighted = applyModelWeightsToIntervals(valid, modelFit);
      const slope = weightedOriginFit(weighted)?.slope;
      const unstable = names.filter((name) => {
        const recent = weighted.filter((entry) => (Number(entry.modelDeltas?.[name]) || 0)
          / entry.rawDeltaTokens >= 0.05).sort((a, b) => String(a.endedAt).localeCompare(String(b.endedAt))).slice(-3);
        const observed = recent.reduce((sum, entry) => sum + entry.deltaPercent, 0);
        const predicted = recent.reduce((sum, entry) => sum + entry.deltaTokens * slope, 0);
        return !(predicted > 0) || observed / predicted < 0.5 || observed / predicted > 2;
      });
      return unstable.length ? { ...base, unsupportedModels: unstable, reason: "model-fit-unstable" }
        : { ...base, ready: true, reason: null };
    }
    // A scalar Token fit is only transferable while the model mix stays similar.
    const totals = new Map();
    const reference = valid.map((entry) => entry.endedAt).filter(Boolean).sort().at(-1);
    valid.forEach((entry) => objectModelTokens(entry.modelDeltas).forEach((value, name) => {
      totals.set(name, (totals.get(name) || 0) + value * recencyWeight(entry.endedAt, reference, 28));
    }));
    const grandTotal = [...totals.values()].reduce((sum, value) => sum + value, 0);
    const changed = (recentDays || []).some((day) => {
      const models = dayModelTokens(day);
      const total = [...models.values()].reduce((sum, value) => sum + value, 0);
      if (!total) return false;
      const union = new Set([...totals.keys(), ...models.keys()]);
      const distance = [...union].reduce((sum, name) => sum
        + Math.abs((models.get(name) || 0) / total - (totals.get(name) || 0) / grandTotal), 0);
      return distance > 0.3;
    });
    return changed ? { ...base, reason: "model-mix-changed" } : { ...base, ready: true, reason: null };
  }

  function applyModelWeightsToIntervals(intervals, modelFit) {
    if (!modelFit?.active) return intervals || [];
    const primarySet = new Set(modelFit.primaryModels || []);
    const otherWeight = Number(modelFit.weightMap?.[OTHER_MODEL]) || 1;
    return (intervals || []).map((interval) => {
      const models = objectModelTokens(interval.modelDeltas);
      const weightedTokens = [...models.entries()].reduce((sum, [name, value]) => {
        const weight = primarySet.has(name) ? Number(modelFit.weightMap?.[name]) || 1 : otherWeight;
        return sum + value * weight;
      }, 0);
      return {
        ...interval,
        rawDeltaTokens: Number(interval.deltaTokens) || 0,
        deltaTokens: weightedTokens > 0 ? weightedTokens : Number(interval.deltaTokens) || 0,
      };
    });
  }

  function fitModelWeightsFromIntervals(intervals, rawSlope, options = {}) {
    const minimumIntervals = Math.max(7, Number(options.minimumIntervals) || 7);
    const maxFeatures = Math.max(2, Math.min(4, Number(options.maxFeatures) || 3));
    const valid = (intervals || []).filter(
      (interval) =>
        Number(interval?.deltaTokens) > 0 &&
        Number(interval?.deltaPercent) > 0 &&
        interval?.modelDeltas &&
        typeof interval.modelDeltas === "object"
    );
    const base = {
      active: false,
      intervalMode: true,
      sampleCount: valid.length,
      requiredSamples: minimumIntervals,
      reason: "insufficient-snapshots",
      weights: [],
    };
    if (valid.length < minimumIntervals) return base;
    if (!Number.isFinite(rawSlope) || rawSlope <= 0) return { ...base, reason: "raw-fit-unavailable" };

    const modelTotals = new Map();
    valid.forEach((interval) => {
      objectModelTokens(interval.modelDeltas).forEach((value, name) => {
        modelTotals.set(name, (modelTotals.get(name) || 0) + value);
      });
    });
    const grandTotal = [...modelTotals.values()].reduce((sum, value) => sum + value, 0);
    const priorities = options.priorityModels || [];
    const ranked = [...modelTotals.entries()]
      .filter(([name, value]) => grandTotal > 0 && (value / grandTotal >= 0.02 || priorities.includes(name)))
      .sort((a, b) => b[1] - a[1]);
    if (ranked.length < 2) return { ...base, reason: "single-model-mix" };
    const primaryModels = [...new Set([...priorities.filter((name) => modelTotals.has(name) && name !== OTHER_MODEL),
      ...ranked.map(([name]) => name).filter((name) => name !== OTHER_MODEL)])].slice(0, maxFeatures - 1);
    const featureNames = [...primaryModels, OTHER_MODEL];
    const requiredSamples = Math.max(minimumIntervals, featureNames.length + 3);
    if (valid.length < requiredSamples) return { ...base, requiredSamples, reason: "insufficient-snapshots" };

    const featureRows = valid.map((interval) => ({
      x: featureVectorFromModels(objectModelTokens(interval.modelDeltas), primaryModels).map(
        (value) => value / TOKEN_SCALE
      ),
      y: Number(interval.deltaPercent),
      endedAt: interval.endedAt,
    }));
    const shares = featureRows.map((row) => {
      const total = row.x.reduce((sum, value) => sum + value, 0);
      return total > 0 ? row.x.map((value) => value / total) : row.x;
    });
    const hasMixVariation = featureNames.some((_, index) => {
      const values = shares.map((row) => row[index]);
      return Math.max(...values) - Math.min(...values) >= 0.08;
    });
    if (!hasMixVariation) return { ...base, requiredSamples, reason: "stable-model-mix" };

    const referenceTime = featureRows.map((row) => row.endedAt).filter(Boolean).sort().at(-1) || new Date().toISOString();
    const halfLifeDays = Math.max(7, Number(options.halfLifeDays) || 28);
    const rowWeights = featureRows.map((row) => recencyWeight(row.endedAt, referenceTime, halfLifeDays));
    const scales = featureNames.map((_, index) => Math.max(...featureRows.map((row) => row.x[index]), 1));
    const normalizedRows = featureRows.map((row) => ({
      x: row.x.map((value, index) => value / scales[index]),
      y: row.y,
    }));
    const priorPerMillion = rawSlope * TOKEN_SCALE;
    const lambda = Math.max(0.01, Number(options.lambda) || 0.05);
    const matrix = Array.from({ length: featureNames.length }, () => Array(featureNames.length).fill(0));
    const vector = Array(featureNames.length).fill(0);
    normalizedRows.forEach((row, rowIndex) => {
      row.x.forEach((left, leftIndex) => {
        vector[leftIndex] += rowWeights[rowIndex] * left * row.y;
        row.x.forEach((right, rightIndex) => {
          matrix[leftIndex][rightIndex] += rowWeights[rowIndex] * left * right;
        });
      });
    });
    featureNames.forEach((_, index) => {
      matrix[index][index] += lambda;
      vector[index] += lambda * priorPerMillion * scales[index];
    });
    const coefficients = solveLinearSystem(matrix, vector);
    if (!coefficients) return { ...base, requiredSamples, reason: "ill-conditioned" };
    const weights = featureNames.map((name, index) => {
      const perMillion = coefficients[index] / scales[index];
      return { name, weight: perMillion / priorPerMillion };
    });
    if (weights.some((item) => !Number.isFinite(item.weight) || item.weight <= 0)) {
      return { ...base, requiredSamples, reason: "nonpositive-weight" };
    }
    const weightMap = Object.fromEntries(weights.map((item) => [item.name, item.weight]));
    const candidate = {
      active: true,
      intervalMode: true,
      sampleCount: valid.length,
      requiredSamples,
      reason: null,
      weights,
      weightMap,
      primaryModels,
      halfLifeDays,
    };
    const weightedFit = weightedOriginFit(applyModelWeightsToIntervals(valid, candidate), {
      referenceTime,
      halfLifeDays,
    });
    const rawFit = weightedOriginFit(valid, { referenceTime, halfLifeDays });
    if (!weightedFit || (rawFit && weightedFit.rSquared + 0.03 < rawFit.rSquared)) {
      return { ...base, requiredSamples, reason: "weighted-fit-worse" };
    }
    return {
      ...candidate,
      rSquared: weightedFit.rSquared,
      rawRSquared: rawFit?.rSquared ?? null,
    };
  }

  return {
    OTHER_MODEL,
    dayModelTokens,
    fitModelWeights,
    equivalentTokensForDay,
    applyModelWeights,
    buildSegmentIntervals,
    fitSegmentedQuota,
    recentModelNames,
    assessModelCalibration,
    fitModelWeightsFromIntervals,
    applyModelWeightsToIntervals,
  };
});
