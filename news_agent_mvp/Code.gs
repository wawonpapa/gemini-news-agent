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
  const startTime = Date.now();
  const MAX_EXECUTION_MS = 4 * 60 * 1000 + 30 * 1000; // 4分30秒（安全マージン）
  
  const props = PropertiesService.getScriptProperties();
  let state = props.getProperty('JOB_STATE');

  try {
    if (!state) {
      // ----------------------------------------------------
      // 【フェーズ1: 初期化】
      // ----------------------------------------------------
      writeLog(functionName, 'running', '日次ニュースジョブの初期化を開始します。');
      
      // スプレッドシートから現在の「興味タグ」および「優先ドメイン」を読み込む
      const profileMap = getInterestProfileMap();
      
      // 重みが 3 以上のタグをメイン探索キーワードとし、重みの降順（高い順）でソート
      const sortedActiveTags = Object.keys(profileMap)
        .filter(tag => profileMap[tag] >= 3)
        .sort((a, b) => profileMap[b] - profileMap[a]);
      
      // 上位15件に制限
      const topActiveTags = sortedActiveTags.slice(0, 15);
      const lowScoreTags = Object.keys(profileMap).filter(tag => profileMap[tag] >= 1 && profileMap[tag] < 3);

      if (topActiveTags.length === 0 && lowScoreTags.length === 0) {
        writeLog(functionName, 'warning', '有効な興味タグが登録されていません。ジョブを休止します。');
        return;
      }

      // AIに渡す重み付きタグリストを構築
      let selectedTags = topActiveTags.map(tag => ({ tag: tag, weight: profileMap[tag] }));

      // 確率的ブレンド (20%の確率で低スコアタグから1つブレンドする)
      const BLEND_PROBABILITY = 0.20;
      if (lowScoreTags.length > 0 && Math.random() < BLEND_PROBABILITY) {
        const randomIndex = Math.floor(Math.random() * lowScoreTags.length);
        const blendTag = lowScoreTags[randomIndex];
        selectedTags.push({ tag: blendTag, weight: profileMap[blendTag] });
      }

      // 30個のクエリを生成
      let queries = [];
      try {
        queries = generateSearchQueries(selectedTags);
      } catch(e) {
        console.error("検索クエリ生成エラー。フォールバックとしてデフォルトの検索を実行します:", e);
        const fallbackTagNames = selectedTags.map(t => t.tag);
        queries = [fallbackTagNames.slice(0, 3).join(' ') + ' latest news'];
      }

      // 軽量モード判定による制限
      const isLiteMode = props.getProperty('LITE_MODE') === 'true';
      if (isLiteMode) {
        queries = queries.slice(0, 5);
      }

      // 状態を保存して検索フェーズへ
      props.setProperty('GENERATED_QUERIES', JSON.stringify(queries));
      props.setProperty('PROCESSED_QUERY_INDEX', '0');
      props.setProperty('JOB_STATE', 'SEARCHING');
      state = 'SEARCHING';
      
      console.log(`初期化完了。クエリ数: ${queries.length}件。探索を開始します。`);
    }

    // ----------------------------------------------------
    // 【フェーズ2: 検索フェーズ】
    // ----------------------------------------------------
    if (state === 'SEARCHING') {
      const queries = JSON.parse(props.getProperty('GENERATED_QUERIES') || '[]');
      let startIndex = parseInt(props.getProperty('PROCESSED_QUERY_INDEX') || '0', 10);
      const focusDomains = getFocusDomains();
      
      const settings = getSettingsMap();
      const dailyLimit = parseInt(settings.daily_limit) || 30;

      // キャッシュSetの取得 (DBの全登録記事IDを1回の呼び出しでロード)
      const existingIds = getAllArticleIdsSet();
      const cachedProfileMap = getInterestProfileMap();

      console.log(`探索再開: クエリインデックス ${startIndex}/${queries.length} から開始します。`);

      for (let i = startIndex; i < queries.length; i++) {
        // 制限時間チェック
        if (Date.now() - startTime > MAX_EXECUTION_MS) {
          props.setProperty('PROCESSED_QUERY_INDEX', String(i));
          setupNextTrigger_();
          writeLog(functionName, 'warning', `探索時間切れ。インデックス ${i}/${queries.length} で中断し、1分後に再起動します。`);
          return;
        }

        const query = queries[i];
        try {
          console.log(`クエリ [${i + 1}/${queries.length}] 実行中: "${query}"`);
          const articles = executeSingleSearchQuery(query, focusDomains);
          
          let savedInQuery = 0;
          articles.forEach(art => {
            const articleId = makeArticleId(art.url);
            if (existingIds.has(articleId)) {
              return;
            }

            const interestScore = calculateInterestScore(art.tags || [], art.importance || 1, cachedProfileMap);

            // 【Issue #34】5日以上前の古いニュースは最初から保存しない
            if (isArticleTooOld(art.published_at, 5)) {
              console.log(`[古いニュース除外] 5日以上前の記事のためスキップします: "${art.title}" (${art.published_at})`);
              return;
            }

            const processedArticle = {
              article_id: articleId,
              title: art.title,
              url: art.url,
              source: art.source,
              author: art.author || '',
              published_at: art.published_at || new Date().toISOString(),
              ai_summary: art.ai_summary,
              category: art.category,
              tags: art.tags,
              importance: art.importance,
              interest_score: interestScore,
              reason: art.reason,
              status: 'pending' // 生存確認を後回しにし、バッファとして保存
            };

            saveArticle(processedArticle);
            existingIds.add(articleId);
            savedInQuery++;
          });
          
          console.log(`クエリ [${i + 1}] から新規保存: ${savedInQuery}件 (ステータス: pending)`);
          Utilities.sleep(2000);
        } catch (err) {
          console.error(`クエリ「${query}」での探索に失敗しました:`, err);
          writeLog(functionName, 'warning', `Search query [${query}] failed: ${err.message}`);
        }

        props.setProperty('PROCESSED_QUERY_INDEX', String(i + 1));
      }

      // 検索完了
      props.deleteProperty('GENERATED_QUERIES');
      props.deleteProperty('PROCESSED_QUERY_INDEX');
      props.setProperty('JOB_STATE', 'VALIDATING');
      state = 'VALIDATING';
      console.log("すべての検索が完了しました。URL検証フェーズへ移行します。");
    }

    // ----------------------------------------------------
    // 【フェーズ3: URL検証フェーズ】
    // ----------------------------------------------------
    if (state === 'VALIDATING') {
      console.log("URL検証フェーズを開始/再開します。");
      
      const pendingArticles = getArticlesByStatus('pending');
      console.log(`未検証の記事数: ${pendingArticles.length}件`);

      if (pendingArticles.length > 0) {
        for (let i = 0; i < pendingArticles.length; i++) {
          // 制限時間チェック
          if (Date.now() - startTime > MAX_EXECUTION_MS) {
            setupNextTrigger_();
            writeLog(functionName, 'warning', `検証時間切れ。残り ${pendingArticles.length - i} 件で中断し、1分後に再起動します。`);
            return;
          }

          const art = pendingArticles[i];
          console.log(`検証中: ${art.url}`);
          const finalUrl = validateAndGetFinalUrl(art.url);
          
          if (finalUrl) {
            updateArticleUrlAndStatus(art.article_id, finalUrl, 'new');
            console.log(`検証成功 (有効): ${finalUrl}`);
          } else {
            deleteArticleRow(art.article_id);
            console.warn(`検証失敗 (アクセス不可または404): ${art.url}`);
          }
        }
      }

      // 全検証完了
      props.setProperty('JOB_STATE', 'DELIVERING');
      state = 'DELIVERING';
      console.log("すべてのURL検証が完了しました。配信フェーズへ移行します。");
    }

    // ----------------------------------------------------
    // 【フェーズ4: 配信フェーズ】
    // ----------------------------------------------------
    if (state === 'DELIVERING') {
      writeLog(functionName, 'running', 'ニュースの配信処理を開始します。');

      const settings = getSettingsMap();
      const notifyTopN = parseInt(settings.notify_top_n) || 10;

      const allPendingArticles = getUnnotifiedArticles();

      if (allPendingArticles.length === 0) {
        writeLog(functionName, 'success', '新規に配信するニュースはありませんでした。');
        cleanUpJobState_();
        return;
      }

      const sortedArticles = allPendingArticles.sort((a, b) => b.interest_score - a.interest_score);
      const topArticlesToNotify = sortedArticles.slice(0, notifyTopN);

      if (topArticlesToNotify.length > 0) {
        console.log(`上位${topArticlesToNotify.length}件の記事をGmailで配信します。`);
        sendDailyDigest(topArticlesToNotify);

        topArticlesToNotify.forEach(a => {
          updateArticleStatus(a.article_id, 'notified');
        });

        writeLog(functionName, 'success', `${topArticlesToNotify.length} 件の自律厳選ニュースを配信しました。`);
      } else {
        writeLog(functionName, 'success', '配信条件を満たす記事がありませんでした。');
      }

      cleanUpJobState_();
    }

  } catch (error) {
    console.error("ETLジョブの実行中に重大なエラーが発生しました:", error);
    writeLog(functionName, 'error', `ETL Job Failure: ${error.message}`);
    sendErrorAlert(error.message);
    
    // エラー時は状態をクリアしてリトリガーによる無限ループを防止
    cleanUpJobState_();
    throw error;
  }
}

/**
 * 次のステップ実行用の1回限りトリガーを登録します。
 */
function setupNextTrigger_() {
  const props = PropertiesService.getScriptProperties();
  
  // 既存の動的トリガーを削除
  clearJobTriggers_();
  
  // 1分後に再開するトリガーを登録
  const trigger = ScriptApp.newTrigger('dailyNewsJob')
    .timeBased()
    .after(1 * 60 * 1000)
    .create();
    
  props.setProperty('NEXT_RUN_TRIGGER_ID', trigger.getUniqueId());
  console.log(`一時再開トリガーを登録しました (ID: ${trigger.getUniqueId()})`);
}

/**
 * 分割実行用の一時トリガーを削除します。
 */
function clearJobTriggers_() {
  const props = PropertiesService.getScriptProperties();
  const triggerId = props.getProperty('NEXT_RUN_TRIGGER_ID');
  if (!triggerId) return;

  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getUniqueId() === triggerId) {
      try {
        ScriptApp.deleteTrigger(t);
        console.log(`動的分割トリガーを削除しました: ${t.getUniqueId()}`);
      } catch (e) {
        console.warn(`トリガー削除に失敗: ${e.message}`);
      }
    }
  });
  props.deleteProperty('NEXT_RUN_TRIGGER_ID');
}

/**
 * ジョブのスクリプトプロパティと動的トリガーをクリーンアップします。
 */
function cleanUpJobState_() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('JOB_STATE');
  props.deleteProperty('GENERATED_QUERIES');
  props.deleteProperty('PROCESSED_QUERY_INDEX');
  props.deleteProperty('LITE_MODE'); // テスト用の軽量モードプロパティも確実にクリーンアップ
  clearJobTriggers_();
  cleanupOldLogs();
}


/**
 * 分割実行ジョブの状態を完全にリセットするデバッグ用関数。
 * テスト実行前や、途中で失敗してトリガーが残ってしまった場合に手動実行します。
 */
function resetJobState() {
  console.log("ジョブ状態の完全リセットを開始します...");
  cleanUpJobState_();
  
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('LITE_MODE');
  props.deleteProperty('RETRY_PENDING');
  
  // 残存する古いトリガーも走査してクリーンアップ
  ScriptApp.getProjectTriggers().forEach(t => {
    const handler = t.getHandlerFunction();
    if (handler === 'dailyNewsJobRetry') {
      try {
        ScriptApp.deleteTrigger(t);
        console.log(`残存していた ${handler} トリガーを削除しました。`);
      } catch (e) {
        console.warn(`トリガー削除に失敗: ${e.message}`);
      }
    }
  });
  console.log("ジョブ状態のリセットが完了しました。");
}

/**
 * 分割実行（ステートフル）ジョブのシミュレーションテストを実行します。
 * 軽量モード (LITE_MODE=true) にして、クエリ数を5個に制限した上でジョブの初期フェーズを実行します。
 */
function testStatefulJob() {
  console.log("--- 分割実行テスト開始 ---");
  const props = PropertiesService.getScriptProperties();
  
  // 状態を一旦リセット
  resetJobState();
  
  // 軽量モード（5クエリ）を強制設定
  props.setProperty('LITE_MODE', 'true');
  console.log("LITE_MODE を true に設定しました。");
  
  try {
    console.log("ステップ 1: ジョブの初回実行を開始します...");
    dailyNewsJob();
    
    const state = props.getProperty('JOB_STATE');
    const nextTriggerId = props.getProperty('NEXT_RUN_TRIGGER_ID');
    const processedIndex = props.getProperty('PROCESSED_QUERY_INDEX');
    
    console.log(`ステップ 1 完了時の状態:`);
    console.log(`- JOB_STATE: ${state}`);
    console.log(`- PROCESSED_QUERY_INDEX: ${processedIndex}`);
    console.log(`- NEXT_RUN_TRIGGER_ID (1分後リトリガー): ${nextTriggerId || 'なし'}`);
    
  } catch (e) {
    console.error("テスト実行エラー:", e);
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

/**
 * Issue #25 の動作検証用テスト関数。
 * 特定のニュースURLを手動で解析し、日付 (published_at) が正しく抽出・保存されるかをログ出力します。
 */
function testNewsAnalysis() {
  const testUrl = "https://cloud.google.com/blog/products/ai-machine-learning/gemini-1-5-pro-and-gemini-1-5-flash-are-generally-available";
  console.log(`テスト開始: URL「${testUrl}」の解析を実行します。`);
  
  try {
    const finalUrl = validateAndGetFinalUrl(testUrl);
    if (!finalUrl) {
      console.error("URL検証失敗、またはアクセス不可です。");
      return;
    }
    
    // 実際に本文を取得（またはGoogle Search Grounding）してGeminiで解析
    const analyzed = analyzeRegisteredNews(finalUrl, "", "", "テストコメント");
    console.log("--- 解析結果 ---");
    console.log(`タイトル: ${analyzed.title}`);
    console.log(`配信元: ${analyzed.source}`);
    console.log(`抽出された公開日 (published_at): ${analyzed.published_at}`);
    console.log(`要約: ${analyzed.ai_summary}`);
    console.log(`カテゴリ: ${analyzed.category}`);
    console.log(`タグ: ${analyzed.tags ? analyzed.tags.join(', ') : 'なし'}`);
    console.log(`重要度: ${analyzed.importance}`);
    console.log(`選定理由: ${analyzed.reason}`);
    
  } catch (err) {
    console.error("テスト実行中にエラーが発生しました:", err);
  }
}

/**
 * Issue #32 の動作検証用テスト関数。
 * 重み付き興味タグリストから、優先度と確率的ブレンドをシミュレーションして検索クエリを生成させます。
 */
function testQueryGenerationWithWeights() {
  console.log("--- 重み付きクエリ生成テスト開始 ---");
  
  // テスト用のダミーの興味プロファイルマップ (高スコア8個、低スコア3個)
  const dummyProfileMap = {
    "AI": 9,
    "Google Gemini": 8,
    "PlayStation 6": 7,
    "Virtual Reality": 6,
    "Next.js": 5,
    "TypeScript": 5,
    "Cloudflare": 4,
    "Docker": 3,
    "Isaac GR00T": 2, // 低スコアタグ（以前の問題のタグ）
    "ラーメン": 1, // 低スコアタグ
    "英語学習": 1  // 低スコアタグ
  };

  const sortedActiveTags = Object.keys(dummyProfileMap)
    .filter(tag => dummyProfileMap[tag] >= 3)
    .sort((a, b) => dummyProfileMap[b] - dummyProfileMap[a]);
  
  // 上位15件制限 (テストでは全8件が含まれる)
  const topActiveTags = sortedActiveTags.slice(0, 15);
  const lowScoreTags = Object.keys(dummyProfileMap).filter(tag => dummyProfileMap[tag] >= 1 && dummyProfileMap[tag] < 3);

  console.log(`高スコアタグ (>=3, ソート・上位15件): ${topActiveTags.join(', ')}`);
  console.log(`低スコアタグ (1-2): ${lowScoreTags.join(', ')}`);

  // パターン1: 高スコアのみ
  console.log("\n[パターン1: 高スコアタグのみ]");
  let selectedTags1 = topActiveTags.map(tag => ({ tag: tag, weight: dummyProfileMap[tag] }));
  console.log("入力タグ:", selectedTags1);
  try {
    const queries1 = generateSearchQueries(selectedTags1);
    console.log("生成されたクエリ:", queries1);
  } catch (e) {
    console.error("エラー:", e);
  }

  // パターン2: 低スコアタグ（Isaac GR00Tなど）を1つ強制ブレンド
  console.log("\n[パターン2: 低スコアタグを1つ強制ブレンド]");
  let selectedTags2 = topActiveTags.map(tag => ({ tag: tag, weight: dummyProfileMap[tag] }));
  if (lowScoreTags.length > 0) {
    const blendTag = "Isaac GR00T"; // テスト用に固定してブレンド
    selectedTags2.push({ tag: blendTag, weight: dummyProfileMap[blendTag] });
  }
  console.log("入力タグ:", selectedTags2);
  try {
    const queries2 = generateSearchQueries(selectedTags2);
    console.log("生成されたクエリ:", queries2);
  } catch (e) {
    console.error("エラー:", e);
  }
}

/**
 * 記事の公開日が指定日数（デフォルト5日）以上前かどうかを判定します。
 * @param {string} publishedAtStr "yyyy/MM/dd" 形式などの日付文字列
 * @param {number} maxDaysAgo 許容する最大日数（デフォルト5）
 * @return {boolean} 指定日数以上前の場合は true、そうでない場合は false。パースできない場合は false
 */
function isArticleTooOld(publishedAtStr, maxDaysAgo) {
  const daysLimit = (maxDaysAgo === undefined) ? 5 : maxDaysAgo;
  if (!publishedAtStr || typeof publishedAtStr !== 'string') return false;

  try {
    // 全角英数字を半角に変換、および区切り文字の正規化
    let cleanStr = publishedAtStr
      .replace(/[０-９]/g, function(s) {
        return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
      })
      .replace(/年|月/g, '/')
      .replace(/日/g, '')
      .replace(/-/g, '/')
      .trim();

    // 日付だけを抽出 (時間部分を除去)
    cleanStr = cleanStr.split(' ')[0];

    const publishedDate = new Date(cleanStr);
    if (isNaN(publishedDate.getTime())) {
      console.warn(`[日付パース不可] "${publishedAtStr}" を日付オブジェクトに変換できませんでした。除外をスキップします。`);
      return false;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const articleDate = new Date(publishedDate);
    articleDate.setHours(0, 0, 0, 0);

    const diffTime = today.getTime() - articleDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays >= daysLimit) {
      return true;
    }
  } catch (e) {
    console.warn(`[日付検証エラー] ${publishedAtStr} の検証中にエラー: ${e.message}`);
  }
  return false;
}

/**
 * isArticleTooOld 関数の動作テスト用デバッグ関数。
 */
function testIsArticleTooOld() {
  const formatDate = (date) => {
    return Utilities.formatDate(date, "Asia/Tokyo", "yyyy/MM/dd");
  };

  const getPastDateStr = (daysAgo) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return formatDate(d);
  };

  console.log("--- 日付フィルターテスト開始 (閾値: 5日) ---");
  
  const testCases = [
    { label: "今日", val: getPastDateStr(0), expected: false },
    { label: "3日前", val: getPastDateStr(3), expected: false },
    { label: "4日前", val: getPastDateStr(4), expected: false },
    { label: "5日前 (境界値)", val: getPastDateStr(5), expected: true },
    { label: "10日前", val: getPastDateStr(10), expected: true },
    { label: "空文字 (不明)", val: "", expected: false },
    { label: "無効な日付形式", val: "invalid-date-string", expected: false },
    { label: "日本語表記 (3日前)", val: "", expected: false },
  ];

  testCases.forEach(tc => {
    let val = tc.val;
    if (tc.label.startsWith("日本語表記")) {
      const parts = getPastDateStr(3).split('/');
      val = `${parts[0]}年${parts[1]}月${parts[2]}日`;
    }
    
    const result = isArticleTooOld(val, 5);
    const pass = result === tc.expected;
    console.log(`[${pass ? "PASS" : "FAIL"}] 入力: "${val}" (${tc.label}) -> 判定: ${result} (期待値: ${tc.expected})`);
  });
}
