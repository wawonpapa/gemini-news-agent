/**
 * スプレッドシート データベース操作モジュール (Sheets.gs)
 * スプレッドシートへの永続化、読み込み、ログ出力、自動学習処理を担当します。
 */

/**
 * 記事URLからハッシュ化ID（SHA-256の頭16文字）を生成します。
 * 重複保存を防ぐためのユニークキーとして利用します。
 */
function makeArticleId(url) {
  if (!url) return '';
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    url,
    Utilities.Charset.UTF_8
  );
  return digest
    .map(function(byte) {
      const v = (byte < 0 ? byte + 256 : byte).toString(16);
      return v.length === 1 ? '0' + v : v;
    })
    .join('')
    .slice(0, 16);
}

/**
 * 指定された記事IDがすでにスプレッドシートに存在するか確認します。
 */
function articleExists(articleId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('articles');
  if (!sheet) return false;
  
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(row => row[0].toString());
  return ids.includes(articleId);
}

/**
 * 記事をデータベース（articlesシート）に保存します。
 */
function saveArticle(article) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('articles');
  if (!sheet) return;

  sheet.appendRow([
    article.article_id,
    new Date(),
    article.published_at || '',
    article.source || '',
    article.title || '',
    article.url || '',
    article.author || '',
    article.ai_summary || '',
    article.category || '',
    (article.tags || []).join(','),
    article.importance || '',
    article.interest_score || '',
    article.reason || '',
    article.status || 'new',
    '' // notified_at は未設定で初期化
  ]);
}

/**
 * 記事IDをもとに記事の情報を取得します。
 */
function getArticleById(articleId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('articles');
  if (!sheet) return null;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const rows = sheet.getRange(2, 1, lastRow - 1, 15).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0].toString() === articleId) {
      return {
        article_id: rows[i][0],
        fetched_at: rows[i][1],
        published_at: rows[i][2],
        source: rows[i][3],
        title: rows[i][4],
        url: rows[i][5],
        author: rows[i][6],
        ai_summary: rows[i][7],
        category: rows[i][8],
        tags: rows[i][9],
        importance: rows[i][10],
        interest_score: rows[i][11],
        reason: rows[i][12],
        status: rows[i][13],
        notified_at: rows[i][14]
      };
    }
  }
  return null;
}

/**
 * 興味プロファイル（interest_profileシート）のタグ情報を取得し、マップ形式で返します。
 * @return {Object} タグ名 -> 重み のオブジェクト
 */
function getInterestProfileMap() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('interest_profile');
  const profileMap = {};
  if (!sheet) return profileMap;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return profileMap;

  const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  data.forEach(row => {
    const tag = row[0].toString().trim();
    const weight = parseFloat(row[1]) || 0;
    if (tag) {
      profileMap[tag] = weight;
    }
  });

  return profileMap;
}

/**
 * 探索の補助・フォーカスに用いるドメイン／キーワードリストを取得します。
 * @return {Array<string>} 優先キーワード配列
 */
function getFocusDomains() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('sources');
  const domains = [];
  if (!sheet) return domains;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return domains;

  const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  data.forEach(row => {
    const val = row[0].toString().trim();
    const type = row[1].toString().trim();
    const enabled = row[2].toString().trim().toUpperCase();
    
    if (val && type === 'focus' && enabled === 'TRUE') {
      domains.push(val);
    }
  });

  return domains;
}

/**
 * 設定（settingsシート）を取得し、マップ形式で返します。
 */
function getSettingsMap() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('settings');
  const settings = {};
  if (!sheet) return settings;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return settings;

  const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  data.forEach(row => {
    const key = row[0].toString().trim();
    const value = row[1];
    if (key) {
      settings[key] = value;
    }
  });

  return settings;
}

/**
 * 記事のステータス（status）カラムと通知日時（notified_at）を更新します。
 */
function updateArticleStatus(articleId, status) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('articles');
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const range = sheet.getRange(2, 1, lastRow - 1, 1);
  const ids = range.getValues().map(row => row[0].toString());
  
  const index = ids.indexOf(articleId);
  if (index !== -1) {
    const rowNum = index + 2;
    sheet.getRange(rowNum, 14).setValue(status); // status列（14列目）
    
    if (status === 'notified') {
      sheet.getRange(rowNum, 15).setValue(new Date()); // notified_at列（15列目）
    }
  }
}

/**
 * ユーザーのリアクション履歴を reactions シートに記録します。
 */
function recordReaction(articleId, action, article) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('reactions');
  if (!sheet) return;

  sheet.appendRow([
    new Date(),
    articleId,
    action,
    article.url || '',
    article.title || '',
    '' // メモは初期空欄
  ]);
}

/**
 * 動作ログを logs シートに記録します。
 */
function writeLog(functionName, status, message) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('logs');
    if (!sheet) return;
    
    sheet.appendRow([
      new Date(),
      functionName,
      status,
      message
    ]);
  } catch(e) {
    console.error("ログ記録エラー:", e);
  }
}

/**
 * 興味プロファイルのタグ重みを自動更新・学習します。
 * @param {Object} tagDelta タグ名 -> 重み増分
 */
function updateInterestWeights(tagDelta) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('interest_profile');
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  let tagRows = [];
  if (lastRow >= 2) {
    tagRows = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  }

  const existingTags = {};
  tagRows.forEach((row, index) => {
    existingTags[row[0].toString().trim()] = {
      rowIndex: index + 2,
      weight: parseFloat(row[1]) || 0
    };
  });

  for (const tag in tagDelta) {
    const delta = tagDelta[tag];
    if (existingTags[tag]) {
      const data = existingTags[tag];
      const newWeight = Math.max(0, data.weight + delta);
      sheet.getRange(data.rowIndex, 2).setValue(newWeight);
      sheet.getRange(data.rowIndex, 3).setValue(new Date());
      sheet.getRange(data.rowIndex, 4).setValue(`リアクション自動学習による変動 (増分: ${delta})`);
    } else {
      const newWeight = Math.max(0, 3 + delta);
      sheet.appendRow([
        tag,
        newWeight,
        new Date(),
        `新規検出タグ自動登録 (初期増分: ${delta})`
      ]);
    }
  }
}
