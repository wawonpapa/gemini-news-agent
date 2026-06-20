/**
 * スプレッドシート データベース操作モジュール (Sheets.gs)
 * スプレッドシートへの永続化、読み込み、ログ出力、自動学習処理を担当します。
 * 【最適化】URL正規化の搭載、API呼び出し削減（キャッシュ化）、重み上限の設定を追加。
 */

/**
 * 【共通ヘルパー】Gemini APIキーをスクリプトプロパティから取得します。
 * SearchAgent.gs / Gemini.gs など複数モジュールから共通利用されます。
 * @return {string} APIキー
 * @throws {Error} APIキーが未設定の場合
 */
function getGeminiApiKey() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error("Gemini APIキー（GEMINI_API_KEY）がスクリプトプロパティに設定されていません。");
  }
  return apiKey;
}

/**
 * URLをクレンジングしてトラッキング用パラメータや末尾のスラッシュを除去し、正規化します。
 * これにより、同じURLのパラメータ違いによる重複通知を確実に防ぎます。
 */
function normalizeUrl(url) {
  if (!url) return '';
  try {
    // アンカーリンク（#以降）の除去
    let cleanUrl = url.split('#')[0].trim();

    // クエリパラメータはトラッキング用のみ除去し、記事IDに使われるパラメータは保持する
    const urlParts = cleanUrl.split('?');
    let baseUrl = urlParts[0];

    if (urlParts.length > 1) {
      const trackingParams = new Set([
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'fbclid', 'gclid', 'msclkid', 'ref', 'referrer', 'si', 'smid'
      ]);

      const params = urlParts[1].split('&')
        .filter(function(param) {
          var key = param.split('=')[0].toLowerCase();
          return !trackingParams.has(key);
        });

      cleanUrl = params.length > 0 ? baseUrl + '?' + params.join('&') : baseUrl;
    }

    // 末尾のスラッシュを除去して表記揺れを統一
    if (cleanUrl.endsWith('/')) {
      cleanUrl = cleanUrl.slice(0, -1);
    }
    return cleanUrl.toLowerCase();
  } catch(e) {
    return url.toLowerCase().trim();
  }
}

/**
 * 記事URLからハッシュ化ID（SHA-256の頭16文字）を生成します。
 * 重複保存を防ぐためのユニークキーとして利用します。
 */
function makeArticleId(url) {
  if (!url) return '';
  const cleanUrl = normalizeUrl(url);
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    cleanUrl,
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
 * 【最適化】すべての登録済み記事IDを一度にロードし、Setオブジェクトにして返します。
 * これにより、ループ内の大量スプレッドシート読み込みAPI呼び出しを「1回」に削減します。
 */
function getAllArticleIdsSet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('articles');
  const idSet = new Set();
  if (!sheet) return idSet;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return idSet;

  const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  data.forEach(row => {
    const id = row[0].toString().trim();
    if (id) {
      idSet.add(id);
    }
  });

  return idSet;
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
 * @param {string} articleId
 * @param {string} action
 * @param {Object} article
 * @param {string} memo フィードバックの理由・メモ
 */
function recordReaction(articleId, action, article, memo) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('reactions');
  if (!sheet) return;

  sheet.appendRow([
    new Date(),
    articleId,
    action,
    article.url || '',
    article.title || '',
    memo || '' // フィードバックの理由・メモを記録
  ]);
}

/**
 * 過去 dayLimit 日間にユーザーがリアクション（open / good / bad）した記事IDのSetを返します。
 * Issue #3: リアクション済み記事の重複配信防止に使用。
 * ※ read_later は「まだ読んでいない」ことを意味するため除外対象にしません（案B）。
 * @param {number} dayLimit 遡る日数（デフォルト30日）
 * @return {Set<string>} リアクション済みの article_id の Set
 */
function getReactedArticleIdSet(dayLimit) {
  dayLimit = (dayLimit === undefined) ? 30 : dayLimit;
  const idSet = new Set();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('reactions');
  if (!sheet) return idSet;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return idSet;

  // reactions シートのカラム: [timestamp, article_id, action, url, title, memo]
  const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();

  const threshold = new Date();
  threshold.setDate(threshold.getDate() - dayLimit);

  // read_later は配信リマインダーとして許容するため除外対象に含めない
  const filteredActions = new Set(['open', 'good', 'bad']);

  data.forEach(function(row) {
    const reactedAt = new Date(row[0]);
    const articleId = row[1].toString().trim();
    const action = row[2].toString().trim();

    if (reactedAt >= threshold && articleId && filteredActions.has(action)) {
      idSet.add(articleId);
    }
  });

  return idSet;
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
 * 【最適化】興味プロファイルのタグ重みを自動更新・学習します。
 * ※重み上限を最大 10、最小 0 に制限し、インフレや学習の偏りを防止します。
 * ※毎週の減衰処理（古い興味の緩やかな除外）にも対応。
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
      // 上限 10, 下限 0 に制限
      const newWeight = Math.min(10, Math.max(0, data.weight + delta));
      sheet.getRange(data.rowIndex, 2).setValue(newWeight);
      sheet.getRange(data.rowIndex, 3).setValue(new Date());
      sheet.getRange(data.rowIndex, 4).setValue(`リアクション自動学習による変動 (増分: ${delta})`);
    } else {
      // 新規タグも最大10、最小0に制限
      const newWeight = Math.min(10, Math.max(0, 3 + delta));
      sheet.appendRow([
        tag,
        newWeight,
        new Date(),
        `新規検出タグ自動登録 (初期増分: ${delta})`
      ]);
    }
  }
}

/**
 * 【最適化・新規】古いログデータ（30日以上前）を自動削除し、スプレッドシートの行数制限を防止します。
 */
function cleanupOldLogs() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('logs');
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  if (lastRow < 300) return; // 300行未満ならクリーンアップしない

  const thresholdDate = new Date();
  thresholdDate.setDate(thresholdDate.getDate() - 30); // 30日前

  const dataRowCount = lastRow - 1;
  const range = sheet.getRange(2, 1, dataRowCount, 4);
  const data = range.getValues();
  
  // 30日以内のログのみをフィルター
  const keepRows = data.filter(row => {
    const logDate = new Date(row[0]);
    return logDate >= thresholdDate;
  });

  range.clearContent();
  if (keepRows.length > 0) {
    sheet.getRange(2, 1, keepRows.length, 4).setValues(keepRows);
  }

  // 余剰行を削除してシートのゴーストデータ肥大化を防止
  const excessRows = dataRowCount - keepRows.length;
  if (excessRows > 0) {
    sheet.deleteRows(keepRows.length + 2, excessRows);
  }
  
  console.log(`ログのクリーンアップ完了。残した行数: ${keepRows.length}, 削除した行数: ${excessRows}`);
}

/**
 * articles シートの指定記事の tags カラムをユーザー編集済みの値で上書きします。
 * @param {string} articleId
 * @param {Array<string>} newTags
 */
function updateArticleTags(articleId, newTags) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('articles');
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(row => row[0].toString());
  const index = ids.indexOf(articleId);
  if (index !== -1) {
    const rowNum = index + 2;
    // tags列は10列目
    sheet.getRange(rowNum, 10).setValue(newTags.join(', '));
  }
}

/**
 * articles シートの指定記事の URL と status カラムを更新します。
 * @param {string} articleId
 * @param {string} finalUrl
 * @param {string} status
 */
function updateArticleUrlAndStatus(articleId, finalUrl, status) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('articles');
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const range = sheet.getRange(2, 1, lastRow - 1, 1);
  const ids = range.getValues().map(row => row[0].toString());
  
  const index = ids.indexOf(articleId);
  if (index !== -1) {
    const rowNum = index + 2;
    sheet.getRange(rowNum, 6).setValue(finalUrl); // URL列（6列目）
    sheet.getRange(rowNum, 14).setValue(status);  // status列（14列目）
  }
}

/**
 * articles シートから指定された記事 ID の行を物理削除します。
 * @param {string} articleId
 */
function deleteArticleRow(articleId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('articles');
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const range = sheet.getRange(2, 1, lastRow - 1, 1);
  const ids = range.getValues().map(row => row[0].toString());
  
  const index = ids.indexOf(articleId);
  if (index !== -1) {
    const rowNum = index + 2;
    sheet.deleteRow(rowNum);
    console.log(`スプレッドシートから無効な記事行を削除しました: ID ${articleId}`);
  }
}

/**
 * 指定したステータスに合致する記事リストを articles シートからロードします。
 * @param {string} status 'pending' など
 * @return {Array<Object>} 記事リスト
 */
function getArticlesByStatus(status) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('articles');
  const list = [];
  if (!sheet) return list;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return list;

  const rows = sheet.getRange(2, 1, lastRow - 1, 15).getValues();
  rows.forEach(row => {
    if (row[13].toString().trim() === status) {
      list.push({
        article_id: row[0],
        fetched_at: row[1],
        published_at: row[2],
        source: row[3],
        title: row[4],
        url: row[5],
        author: row[6],
        ai_summary: row[7],
        category: row[8],
        tags: row[9] ? row[9].toString().split(',').map(t => t.trim()).filter(t => t.length > 0) : [],
        importance: parseInt(row[10]) || 1,
        interest_score: parseFloat(row[11]) || 0,
        reason: row[12],
        status: row[13],
        notified_at: row[14]
      });
    }
  });

  return list;
}

