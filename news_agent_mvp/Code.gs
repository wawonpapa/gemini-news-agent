/**
 * Personal News Agent MVP Core Module (Code.gs)
 * 毎朝の自律リサーチジョブ、エラーハンドリング、興味スコア計算を統括します。
 */

/**
 * 毎朝の自律ニュース収集ジョブ。
 * 興味プロファイルに基づいてGoogle検索を行い、新着記事を発見・保存・通知します。
 */
function dailyNewsJob() {
  const functionName = 'dailyNewsJob';
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

    // 2. Gemini API + Google Search Grounding でインターネット全体から最新記事を探索
    const discoveredArticles = discoverNewsViaGoogleSearch(activeTags, focusDomains);
    const newArticlesSaved = [];

    const settings = getSettingsMap();
    const dailyLimit = parseInt(settings.daily_limit) || 30;
    const notifyTopN = parseInt(settings.notify_top_n) || 10;

    let processedCount = 0;

    // 3. 発見された記事のフィルタリングとDB保存
    discoveredArticles.forEach(art => {
      const articleId = makeArticleId(art.url);

      // 重複チェック
      if (articleExists(articleId)) {
        return;
      }

      if (processedCount >= dailyLimit) {
        return;
      }

      // 4. 各記事の総合興味スコアの算出
      const interestScore = calculateInterestScore(art.tags || [], art.importance || 1);

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
      newArticlesSaved.push(processedArticle);
      processedCount++;
    });

    console.log(`新着自律探索完了。新規保存件数: ${newArticlesSaved.length} 件`);

    // 5. 今回取得した記事 ＋ 過去に未通知の記事を統合してスコアリングランキングを作成
    const allPendingArticles = getUnnotifiedArticles();

    if (allPendingArticles.length === 0) {
      writeLog(functionName, 'success', '新規に配信するニュースはありませんでした。');
      return;
    }

    // 興味スコアの降順（高スコア順）でソート
    const sortedArticles = allPendingArticles.sort((a, b) => b.interest_score - a.interest_score);

    // 送信件数分スライス
    const topArticlesToNotify = sortedArticles.slice(0, notifyTopN);

    // 6. Gmail でプレミアムニュースレターとして配信
    if (topArticlesToNotify.length > 0) {
      sendDailyDigest(topArticlesToNotify);

      // ステータスを 'notified' に更新
      topArticlesToNotify.forEach(a => {
        updateArticleStatus(a.article_id, 'notified');
      });

      writeLog(functionName, 'success', `${topArticlesToNotify.length} 件の自律厳選ニュースを配信しました。`);
    } else {
      writeLog(functionName, 'success', '配信条件を満たす記事がありませんでした。');
    }

  } catch (error) {
    console.error("ETLジョブの実行中に重大なエラーが発生しました:", error);
    writeLog(functionName, 'error', `ETL Job Failure: ${error.message}`);
    sendErrorAlert(error.message);
    throw error;
  }
}

/**
 * 記事に関連付けられたタグと、ユーザーの興味プロファイルの重みを掛け合わせて、総合興味スコアを計算します。
 */
function calculateInterestScore(tags, importance) {
  const profile = getInterestProfileMap();
  
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

  const rows = sheet.getRange(2, 1, lastRow - 1, 15).getValues();
  rows.forEach(row => {
    // notified_at列（15列目 / インデックス14）が空、かつステータスが 'new'
    if (!row[14] && row[13].toString().trim() === 'new') {
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
        tags: row[9],
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
