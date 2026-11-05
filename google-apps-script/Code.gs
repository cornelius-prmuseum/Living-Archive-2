const SHEET_NAME = 'Conversation Log';
const HEADERS = [
  'First Name',
  'Last Name',
  'Email',
  'Conversation Date & Time',
  'Conversation Duration',
  'ElevenLabs Conversation ID',
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const props = PropertiesService.getScriptProperties();
    const spreadsheetId = props.getProperty('SPREADSHEET_ID');
    const expectedSecret = props.getProperty('LOG_SECRET');

    if (!spreadsheetId || !expectedSecret) {
      return jsonResponse({ ok: false, error: 'Script properties are not configured.' });
    }

    const data = JSON.parse((e.postData && e.postData.contents) || '{}');
    if (data.secret !== expectedSecret) {
      return jsonResponse({ ok: false, error: 'Unauthorized.' });
    }

    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    let sheet = spreadsheet.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);

    ensureHeader(sheet);

    const conversationId = safeCell(data.conversationId);
    if (!conversationId) {
      return jsonResponse({ ok: false, error: 'Missing conversation ID.' });
    }

    const existingRow = findConversationRow(sheet, conversationId);
    const durationSeconds = Math.max(0, Number(data.durationSeconds || 0));
    const durationValue = durationSeconds / 86400;

    if (data.event === 'start') {
      if (!existingRow) {
        const row = sheet.getLastRow() + 1;
        sheet.getRange(row, 1, 1, 6).setValues([[
          safeCell(data.firstName),
          safeCell(data.lastName),
          safeCell(data.email),
          new Date(data.conversationDateTime),
          '',
          conversationId,
        ]]);
        sheet.getRange(row, 4).setNumberFormat('m/d/yyyy h:mm:ss AM/PM');
        sheet.getRange(row, 5).setNumberFormat('[h]:mm:ss');
      }
    } else if (data.event === 'end') {
      const row = existingRow || sheet.getLastRow() + 1;
      if (!existingRow) {
        sheet.getRange(row, 1, 1, 6).setValues([[
          safeCell(data.firstName),
          safeCell(data.lastName),
          safeCell(data.email),
          new Date(data.conversationDateTime),
          durationValue,
          conversationId,
        ]]);
        sheet.getRange(row, 4).setNumberFormat('m/d/yyyy h:mm:ss AM/PM');
      } else {
        sheet.getRange(row, 5).setValue(durationValue);
      }
      sheet.getRange(row, 5).setNumberFormat('[h]:mm:ss');
    } else {
      return jsonResponse({ ok: false, error: 'Unknown event.' });
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: String(error) });
  } finally {
    lock.releaseLock();
  }
}

function ensureHeader(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, HEADERS.length);
  }
}

function findConversationRow(sheet, conversationId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const match = sheet
    .getRange(2, 6, lastRow - 1, 1)
    .createTextFinder(conversationId)
    .matchEntireCell(true)
    .findNext();

  return match ? match.getRow() : null;
}

function safeCell(value) {
  const text = String(value == null ? '' : value).trim();
  if (/^[=+\-@]/.test(text)) return "'" + text;
  return text;
}

function jsonResponse(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
