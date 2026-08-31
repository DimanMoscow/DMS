// DMS Fitness read-only client portal candidate v41.
const DMS_CLIENT_PORTAL = {
  RELEASE: 'v41-client-portal-readonly',
  ACCESS_SHEET: 'Доступ клиентов',
  ACCESS_HEADERS: [
    'Binding ID', 'Telegram User ID', 'Client ID', 'Status', 'Created At', 'Updated At'
  ],
  ACCESS_FIRST_ROW: 2,
  ACCESS_COLUMNS: 6,
  ACTIVE_STATUS: 'active',
  CLIENTS_SHEET: 'Клиенты',
  CLIENT_FIRST_ROW: 5,
  CLIENT_COLUMNS: 14,
  MEASUREMENTS_SHEET: 'Замеры',
  MEASUREMENT_HEADERS: [
    'Measurement ID', 'Client ID', 'Measured At', 'Weight Kg', 'Chest Cm',
    'Waist Cm', 'Hips Cm', 'Upper Arm Cm', 'Thigh Cm'
  ],
  MEASUREMENT_FIRST_ROW: 2,
  MEASUREMENT_COLUMNS: 9,
  METRICS: [
    {key: 'weightKg', column: 3, min: 20, max: 400},
    {key: 'chestCm', column: 4, min: 30, max: 300},
    {key: 'waistCm', column: 5, min: 30, max: 300},
    {key: 'hipsCm', column: 6, min: 30, max: 300},
    {key: 'upperArmCm', column: 7, min: 10, max: 100},
    {key: 'thighCm', column: 8, min: 20, max: 150}
  ]
};

function handleDmsClientPortalRequest_(auth, request) {
  try {
    if (!auth || !auth.user || auth.user.id === undefined || auth.user.id === null) {
      throwDmsClientPortalError_('invalid_user', 401);
    }
    const allowedRequestKeys = {
      dmsMiniApp: true,
      version: true,
      initData: true,
      action: true
    };
    if (!request || Object.keys(request).some(function(key) {
      return !allowedRequestKeys[key];
    })) {
      throwDmsClientPortalError_('invalid_request', 400);
    }
    const data = getDmsClientPortalBootstrap_(String(auth.user.id));
    return dmsMiniAppJsonResponse_({
      ok: true,
      release: DMS_CLIENT_PORTAL.RELEASE,
      data: data
    }, 200);
  } catch (error) {
    const failure = getDmsClientPortalFailure_(error);
    console.error('Client portal API: ' + failure.code);
    return dmsMiniAppJsonResponse_({ok: false, error: failure.code}, failure.status);
  }
}

function getDmsClientPortalBootstrap_(telegramUserId) {
  const ss = SpreadsheetApp.getActive();
  const access = getDmsClientPortalSheet_(
    ss,
    DMS_CLIENT_PORTAL.ACCESS_SHEET,
    DMS_CLIENT_PORTAL.ACCESS_HEADERS
  );
  const clients = getDmsClientPortalSheet_(
    ss,
    DMS_CLIENT_PORTAL.CLIENTS_SHEET,
    null
  );
  const measurements = getDmsClientPortalSheet_(
    ss,
    DMS_CLIENT_PORTAL.MEASUREMENTS_SHEET,
    DMS_CLIENT_PORTAL.MEASUREMENT_HEADERS
  );
  const accessRows = getDmsClientPortalRows_(
    access,
    DMS_CLIENT_PORTAL.ACCESS_FIRST_ROW,
    DMS_CLIENT_PORTAL.ACCESS_COLUMNS,
    true
  );
  const clientId = resolveDmsClientPortalBindingRows_(telegramUserId, accessRows);
  const profile = getDmsClientPortalProfile_(clients, clientId);
  const measurementRows = getDmsClientPortalRows_(
    measurements,
    DMS_CLIENT_PORTAL.MEASUREMENT_FIRST_ROW,
    DMS_CLIENT_PORTAL.MEASUREMENT_COLUMNS,
    false
  );
  const history = buildDmsClientPortalMeasurements_(clientId, measurementRows);

  return {
    generatedAt: new Date().toISOString(),
    profile: profile,
    latestMeasurement: history.length ? history[0] : null,
    measurements: history
  };
}

function getDmsClientPortalSheet_(ss, name, headers) {
  const sheet = ss && ss.getSheetByName ? ss.getSheetByName(name) : null;
  if (!sheet) throwDmsClientPortalError_('client_portal_not_configured', 503);
  if (headers) {
    const actual = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
    if (actual.length !== headers.length || actual.some(function(value, index) {
      return String(value || '').trim() !== headers[index];
    })) {
      throwDmsClientPortalError_('client_portal_schema_invalid', 503);
    }
  }
  return sheet;
}

function getDmsClientPortalRows_(sheet, firstRow, columns, displayValues) {
  const lastRow = sheet.getLastRow();
  if (lastRow < firstRow) return [];
  const range = sheet.getRange(firstRow, 1, lastRow - firstRow + 1, columns);
  return displayValues ? range.getDisplayValues() : range.getValues();
}

function resolveDmsClientPortalBindingRows_(telegramUserId, rows) {
  const requestedId = String(telegramUserId || '').trim();
  if (!/^\d{5,20}$/.test(requestedId)) {
    throwDmsClientPortalError_('invalid_user', 401);
  }
  const normalized = rows.map(function(row) {
    return {
      bindingId: String(row[0] || '').trim(),
      telegramUserId: String(row[1] || '').trim(),
      clientId: String(row[2] || '').trim(),
      status: String(row[3] || '').trim().toLowerCase()
    };
  });
  const matches = normalized.filter(function(binding) {
    return binding.telegramUserId === requestedId;
  });
  if (!matches.length) throwDmsClientPortalError_('client_not_linked', 403);
  if (matches.length !== 1) throwDmsClientPortalError_('client_link_invalid', 409);

  const selected = matches[0];
  if (selected.status !== DMS_CLIENT_PORTAL.ACTIVE_STATUS) {
    throwDmsClientPortalError_('client_not_linked', 403);
  }
  if (!/^BND-[A-Za-z0-9_-]+$/.test(selected.bindingId) ||
      !/^CL-[A-Za-z0-9_-]+$/.test(selected.clientId)) {
    throwDmsClientPortalError_('client_link_invalid', 409);
  }

  const activeForClient = normalized.filter(function(binding) {
    return binding.status === DMS_CLIENT_PORTAL.ACTIVE_STATUS &&
      binding.clientId === selected.clientId;
  });
  const duplicateBindingId = normalized.filter(function(binding) {
    return binding.bindingId === selected.bindingId;
  });
  if (activeForClient.length !== 1 || duplicateBindingId.length !== 1) {
    throwDmsClientPortalError_('client_link_invalid', 409);
  }
  return selected.clientId;
}

function getDmsClientPortalProfile_(sheet, clientId) {
  const rows = getDmsClientPortalRows_(
    sheet,
    DMS_CLIENT_PORTAL.CLIENT_FIRST_ROW,
    DMS_CLIENT_PORTAL.CLIENT_COLUMNS,
    true
  ).filter(function(row) {
    return String(row[0] || '').trim() === clientId;
  });
  if (rows.length !== 1) throwDmsClientPortalError_('client_record_invalid', 409);
  const row = rows[0];
  if (String(row[2] || '').trim() !== 'Активен') {
    throwDmsClientPortalError_('client_not_linked', 403);
  }
  const name = String(row[1] || '').trim();
  if (!name) throwDmsClientPortalError_('client_record_invalid', 409);
  return {
    name: name,
    trainingFormat: String(row[4] || '').trim()
  };
}

function buildDmsClientPortalMeasurements_(clientId, rows) {
  const seen = {};
  const result = [];
  rows.forEach(function(row) {
    if (String(row[1] || '').trim() !== clientId) return;
    const measurementId = String(row[0] || '').trim();
    const measuredAt = row[2];
    if (!/^MSR-[A-Za-z0-9_-]+$/.test(measurementId) || seen[measurementId] ||
        !(measuredAt instanceof Date) || isNaN(measuredAt.getTime())) {
      throwDmsClientPortalError_('client_data_invalid', 409);
    }
    seen[measurementId] = true;
    const metrics = {};
    DMS_CLIENT_PORTAL.METRICS.forEach(function(metric) {
      const value = row[metric.column];
      if (value === '' || value === null || value === undefined) return;
      const number = Number(value);
      if (!isFinite(number) || number < metric.min || number > metric.max) {
        throwDmsClientPortalError_('client_data_invalid', 409);
      }
      metrics[metric.key] = number;
    });
    if (!Object.keys(metrics).length) {
      throwDmsClientPortalError_('client_data_invalid', 409);
    }
    result.push({measuredAt: measuredAt.toISOString(), metrics: metrics});
  });
  result.sort(function(left, right) {
    return right.measuredAt.localeCompare(left.measuredAt);
  });
  return result;
}

function throwDmsClientPortalError_(code, status) {
  const error = new Error(code);
  error.dmsClientPortalCode = code;
  error.dmsClientPortalStatus = status;
  throw error;
}

function getDmsClientPortalFailure_(error) {
  if (error && error.dmsClientPortalCode) {
    return {
      code: String(error.dmsClientPortalCode),
      status: Number(error.dmsClientPortalStatus) || 500
    };
  }
  return {code: 'client_portal_failed', status: 500};
}
