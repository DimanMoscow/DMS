// Bounded, PII-free operation metrics for stabilization profiling.
const DMS_OPERATION_METRICS = {
  VERSION: 1,
  PROPERTY_PREFIX: 'DMS_OP_METRIC_V1_',
  OPERATIONS: {
    calendar_sync_scheduled: true,
    calendar_sync_inline: true,
    morning_digest: true,
    evening_queue: true,
    automatic_backup: true,
    watchdog: true,
    telegram_secure_mutation: true,
    miniapp_queue_decision: true,
    miniapp_confirm_day: true
  },
  DURATIONS: {
    lockWaitMs: true,
    sheetsReadMs: true,
    sheetsWriteMs: true,
    calendarMs: true,
    telegramMs: true,
    reconciliationMs: true,
    calendarSyncMs: true,
    healthCheckMs: true,
    driveMs: true
  },
  COUNTS: {
    rowsRead: true,
    rowsWritten: true,
    eventsRead: true,
    eventsWritten: true,
    retryCount: true
  },
  MAX_DURATION_MS: 21600000,
  MAX_COUNT: 10000000
};

function beginDmsOperationMetrics_(operation) {
  const name = String(operation || '');
  if (!DMS_OPERATION_METRICS.OPERATIONS[name]) {
    throw new Error('Unsupported operation metric.');
  }
  return {
    version: DMS_OPERATION_METRICS.VERSION,
    operation: name,
    startedAtMs: Date.now(),
    durations: {
      lockWaitMs: 0,
      sheetsReadMs: 0,
      sheetsWriteMs: 0,
      calendarMs: 0,
      telegramMs: 0,
      reconciliationMs: 0,
      calendarSyncMs: 0,
      healthCheckMs: 0,
      driveMs: 0
    },
    counts: {
      rowsRead: 0,
      rowsWritten: 0,
      eventsRead: 0,
      eventsWritten: 0,
      retryCount: 0
    }
  };
}

function measureDmsOperationPhase_(metrics, field, work) {
  if (!metrics || !DMS_OPERATION_METRICS.DURATIONS[field] || typeof work !== 'function') {
    throw new Error('Invalid operation metric phase.');
  }
  const startedAt = Date.now();
  try {
    return work();
  } finally {
    addDmsOperationDuration_(metrics, field, Date.now() - startedAt);
  }
}

function addDmsOperationDuration_(metrics, field, durationMs) {
  if (!metrics || !DMS_OPERATION_METRICS.DURATIONS[field]) {
    throw new Error('Invalid operation metric duration.');
  }
  const value = Math.max(0, Math.min(
    DMS_OPERATION_METRICS.MAX_DURATION_MS,
    Math.round(Number(durationMs) || 0)
  ));
  metrics.durations[field] = Math.min(
    DMS_OPERATION_METRICS.MAX_DURATION_MS,
    Number(metrics.durations[field] || 0) + value
  );
}

function addDmsOperationCount_(metrics, field, count) {
  if (!metrics || !DMS_OPERATION_METRICS.COUNTS[field]) {
    throw new Error('Invalid operation metric count.');
  }
  const value = Math.max(0, Math.min(
    DMS_OPERATION_METRICS.MAX_COUNT,
    Math.floor(Number(count) || 0)
  ));
  metrics.counts[field] = Math.min(
    DMS_OPERATION_METRICS.MAX_COUNT,
    Number(metrics.counts[field] || 0) + value
  );
}

function finishDmsOperationMetrics_(metrics, outcome, error) {
  if (!metrics || !DMS_OPERATION_METRICS.OPERATIONS[metrics.operation]) {
    throw new Error('Invalid operation metrics record.');
  }
  const finishedAtMs = Date.now();
  const result = {
    version: DMS_OPERATION_METRICS.VERSION,
    operation: metrics.operation,
    startedAt: new Date(metrics.startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    outcome: outcome === 'success' || outcome === 'partial' ? outcome : 'failed',
    totalMs: Math.max(0, Math.min(
      DMS_OPERATION_METRICS.MAX_DURATION_MS,
      finishedAtMs - metrics.startedAtMs
    )),
    lockWaitMs: metrics.durations.lockWaitMs,
    sheetsReadMs: metrics.durations.sheetsReadMs,
    sheetsWriteMs: metrics.durations.sheetsWriteMs,
    calendarMs: metrics.durations.calendarMs,
    telegramMs: metrics.durations.telegramMs,
    reconciliationMs: metrics.durations.reconciliationMs,
    calendarSyncMs: metrics.durations.calendarSyncMs,
    healthCheckMs: metrics.durations.healthCheckMs,
    driveMs: metrics.durations.driveMs,
    rowsRead: metrics.counts.rowsRead,
    rowsWritten: metrics.counts.rowsWritten,
    eventsRead: metrics.counts.eventsRead,
    eventsWritten: metrics.counts.eventsWritten,
    retryCount: metrics.counts.retryCount,
    errorClass: error ? classifyDmsOperationMetricError_(error) : null
  };
  const property = DMS_OPERATION_METRICS.PROPERTY_PREFIX +
    metrics.operation.toUpperCase();
  PropertiesService.getScriptProperties().setProperty(property, JSON.stringify(result));
  console.log(JSON.stringify({event: 'dms_operation_metric', metric: result}));
  return result;
}

var DMS_ACTIVE_OPERATION_METRICS = null;

function withDmsOperationMetrics_(metrics, work) {
  if (!metrics || typeof work !== 'function') {
    throw new Error('Invalid operation metric scope.');
  }
  const previous = DMS_ACTIVE_OPERATION_METRICS;
  DMS_ACTIVE_OPERATION_METRICS = metrics;
  try {
    return work();
  } finally {
    DMS_ACTIVE_OPERATION_METRICS = previous;
  }
}

function measureActiveDmsOperationPhase_(field, work) {
  return DMS_ACTIVE_OPERATION_METRICS
    ? measureDmsOperationPhase_(DMS_ACTIVE_OPERATION_METRICS, field, work)
    : work();
}

function finishDmsOperationMetricsSafely_(metrics, outcome, error) {
  try {
    return finishDmsOperationMetrics_(metrics, outcome, error);
  } catch (metricsError) {
    // Telemetry must never change the business-operation outcome. Do not log
    // the thrown message because service errors may contain identifiers.
    console.error(JSON.stringify({
      event: 'dms_operation_metric_failure',
      operation: metrics && DMS_OPERATION_METRICS.OPERATIONS[metrics.operation]
        ? metrics.operation
        : 'invalid',
      errorClass: classifyDmsOperationMetricError_(metricsError)
    }));
    return null;
  }
}

function classifyDmsOperationMetricError_(error) {
  const value = (
    String(error && error.name || '') + ' ' +
    String(error && error.message || error || '')
  ).toLowerCase();
  if (/lock|busy|выполня/.test(value)) return 'contention';
  if (/timeout|timed out|deadline/.test(value)) return 'timeout';
  if (/quota|rate limit|too many/.test(value)) return 'quota';
  if (/auth|permission|forbidden|unauthorized/.test(value)) return 'authorization';
  if (/validation|invalid|некоррект|не указан/.test(value)) return 'validation';
  return 'runtime_error';
}

function getDmsOperationMetric_(operation) {
  const name = String(operation || '');
  if (!DMS_OPERATION_METRICS.OPERATIONS[name]) return null;
  const raw = PropertiesService.getScriptProperties().getProperty(
    DMS_OPERATION_METRICS.PROPERTY_PREFIX + name.toUpperCase()
  );
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && value.version === DMS_OPERATION_METRICS.VERSION &&
      value.operation === name ? value : null;
  } catch (ignore) {
    return null;
  }
}
