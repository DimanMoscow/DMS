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
  INVITES_SHEET: 'Приглашения Client Portal',
  INVITE_HEADERS: [
    'Invite ID', 'Token SHA-256', 'Client ID', 'Status', 'Expires At',
    'Created At', 'Used At', 'Revoked At', 'Updated At', 'Used Binding ID'
  ],
  INVITE_FIRST_ROW: 2,
  INVITE_COLUMNS: 10,
  INVITE_TTL_MS: 48 * 60 * 60 * 1000,
  INVITE_TOKEN_PATTERN: /^[A-Za-z0-9_-]{43}$/,
  INVITE_STATUSES: {pending: true, used: true, revoked: true, expired: true},
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

function handleDmsClientPortalEnrollmentRequest_(auth, request) {
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
    const token = String(auth.startParam || '').trim();
    if (!DMS_CLIENT_PORTAL.INVITE_TOKEN_PATTERN.test(token)) {
      throwDmsClientPortalError_('enrollment_invite_invalid', 403);
    }
    consumeDmsClientPortalInvite_(String(auth.user.id), token);
    return dmsMiniAppJsonResponse_({
      ok: true,
      release: DMS_CLIENT_PORTAL.RELEASE,
      data: {enrolled: true}
    }, 200);
  } catch (error) {
    const failure = getDmsClientPortalFailure_(error);
    console.error('Client portal enrollment: ' + failure.code);
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

function getDmsClientPortalAdminState_(clientId) {
  const ss = SpreadsheetApp.getActive();
  const access = getDmsClientPortalSheet_(
    ss,
    DMS_CLIENT_PORTAL.ACCESS_SHEET,
    DMS_CLIENT_PORTAL.ACCESS_HEADERS
  );
  const invites = getDmsClientPortalSheet_(
    ss,
    DMS_CLIENT_PORTAL.INVITES_SHEET,
    DMS_CLIENT_PORTAL.INVITE_HEADERS
  );
  const accessRows = getDmsClientPortalRows_(
    access,
    DMS_CLIENT_PORTAL.ACCESS_FIRST_ROW,
    DMS_CLIENT_PORTAL.ACCESS_COLUMNS,
    true
  );
  validateDmsClientPortalAccessRows_(accessRows);
  const linked = accessRows.filter(function(row) {
    return String(row[2] || '').trim() === String(clientId) &&
      String(row[3] || '').trim().toLowerCase() === DMS_CLIENT_PORTAL.ACTIVE_STATUS;
  });
  const inviteRows = readDmsClientPortalInviteRows_(invites);
  const now = Date.now();
  const pending = inviteRows.filter(function(invite) {
    return invite.clientId === String(clientId) && invite.status === 'pending' &&
      invite.expiresAt.getTime() > now;
  });
  if (linked.length > 1 || pending.length > 1) {
    throwDmsClientPortalError_('client_link_invalid', 409);
  }
  return {
    status: linked.length === 1 ? 'linked' : pending.length === 1 ? 'invited' : 'unlinked',
    activeInvite: pending.length === 1 ? {
      inviteId: pending[0].inviteId,
      expiresAt: pending[0].expiresAt.toISOString()
    } : null
  };
}

function createDmsClientPortalInvite_(clientId) {
  const id = normalizeDmsClientPortalClientId_(clientId);
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) {
    throwDmsClientPortalError_('operation_busy', 409);
  }
  try {
    const ss = SpreadsheetApp.getActive();
    assertDmsClientPortalClient_(ss, id);
    const access = getDmsClientPortalSheet_(
      ss,
      DMS_CLIENT_PORTAL.ACCESS_SHEET,
      DMS_CLIENT_PORTAL.ACCESS_HEADERS
    );
    const invites = getDmsClientPortalSheet_(
      ss,
      DMS_CLIENT_PORTAL.INVITES_SHEET,
      DMS_CLIENT_PORTAL.INVITE_HEADERS
    );
    const accessRows = getDmsClientPortalRows_(
      access,
      DMS_CLIENT_PORTAL.ACCESS_FIRST_ROW,
      DMS_CLIENT_PORTAL.ACCESS_COLUMNS,
      true
    );
    validateDmsClientPortalAccessRows_(accessRows);
    if (accessRows.some(function(row) {
      return String(row[2] || '').trim() === id &&
        String(row[3] || '').trim().toLowerCase() === DMS_CLIENT_PORTAL.ACTIVE_STATUS;
    })) {
      throwDmsClientPortalError_('client_already_linked', 409);
    }

    const inviteRows = readDmsClientPortalInviteRows_(invites);
    if (inviteRows.some(function(invite) {
      return invite.clientId === id && invite.status === 'pending' &&
        invite.expiresAt.getTime() > Date.now();
    })) {
      throwDmsClientPortalError_('enrollment_invite_active', 409);
    }

    const token = generateDmsClientPortalSecret_();
    const now = new Date();
    const inviteId = 'INV-' + sha256DmsClientPortal_(
      'invite:' + token + ':' + now.toISOString()
    ).substring(0, 20);
    const expiresAt = new Date(now.getTime() + DMS_CLIENT_PORTAL.INVITE_TTL_MS);
    const inviteUrl = buildDmsClientPortalInviteUrl_(token);
    invites.appendRow([
      inviteId,
      sha256DmsClientPortal_(token),
      id,
      'pending',
      expiresAt,
      now,
      '',
      '',
      now,
      ''
    ]);
    SpreadsheetApp.flush();

    return {
      clientPortal: getDmsClientPortalAdminState_(id),
      inviteUrl: inviteUrl
    };
  } finally {
    lock.releaseLock();
  }
}

function revokeDmsClientPortalInvite_(clientId, inviteId) {
  const id = normalizeDmsClientPortalClientId_(clientId);
  const requestedInviteId = String(inviteId || '').trim();
  if (!/^INV-[A-Za-z0-9_-]+$/.test(requestedInviteId)) {
    throwDmsClientPortalError_('enrollment_invite_invalid', 400);
  }
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) {
    throwDmsClientPortalError_('operation_busy', 409);
  }
  try {
    const ss = SpreadsheetApp.getActive();
    assertDmsClientPortalClient_(ss, id);
    const invites = getDmsClientPortalSheet_(
      ss,
      DMS_CLIENT_PORTAL.INVITES_SHEET,
      DMS_CLIENT_PORTAL.INVITE_HEADERS
    );
    const matches = readDmsClientPortalInviteRows_(invites).filter(function(invite) {
      return invite.inviteId === requestedInviteId && invite.clientId === id;
    });
    if (matches.length !== 1 || matches[0].status !== 'pending') {
      throwDmsClientPortalError_('enrollment_invite_invalid', 409);
    }
    const now = new Date();
    invites.getRange(matches[0].rowNumber, 4, 1, 7).setValues([[
      'revoked',
      matches[0].expiresAt,
      matches[0].createdAt,
      '',
      now,
      now,
      ''
    ]]);
    SpreadsheetApp.flush();
    return {clientPortal: getDmsClientPortalAdminState_(id)};
  } finally {
    lock.releaseLock();
  }
}

function consumeDmsClientPortalInvite_(telegramUserId, token) {
  const telegramId = String(telegramUserId || '').trim();
  if (!/^\d{5,20}$/.test(telegramId) ||
      !DMS_CLIENT_PORTAL.INVITE_TOKEN_PATTERN.test(String(token || ''))) {
    throwDmsClientPortalError_('enrollment_invite_invalid', 403);
  }
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) {
    throwDmsClientPortalError_('operation_busy', 409);
  }
  try {
    const ss = SpreadsheetApp.getActive();
    const invites = getDmsClientPortalSheet_(
      ss,
      DMS_CLIENT_PORTAL.INVITES_SHEET,
      DMS_CLIENT_PORTAL.INVITE_HEADERS
    );
    const access = getDmsClientPortalSheet_(
      ss,
      DMS_CLIENT_PORTAL.ACCESS_SHEET,
      DMS_CLIENT_PORTAL.ACCESS_HEADERS
    );
    const tokenHash = sha256DmsClientPortal_(token);
    const matches = readDmsClientPortalInviteRows_(invites).filter(function(invite) {
      return dmsMiniAppConstantTimeEqual_(invite.tokenHash, tokenHash);
    });
    if (matches.length !== 1) {
      throwDmsClientPortalError_('enrollment_invite_invalid', 403);
    }
    const invite = matches[0];
    if (invite.status !== 'pending') {
      throwDmsClientPortalError_('enrollment_invite_invalid', 409);
    }
    if (invite.expiresAt.getTime() <= Date.now()) {
      const expiredAt = new Date();
      invites.getRange(invite.rowNumber, 4).setValue('expired');
      invites.getRange(invite.rowNumber, 9).setValue(expiredAt);
      SpreadsheetApp.flush();
      throwDmsClientPortalError_('enrollment_invite_expired', 410);
    }
    assertDmsClientPortalClient_(ss, invite.clientId);

    const accessRows = getDmsClientPortalRows_(
      access,
      DMS_CLIENT_PORTAL.ACCESS_FIRST_ROW,
      DMS_CLIENT_PORTAL.ACCESS_COLUMNS,
      true
    );
    validateDmsClientPortalAccessRows_(accessRows);
    if (accessRows.some(function(row) {
      const active = String(row[3] || '').trim().toLowerCase() ===
        DMS_CLIENT_PORTAL.ACTIVE_STATUS;
      return active && (String(row[1] || '').trim() === telegramId ||
        String(row[2] || '').trim() === invite.clientId);
    })) {
      throwDmsClientPortalError_('client_link_conflict', 409);
    }

    const now = new Date();
    const bindingId = 'BND-' + sha256DmsClientPortal_(
      'binding:' + generateDmsClientPortalSecret_() + ':' + telegramId
    ).substring(0, 20);
    const bindingRow = access.getLastRow() + 1;
    access.getRange(bindingRow, 1, 1, DMS_CLIENT_PORTAL.ACCESS_COLUMNS).setValues([[
      bindingId,
      telegramId,
      invite.clientId,
      DMS_CLIENT_PORTAL.ACTIVE_STATUS,
      now,
      now
    ]]);
    try {
      invites.getRange(invite.rowNumber, 4, 1, 7).setValues([[
        'used',
        invite.expiresAt,
        invite.createdAt,
        now,
        '',
        now,
        bindingId
      ]]);
      SpreadsheetApp.flush();
    } catch (error) {
      access.deleteRow(bindingRow);
      SpreadsheetApp.flush();
      throw error;
    }
    return {bindingId: bindingId, clientId: invite.clientId};
  } finally {
    lock.releaseLock();
  }
}

function normalizeDmsClientPortalClientId_(clientId) {
  const id = String(clientId || '').trim();
  if (!/^CL-[A-Za-z0-9_-]+$/.test(id)) {
    throwDmsClientPortalError_('client_record_invalid', 400);
  }
  return id;
}

function assertDmsClientPortalClient_(ss, clientId) {
  const clients = getDmsClientPortalSheet_(ss, DMS_CLIENT_PORTAL.CLIENTS_SHEET, null);
  getDmsClientPortalProfile_(clients, clientId);
}

function validateDmsClientPortalAccessRows_(rows) {
  const bindingIds = {};
  const telegramIds = {};
  const clientIds = {};
  rows.forEach(function(row) {
    const bindingId = String(row[0] || '').trim();
    const telegramId = String(row[1] || '').trim();
    const clientId = String(row[2] || '').trim();
    const status = String(row[3] || '').trim().toLowerCase();
    if (!/^BND-[A-Za-z0-9_-]+$/.test(bindingId) || bindingIds[bindingId] ||
        !/^\d{5,20}$/.test(telegramId) || !/^CL-[A-Za-z0-9_-]+$/.test(clientId) ||
        (status !== 'active' && status !== 'disabled')) {
      throwDmsClientPortalError_('client_link_invalid', 409);
    }
    bindingIds[bindingId] = true;
    if (status === DMS_CLIENT_PORTAL.ACTIVE_STATUS) {
      if (telegramIds[telegramId] || clientIds[clientId]) {
        throwDmsClientPortalError_('client_link_invalid', 409);
      }
      telegramIds[telegramId] = true;
      clientIds[clientId] = true;
    }
  });
}

function readDmsClientPortalInviteRows_(sheet) {
  const rows = getDmsClientPortalRows_(
    sheet,
    DMS_CLIENT_PORTAL.INVITE_FIRST_ROW,
    DMS_CLIENT_PORTAL.INVITE_COLUMNS,
    false
  );
  const inviteIds = {};
  const tokenHashes = {};
  return rows.map(function(row, index) {
    const inviteId = String(row[0] || '').trim();
    const tokenHash = String(row[1] || '').trim().toLowerCase();
    const clientId = String(row[2] || '').trim();
    const status = String(row[3] || '').trim().toLowerCase();
    const expiresAt = row[4];
    const createdAt = row[5];
    if (!/^INV-[A-Za-z0-9_-]+$/.test(inviteId) || inviteIds[inviteId] ||
        !/^[a-f0-9]{64}$/.test(tokenHash) || tokenHashes[tokenHash] ||
        !/^CL-[A-Za-z0-9_-]+$/.test(clientId) ||
        !DMS_CLIENT_PORTAL.INVITE_STATUSES[status] ||
        !(expiresAt instanceof Date) || isNaN(expiresAt.getTime()) ||
        !(createdAt instanceof Date) || isNaN(createdAt.getTime())) {
      throwDmsClientPortalError_('enrollment_schema_invalid', 503);
    }
    inviteIds[inviteId] = true;
    tokenHashes[tokenHash] = true;
    return {
      rowNumber: DMS_CLIENT_PORTAL.INVITE_FIRST_ROW + index,
      inviteId: inviteId,
      tokenHash: tokenHash,
      clientId: clientId,
      status: status,
      expiresAt: expiresAt,
      createdAt: createdAt
    };
  });
}

function generateDmsClientPortalSecret_() {
  const botToken = getTelegramProperty_(DMS_TELEGRAM.PROP_TOKEN);
  if (!botToken) throwDmsClientPortalError_('server_not_configured', 503);
  const seed = [
    Utilities.getUuid(),
    Utilities.getUuid(),
    String(Date.now()),
    String(Math.random())
  ].join(':');
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(seed, botToken)
  ).replace(/=+$/g, '');
}

function sha256DmsClientPortal_(value) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ''),
    Utilities.Charset.UTF_8
  ).map(function(byte) {
    return ('0' + ((byte < 0 ? byte + 256 : byte) & 255).toString(16)).slice(-2);
  }).join('');
}

function buildDmsClientPortalInviteUrl_(token) {
  const bot = telegramApi_('getMe', {});
  const username = String(bot && bot.username || '').trim();
  if (!bot || bot.has_main_web_app !== true || !/^[A-Za-z0-9_]{5,32}$/.test(username)) {
    throwDmsClientPortalError_('enrollment_link_not_configured', 503);
  }
  return 'https://t.me/' + username + '?startapp=' + encodeURIComponent(token);
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
