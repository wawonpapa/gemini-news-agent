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
  const MAX_EXECUTION_MS = 3 * 60 * 1000 + 30 * 1000; // 3分30秒（ハングアップ時の安全マージン）
  
  const props = PropertiesService.getScriptProperties();
  
  // 起動時の生存ハートビートを更新
  props.setProperty('LAST_ACTIVE_TIME', String(Date.now()));
  
  // ジョブ起動ごとにWatchdogトリガーを更新・再登録（分割実行時のトリガーリーク防止と監視継続）
  setupWatchdogTrigger_();
  
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
        props.setProperty('LAST_ACTIVE_TIME', String(Date.now())); // 生存ハートビートの更新
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
          props.setProperty('LAST_ACTIVE_TIME', String(Date.now())); // 生存ハートビートの更新
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

      // フィーチャーフラグの型安全チェック (Booleanチェックボックスおよび文字列 "TRUE" / "true" に対応)
      const enableAIDeduplication = settings.enable_ai_deduplication !== undefined && 
        String(settings.enable_ai_deduplication).toUpperCase() === 'TRUE';

      let topArticlesToNotify = [];
      const excludedIds = new Set();

      if (enableAIDeduplication) {
        // 重複排除用に、配信数（notifyTopN）の2.5倍（バッファ十分な30件程度を上限）を切り出す
        const candidateLimit = Math.min(sortedArticles.length, Math.ceil(notifyTopN * 2.5));
        const candidates = sortedArticles.slice(0, candidateLimit);
        
        console.log(`[AI重複排除] 有効です。上位 ${candidates.length} 件を重複チェックにかけます。`);
        
        const deduplicated = deduplicateArticlesViaAI(candidates, excludedIds);
        
        // 過剰除外セーフティネットの判定 (残ったユニーク記事数が notifyTopN / 2 を下回る場合はフォールバック)
        const minThreshold = Math.max(1, Math.floor(notifyTopN / 2));
        if (deduplicated.length < minThreshold) {
          console.warn(`[AI重複排除] 重複除外後の記事数 (${deduplicated.length}件) が閾値 (${minThreshold}件) を下回りました。過剰判定とみなして従来のソート配信へフォールバックします。`);
          writeLog(functionName, 'warning', `Deduplication returned too few articles (${deduplicated.length}). Falling back to simple sort.`);
          topArticlesToNotify = sortedArticles.slice(0, notifyTopN);
          excludedIds.clear(); // 除外リストもクリア
        } else {
          // 残り（candidateLimit以降）の記事から、重複排除で除外されたものをフィルターして結合
          const remainingArticles = sortedArticles.slice(candidateLimit).filter(art => !excludedIds.has(art.article_id));
          const finalMerged = deduplicated.concat(remainingArticles);
          topArticlesToNotify = finalMerged.slice(0, notifyTopN);
        }
      } else {
        console.log(`[AI重複排除] 無効です。従来の単純ソートで配信します。`);
        topArticlesToNotify = sortedArticles.slice(0, notifyTopN);
      }

      if (topArticlesToNotify.length > 0) {
        console.log(`上位${topArticlesToNotify.length}件の記事をGmailで配信します。`);
        sendDailyDigest(topArticlesToNotify);

        // 配信済み記事のステータスを一括更新 (notified)
        const notifiedIds = topArticlesToNotify.map(a => a.article_id);
        updateArticlesStatusBatch(notifiedIds, 'notified');

        // 重複除外された記事（今回の配信対象に入り、かつ除外対象となったもの）を 'duplicated' に一括更新
        if (excludedIds.size > 0) {
          // excludedIds のうち、最終的に 'notified' にならなかったものを 'duplicated' に更新
          const actualExcludedIds = Array.from(excludedIds).filter(id => !notifiedIds.includes(id));
          if (actualExcludedIds.length > 0) {
            updateArticlesStatusBatch(actualExcludedIds, 'duplicated');
          }
        }

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
  props.deleteProperty('LAST_ACTIVE_TIME');
  props.deleteProperty('WATCHDOG_RECOVERY_COUNT');
  clearJobTriggers_();
  clearWatchdogTrigger_(); // 正常終了時にWatchdogトリガーを削除
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
    if (handler === 'dailyNewsJobRetry' || handler === 'dailyNewsJobWatchdog') {
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

/**
 * Watchdog（監視用）トリガーを登録します。
 */
function setupWatchdogTrigger_() {
  const props = PropertiesService.getScriptProperties();
  
  // 既存のWatchdogトリガーがあれば先にクリーンアップして重複を防ぐ
  clearWatchdogTrigger_();
  
  // 30分後に監視するトリガーを登録
  const trigger = ScriptApp.newTrigger('dailyNewsJobWatchdog')
    .timeBased()
    .after(30 * 60 * 1000)
    .create();
    
  props.setProperty('WATCHDOG_TRIGGER_ID', trigger.getUniqueId());
  console.log(`Watchdogトリガーを登録しました (ID: ${trigger.getUniqueId()})`);
}

/**
 * Watchdogトリガーを削除します。
 */
function clearWatchdogTrigger_() {
  const props = PropertiesService.getScriptProperties();
  const triggerId = props.getProperty('WATCHDOG_TRIGGER_ID');
  if (!triggerId) return;

  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getUniqueId() === triggerId) {
      try {
        ScriptApp.deleteTrigger(t);
        console.log(`Watchdogトリガーを削除しました: ${t.getUniqueId()}`);
      } catch (e) {
        console.warn(`Watchdogトリガー削除に失敗: ${e.message}`);
      }
    }
  });
  props.deleteProperty('WATCHDOG_TRIGGER_ID');
}

/**
 * 30分間ジョブが完了しなかった場合に異常終了とみなし、
 * 原因URLを1件除外してジョブを再始動するWatchdogシステム。
 */
function dailyNewsJobWatchdog() {
  const functionName = 'dailyNewsJobWatchdog';
  const props = PropertiesService.getScriptProperties();
  const state = props.getProperty('JOB_STATE');
  
  console.log(`[Watchdog] 監視起動。現在のステート: ${state}`);
  
  // 自身のトリガー情報を先にクリア (トリガーは1回限りなので実行後に自動消滅するが、登録プロパティを確実に削除)
  clearWatchdogTrigger_();

  if (!state) {
    console.log("[Watchdog] ジョブは既に正常終了しています。何もしません。");
    // 正常終了している場合はリカバリーカウントもクリアしておく
    props.deleteProperty('WATCHDOG_RECOVERY_COUNT');
    return;
  }

  // 1. 生存ハートビートによるFalse Positive (誤判定) 回避
  const lastActiveStr = props.getProperty('LAST_ACTIVE_TIME');
  if (lastActiveStr) {
    const lastActive = parseInt(lastActiveStr, 10);
    const quietTime = Date.now() - lastActive;
    if (quietTime < 8 * 60 * 1000) { // 8分以内に何らかの動きがあった場合はまだ実行中とみなす
      console.log(`[Watchdog] ジョブは最近アクティブでした (最終アクティブ: ${Math.round(quietTime/1000)}秒前)。Watchdogを再スケジュールします。`);
      setupWatchdogTrigger_();
      return;
    }
  }

  // 2. 無限復旧ループの防止 (連続3回ハングアップ時はメール通知して異常終了)
  let recoveryCount = parseInt(props.getProperty('WATCHDOG_RECOVERY_COUNT') || '0', 10);
  if (recoveryCount >= 3) {
    const errorMsg = `Watchdogによる自動復旧が連続で3回失敗しました。無応答のURLが複数存在するか、重大なシステム障害の可能性があります。自動実行を停止します。`;
    console.error(`[Watchdog] ${errorMsg}`);
    writeLog(functionName, 'error', errorMsg);
    sendErrorAlert(errorMsg);
    
    // 状態をクリアして終了
    cleanUpJobState_();
    return;
  }

  // 3. 未検証URL (pending) が存在するかチェック
  const pendingArticles = getArticlesByStatus('pending');
  if (pendingArticles.length === 0) {
    console.warn("[Watchdog] ジョブは未完了ですが、検証待ちURLはありません。状態をクリアして終了します。");
    cleanUpJobState_();
    return;
  }

  // 4. ハングアップの原因とみられる最古のpending記事を特定して除外
  const culprit = pendingArticles[0]; // 最古の1件
  console.warn(`[Watchdog] 異常終了を検知。ハングアップ原因URLと推測される記事を除外します: ${culprit.url}`);
  
  // ログに記録
  writeLog(functionName, 'error', `Watchdog detected hang. Excluding culprit URL: ${culprit.url}`);
  
  // スプレッドシートから物理削除
  deleteArticleRow(culprit.article_id);

  // 5. 復旧カウンタをインクリメント
  props.setProperty('WATCHDOG_RECOVERY_COUNT', String(recoveryCount + 1));

  // 6. トリガーの競合を防ぐため、1分後再開トリガーを一旦クリア
  clearJobTriggers_();

  // 7. ジョブを再始動
  console.log("[Watchdog] ジョブを再始動します...");
  try {
    dailyNewsJob();
  } catch (e) {
    console.error("[Watchdog] 再始動されたジョブの呼び出しでエラーが発生しました:", e);
  }
}

/**
 * Watchdogの復旧・自動除外機能の動作検証用テスト関数。
 */
function testWatchdogRecovery() {
  console.log("--- Watchdog復旧テスト開始 ---");
  const props = PropertiesService.getScriptProperties();
  
  // 1. 状態の完全リセット
  resetJobState();
  
  // 2. 擬似的なクラッシュ状態の再現
  // JOB_STATE を VALIDATING に設定
  props.setProperty('JOB_STATE', 'VALIDATING');
  props.setProperty('LITE_MODE', 'true'); // テストのためLITE_MODEをONに
  
  // 最後にアクティブだった時刻を10分前に設定 (Watchdogの誤判定回避ロジックをすり抜けるため)
  const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
  props.setProperty('LAST_ACTIVE_TIME', String(tenMinutesAgo));
  
  // 3. テスト用のダミー記事（pending）をスプレッドシートに追加
  // 1件目はハングアップ原因となる無効なURL、2件目は有効なURL
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('articles');
  if (!sheet) {
    console.error("articlesシートが見つかりません。");
    return;
  }
  
  const dummyCulprit = {
    article_id: "dummy_culprit_id",
    published_at: "2026/06/28",
    source: "Dummy Culprit Site",
    title: "Watchdog Test: This article causes hang",
    url: "https://httpstat.us/timeout", // タイムアウトを起こしそうな無効URL
    ai_summary: "テスト用ダミーURL",
    category: "Tech",
    tags: ["Test"],
    importance: 3,
    interest_score: 50,
    reason: "Watchdogテスト用のダミーURLです。",
    status: "pending"
  };
  
  const dummyValid = {
    article_id: "dummy_valid_id",
    published_at: "2026/06/28",
    source: "Dummy Valid Site",
    title: "Watchdog Test: This article is valid",
    url: "https://news.ycombinator.com/", // 有効なURL
    ai_summary: "テスト用有効ダミーURL",
    category: "Tech",
    tags: ["Test"],
    importance: 3,
    interest_score: 55,
    reason: "Watchdogテスト用のダミーURLです。",
    status: "pending"
  };
  
  console.log("テスト用ダミーデータを pending で保存します...");
  saveArticle(dummyCulprit);
  saveArticle(dummyValid);
  
  console.log("準備完了。Watchdog関数を手動で起動します。");
  console.log("期待される動作: 'dummy_culprit_id' の行が物理削除され、ジョブが再起動し、'dummy_valid_id' の検証（およびLITE_MODEによる配信）が実行されること。");
  
  try {
    dailyNewsJobWatchdog();
    
    // 実行後の状態を確認
    const finalState = props.getProperty('JOB_STATE');
    const recoveryCount = props.getProperty('WATCHDOG_RECOVERY_COUNT');
    console.log(`Watchdog実行後のステータス:`);
    console.log(`- JOB_STATE: ${finalState}`);
    console.log(`- WATCHDOG_RECOVERY_COUNT: ${recoveryCount}`);
    
    // スプレッドシート上に dummyCulprit が消えているか確認
    const remainingCulprit = getArticleById("dummy_culprit_id");
    console.log(`- 原因記事 (dummy_culprit_id) の存在: ${remainingCulprit ? "残っている (FAIL)" : "削除された (PASS)"}`);
    
    // 有効な記事 dummyValid が new または notified になっているか確認
    const remainingValid = getArticleById("dummy_valid_id");
    if (remainingValid) {
      console.log(`- 有効記事 (dummy_valid_id) のステータス: ${remainingValid.status} (${remainingValid.status !== 'pending' ? "PASS" : "FAIL"})`);
    } else {
      console.log(`- 有効記事 (dummy_valid_id) の存在: 削除された（検証失敗または配信完了により notified）`);
    }
    
  } catch (e) {
    console.error("テスト実行中にエラーが発生しました:", e);
  } finally {
    // クリーンアップ
    resetJobState();
    deleteArticleRow("dummy_culprit_id");
    deleteArticleRow("dummy_valid_id");
  }
}

/**
 * AI重複排除機能の動作検証用テスト関数。
 */
function testAIDeduplication() {
  console.log("--- AI重複排除テスト開始 ---");
  
  const testArticles = [
    {
      article_id: "dummy_a",
      title: "GoogleがGemini 1.5 Flashを公開。開発効率を大幅向上",
      source: "TechNews JP",
      category: "Tech",
      ai_summary: "Googleが新しい高速・軽量なAIモデルであるGemini 1.5 Flashを発表したことを報じています。"
    },
    {
      article_id: "dummy_b",
      title: "Google、新世代の高速AIモデル『Gemini 1.5 Flash』を発表",
      source: "IT Media Blog",
      category: "Tech",
      ai_summary: "Googleの新AIモデル「Gemini 1.5 Flash」がリリースされ、開発者向けAPIが公開されました。"
    },
    {
      article_id: "dummy_c",
      title: "NVIDIAの新型GPU、来月にいよいよリリースへ",
      source: "Gamer Tech",
      category: "Tech",
      ai_summary: "NVIDIAが次世代グラフィックカードの発売日を来月に決定したというリーク情報です。"
    },
    {
      article_id: "dummy_d",
      title: "次世代グラフィックボードとなるNVIDIA新型GPUの発売時期がリークされる",
      source: "Hardware JP",
      category: "Tech",
      ai_summary: "NVIDIAが来月発売する予定 of 新型GPUに関するスペックとリリーススケジュールについてのリーク。"
    },
    {
      article_id: "dummy_e",
      title: "東京でいま最も熱い、激ウマ塩ラーメン店10選",
      source: "グルメジャーナル",
      category: "Other",
      ai_summary: "東京都内のおすすめ塩ラーメン店を厳選して10店舗紹介したまとめ記事です。"
    }
  ];

  const excludedIds = new Set();
  console.log("テストデータをAI重複排除に送信します...");
  
  try {
    const result = deduplicateArticlesViaAI(testArticles, excludedIds);
    
    console.log("=== 重複排除結果 ===");
    console.log(`- 送信前の記事数: ${testArticles.length} 件`);
    console.log(`- 重複排除後の記事数: ${result.length} 件`);
    console.log(`- 除外された記事ID:`, Array.from(excludedIds));
    
    // 検証
    const isGeminiDupRemoved = excludedIds.has("dummy_a") || excludedIds.has("dummy_b");
    const isNvidiaDupRemoved = excludedIds.has("dummy_c") || excludedIds.has("dummy_d");
    const isRamenKept = !excludedIds.has("dummy_e");
    
    console.log(`- Googleの重複記事がどちらか一方除外されたか: ${isGeminiDupRemoved ? "PASS" : "FAIL"}`);
    console.log(`- NVIDIAの重複記事がどちらか一方除外されたか: ${isNvidiaDupRemoved ? "PASS" : "FAIL"}`);
    console.log(`- ラーメン記事（独立トピック）が除外されずに残ったか: ${isRamenKept ? "PASS" : "FAIL"}`);
    
    if (isGeminiDupRemoved && isNvidiaDupRemoved && isRamenKept) {
      console.log("【総合結果】AI重複排除テスト：PASS");
    } else {
      console.log("【総合結果】AI重複排除テスト：FAIL");
    }
    
  } catch (e) {
    console.error("AI重複排除テスト中にエラーが発生しました:", e);
  }
}


