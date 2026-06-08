/**
 * Personal News Agent MVP Core Module (Code.gs)
 * 毎朝の自律リサーチジョブ、エラーハンドリング、興味スコア計算を統括します。
 * 【最適化】Setを用いた高速重複チェック、およびログ自動クリーンアップ処理を追加。
 */

/**
 * 毎朝の自律ニュース収集ジョブ。
 * 興味プロファイルに基づいてGoogle検索を行い、新着記事を発見・保存・通知します。
 */
function dailyNewsJob() {
  const functionName = 'dailyNewsJob';
  const startTime = Date.now(); // GAS 6分実行制限ガード用
  const MAX_EXECUTION_MS = 5 * 60 * 1000; // 5分で安全停止（1分の余裕を持たせる）
  writeLog(functionName, 'running', '自律探索ニュース収集を開始します。');

  try {
    // 1. スプレッドシートから現在の「興味タグ」および「優先ドメイン」を読み込む
    const profileMap = getInterestProfileMap();
    
    // 重みが 1 以上のタグを探索のキーワードとする
    const activeTags = Object.keys(profileMap).filter(tag => profileMap[tag] >= 1);
    const focusDomains = getFocusDomains();

    if (activeTags.length === 0) {
      writeLog(functionName, 'warning', '有効な興味タグが登録されていません。ジョブを休止します。');
      return;
    }

    console.log("探索キーワードタグ:", activeTags);
    console.log("優先探索ドメイン:", focusDomains);

    // 2. Gemini API + Google Search Grounding でインターネット全体から最新記事を分散探索
    // startTime を渡し、検索ループ内でも GAS 6分制限を監視する
    const discoveredArticles = discoverNewsViaGoogleSearch(activeTags, focusDomains, startTime, MAX_EXECUTION_MS);
    const newArticlesSaved = [];

    const settings = getSettingsMap();
    const dailyLimit = parseInt(settings.daily_limit) || 30;
    const notifyTopN = parseInt(settings.notify_top_n) || 10;

    let processedCount = 0;

    // 【最適化】興味プロファイルを事前に1回だけキャッシュ読み込み（ループ内の重複API呼び出しを防止）
    const cachedProfileMap = getInterestProfileMap();

    // 【最適化・新規】DBの全登録記事IDを1回のAPI呼び出しでキャッシュ読み込み (高速Set判定)
    const existingIds = getAllArticleIdsSet();
    console.log(`キャッシュに登録済みの記事ID数: ${existingIds.size} 件`);

    // 3. 発見された記事のフィルタリングとDB保存
    discoveredArticles.forEach(art => {
      const articleId = makeArticleId(art.url);

      // 高速Set判定により、スプレッドシートへの大量重複ロードAPI呼び出しを「0回」に削減！
      if (existingIds.has(articleId)) {
        return;
      }

      if (processedCount >= dailyLimit) {
        return;
      }

      // 【安全制限】GAS 6分実行制限ガード：5分経過で現在の結果を保存して安全停止
      if (Date.now() - startTime > MAX_EXECUTION_MS) {
        console.warn(`実行時間が5分を超過したため、記事処理を安全に中断します。処理済み: ${processedCount}件`);
        writeLog(functionName, 'warning', `Execution time limit reached. Scheduling retry in 10 minutes.`);
        scheduleRetry_(); // リトライトリガーを登録
        return;
      }

      // 4. 各記事の総合興味スコアの算出（キャッシュ済みプロファイルを使用）
      const interestScore = calculateInterestScore(art.tags || [], art.importance || 1, cachedProfileMap);

      const processedArticle = {
        article_id: articleId,
        title: art.title,
        url: art.url,
        source: art.source,
        author: art.author || '',
        published_at: new Date().toISOString(), // 探索日付
        ai_summary: art.ai_summary,
        category: art.category,
        tags: art.tags,
        importance: art.importance,
        interest_score: interestScore,
        reason: art.reason,
        status: 'new'
      };

      saveArticle(processedArticle);
      
      // 次のループの判定に備えてメモリ上のキャッシュSetにも即時追加
      existingIds.add(articleId);
      newArticlesSaved.push(processedArticle);
      processedCount++;
    });

    console.log(`新着自律探索完了。新規保存件数: ${newArticlesSaved.length} 件`);

    // 【安全制限】配信前の実行時間ガード：すでに制限時間を超えている場合は中断してリトライをスケジュール
    if (Date.now() - startTime > MAX_EXECUTION_MS) {
      console.warn(`配信処理の前に実行時間が5分を超過したため、中断してリトライを予約します。`);
      writeLog(functionName, 'warning', `Execution time limit reached before delivery. Scheduling retry in 10 minutes.`);
      scheduleRetry_();
      return;
    }

    // 5. 今回取得した記事 ＋ 過去に未通知の記事を統合してスコアリングランキングを作成
    const allPendingArticles = getUnnotifiedArticles();

    if (allPendingArticles.length === 0) {
      writeLog(functionName, 'success', '新規に配信するニュースはありませんでした。');
      
      // 【最適化】終了前に古いログの自動クリーンアップを実行してシート肥大化を防止
      cleanupOldLogs();
      return;
    }

    // 興味スコアの降順（高スコア順）でソート
    const sortedArticles = allPendingArticles.sort((a, b) => b.interest_score - a.interest_score);

    // 送信件数分スライス
    const topArticlesToNotify = sortedArticles.slice(0, notifyTopN);

    // 6. Gmail でプレミアムニュースレターとして配信
    if (topArticlesToNotify.length > 0) {
      console.log(`上位${topArticlesToNotify.length}件の記事をGmailで配信します。`);
      sendDailyDigest(topArticlesToNotify);

      // ステータスを 'notified' に更新
      topArticlesToNotify.forEach(a => {
        updateArticleStatus(a.article_id, 'notified');
      });

      writeLog(functionName, 'success', `${topArticlesToNotify.length} 件の自律厳選ニュースを配信しました。`);
    } else {
      writeLog(functionName, 'success', '配信条件を満たす記事がありませんでした。');
    }

    // 【最適化・新規】終了前に古い実行ログの自動クリーンアップを実行 (行数制限対応)
    cleanupOldLogs();

  } catch (error) {
    console.error("ETLジョブの実行中に重大なエラーが発生しました:", error);
    writeLog(functionName, 'error', `ETL Job Failure: ${error.message}`);
    sendErrorAlert(error.message);
    throw error;
  }
}

/**
 * タイムアウト時に10分後の再実行を動的にスケジュールします。
 */
function scheduleRetry_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('RETRY_PENDING') === 'true') return; // 重複登録防止
  ScriptApp.newTrigger('dailyNewsJobRetry')
    .timeBased()
    .after(10 * 60 * 1000) // 10分後
    .create();
  props.setProperty('RETRY_PENDING', 'true');
  console.log('リトライトリガーを10分後に登録しました。');
}

/**
 * リトライ用のエントリーポイント。
 * トリガーを削除し、軽量モードで実行します。
 */
function dailyNewsJobRetry() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('RETRY_PENDING');
  // 使用済みのリトライトリガーを自己削除
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyNewsJobRetry')
    .forEach(t => ScriptApp.deleteTrigger(t));
  
  // 軽量モードフラグをセットして通常ジョブを実行
  props.setProperty('LITE_MODE', 'true');
  try {
    dailyNewsJob();
  } finally {
    props.deleteProperty('LITE_MODE');
  }
}

/**
 * 記事に関連付けられたタグと、ユーザーの興味プロファイルの重みを掛け合わせて、総合興味スコアを計算します。
 * @param {Array<string>} tags 記事のタグ配列
 * @param {number} importance 重要度スコア (1-5)
 * @param {Object} [profileMap] キャッシュ済みの興味プロファイルマップ（省略時は都度読み込み）
 */
function calculateInterestScore(tags, importance, profileMap) {
  const profile = profileMap || getInterestProfileMap();
  
  let tagScore = 0;
  if (tags && Array.isArray(tags)) {
    tags.forEach(tag => {
      const normalizedTag = tag.trim();
      tagScore += profile[normalizedTag] || 0;
    });
  }

  // 計算式: (重要度 * 10) + 各マッチングタグの重みの合計
  return (importance * 10) + tagScore;
}

/**
 * まだ通知していない（status === 'new' かつ notified_at が空の）記事リストを取得します。
 */
function getUnnotifiedArticles() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('articles');
  const pending = [];
  if (!sheet) return pending;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return pending;

  // 【Issue #3】リアクション済みIDセットを1回だけ取得（open/good/bad が対象、read_laterは除外しない）
  const reactedIds = getReactedArticleIdSet(30);
  console.log(`リアクション済みIDキャッシュ（配信除外対象）: ${reactedIds.size} 件`);

  const rows = sheet.getRange(2, 1, lastRow - 1, 15).getValues();
  rows.forEach(row => {
    // notified_at列（15列目 / インデックス14）が空、かつステータスが 'new'
    if (!row[14] && row[13].toString().trim() === 'new') {
      // 【Issue #3】open/good/bad のリアクション済み記事は配信候補から除外する
      const artId = row[0].toString().trim();
      if (reactedIds.has(artId)) {
        console.log(`リアクション済みのため配信候補から除外: ${row[4]}`);
        return;
      }
      pending.push({
        article_id: row[0],
        fetched_at: row[1],
        published_at: row[2],
        source: row[3],
        title: row[4],
        url: row[5],
        author: row[6],
        ai_summary: row[7],
        category: row[8],
        tags: row[9] ? row[9].toString().split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t.length > 0; }) : [],
        importance: parseInt(row[10]) || 1,
        interest_score: parseFloat(row[11]) || 0,
        reason: row[12],
        status: row[13],
        notified_at: row[14]
      });
    }
  });

  return pending;
}


/**
 * システム実行時の致命的エラーを管理メールアドレス宛にアラート通知します。
 */
function sendErrorAlert(errorMessage) {
  try {
    const email = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
    if (!email) return;

    const subject = `⚠️ 【News Agent Alert】自律探索ジョブエラー発生`;
    const body = `
Personal News Agent の実行中に致命的なエラーが発生しました。
ログを確認の上、必要に応じて修復を行ってください。

■ 発生日時
${new Date().toLocaleString('ja-JP')}

■ エラー詳細
${errorMessage}

■ スプレッドシート
${SpreadsheetApp.getActiveSpreadsheet().getUrl()}
    `;

    GmailApp.sendEmail(email, subject, body, { name: "News Agent Monitor" });
  } catch(e) {
    console.error("アラートメール送信エラー:", e);
  }
}
