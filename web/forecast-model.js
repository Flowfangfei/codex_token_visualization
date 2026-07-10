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

  return { OTHER_MODEL, dayModelTokens, fitModelWeights, equivalentTokensForDay, applyModelWeights };
});
