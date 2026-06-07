/**
 * 自律型ニュース探索エージェントモジュール (SearchAgent.gs)
 * Gemini API の「Google検索グラウンディング (Google Search Tool)」を利用し、
 * インターネット全体から最新記事をリアルタイムに自動リサーチします。
 * 【最適化】複数検索クエリの自動生成と分散巡回ループを搭載。テーマの偏りを完全解決。
 */

/**
 * 興味タグとフォーカスドメインに基づいて、最新ニュースをGoogle検索経由で自律探索します。
 * @param {Array<string>} tags 探索対象の興味タグ配列
 * @param {Array<string>} focusDomains 優先的に巡回させたいドメイン・キーワード配列
 * @param {number} startTime dailyNewsJob開始時刻(ms) - 6分制限監視用
 * @param {number} maxExecutionMs 安全停止の閾値(ms)
 * @return {Array<Object>} 探索され、要約・分類された標準フォーマットの記事リスト
 */
function discoverNewsViaGoogleSearch(tags, focusDomains, startTime, maxExecutionMs) {
  const functionName = 'discoverNewsViaGoogleSearch';
  
  // 1. 興味タグ群から、複数の異なる「具体的でフォーカスされたGoogle検索用クエリ」を3個生成する
  let queries = [];
  try {
    queries = generateSearchQueries(tags);
  } catch(e) {
    console.error("検索クエリ生成エラー。フォールバックとしてデフォルトの検索を実行します:", e);
    // フォールバック: 重みの高い上位タグをスペース区切りで連結したクエリ
    queries = [tags.slice(0, 3).join(' ') + ' latest news'];
  }

  // 軽量モードの判定：クエリ数を削減
  const isLiteMode = PropertiesService.getScriptProperties().getProperty('LITE_MODE') === 'true';
  if (isLiteMode) {
    queries = queries.slice(0, 2);
    console.log('軽量モードで実行: クエリ数を2件に制限します。');
  }

  console.log("探索に使用するクエリ:", queries);
  let allDiscoveredArticles = [];

  // 2. 生成されたクエリを個別にGoogle検索ツール（グラウンディング）で実行
  queries.forEach((query, index) => {
    // 【6分制限ガード】残り60秒未満なら探索を安全に打ち切る
    if (startTime && maxExecutionMs) {
      const elapsed = Date.now() - startTime;
      if (elapsed > maxExecutionMs - 60000) {
        console.warn(`残り実行時間が60秒未満のため、クエリ[${index + 1}]以降の探索をスキップします。経過: ${Math.round(elapsed/1000)}秒`);
        return;
      }
    }
    try {
      console.log(`探索クエリ [${index + 1}/${queries.length}] 実行中: "${query}"`);
      const articles = executeSingleSearchQuery(query, focusDomains);
      allDiscoveredArticles = allDiscoveredArticles.concat(articles);
      
      // API制限の回避のためのインターバル（2秒に短縮）
      Utilities.sleep(2000);
    } catch(err) {
      console.error(`クエリ「${query}」での探索に失敗しました:`, err);
      writeLog(functionName, 'warning', `Search query [${query}] failed: ${err.message}`);
    }
  });

  // 3. 発見された全記事を、接続確認および正規化したURLに基づいて重複排除（ユニーク化）
  const seenUrls = new Set();
  const uniqueArticles = [];

  allDiscoveredArticles.forEach(art => {
    // 【安全制限】残り実行時間が60秒未満ならURL検証を打ち切る
    if (startTime && maxExecutionMs) {
      if (Date.now() - startTime > maxExecutionMs - 60000) {
        console.warn('残り時間がわずかなため、以降のURL検証をスキップします。');
        return;
      }
    }

    // URLの生存確認および最終遷移先URLの解決
    console.log(`URL検証中: ${art.url}`);
    const finalUrl = validateAndGetFinalUrl(art.url);
    if (!finalUrl) {
      console.warn(`アクセス不可または404のためURLを除外しました: ${art.url}`);
      return; // 除外
    }

    // 検証後のURLを反映
    art.url = finalUrl;
    const normUrl = normalizeUrl(art.url);

    if (!seenUrls.has(normUrl)) {
      seenUrls.add(normUrl);
      uniqueArticles.push(art);
      console.log(`URL検証成功 (有効): ${art.url}`);
    } else {
      console.log(`探索内重複URLを除外しました: ${art.url}`);
    }
  });

  console.log(`自律リサーチ全体で ${allDiscoveredArticles.length} 件の記事を発見、重複排除により ${uniqueArticles.length} 件に精選されました。`);
  return uniqueArticles;
}

/**
 * ユーザーの興味タグを分析し、Google検索用の最適な最新ニュース探索クエリを3個生成します。
 */
function generateSearchQueries(activeTags) {
  const apiKey = getGeminiApiKey();
  const modelName = 'gemini-3.5-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

  const todayStr = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd");

  const prompt = `あなたは非常に優秀なニュース検索クエリ生成エージェントです。
指示基準日「${todayStr}」において、以下のユーザーの興味タグに関する過去24時間以内の最新ニュース、重要なテックブログ、新技術発表をWeb上で発見するための、英語の具体的で明確な「Google検索用クエリ（検索窓に入力する文字列）」を正確に3個生成してください。

興味タグ：
${activeTags.join(', ')}

【生成のルール】：
1. タグごとに異なるテーマ（例: ゲーム、AIエージェント、半導体など）が均等にカバーされるよう、それぞれ独自の焦点を持ったクエリを作ってください。
2. 過去24時間の最新記事を探すため、"latest news 2026"、"new release 2026" などのワードや、具体的な業界トレンドワードを適切に含めてください。
3. 出力は必ず以下のJSONスキーマに従い、余計な説明文は一切含めないでください。`;

  const responseSchema = {
    type: "OBJECT",
    properties: {
      queries: {
        type: "ARRAY",
        items: { type: "STRING" },
        description: "Google検索窓に入力する具体的な検索用英文クエリ3個の配列"
      }
    },
    required: ["queries"]
  };

  const payload = {
    contents: [
      { parts: [{ text: prompt }] }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: responseSchema,
      temperature: 0.4
    }
  };

  const response = fetchWithRetry(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    throw new Error(`クエリ生成APIエラー: ${response.getContentText()}`);
  }

  const json = JSON.parse(response.getContentText());
  const resultText = json.candidates[0].content.parts[0].text;
  return JSON.parse(resultText).queries || [];
}

/**
 * 単一の検索クエリを用いて、Google検索グラウンディングによる記事探索と評価を1回実行します。
 */
function executeSingleSearchQuery(query, focusDomains) {
  const apiKey = getGeminiApiKey();
  const modelName = 'gemini-3.5-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

  const todayStr = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd");

  let prompt = `あなたは優秀な自律型ニュースリサーチエージェントです。
Google検索ツールを活用し、検索クエリ「${query}」について、基準日（${todayStr}）から過去24〜48時間以内にWebに公開された最新かつ有益な情報・記事・ニュースを発見してください。

■ 優先して結果から抽出・巡回すべきWebサイトやドメイン（あれば）：
${focusDomains.map(d => `- ${d}`).join('\n')}

【抽出・評価のルール】：
1. 信頼できる配信元の正確なWebページの「URL」および「サイト名（source）」を抜き出してください。URLは検索結果（Google Search grounding results）に表示されている実際のURLと一字一句違わずに正確に出力し、絶対にドメインなどからURLを予測・創作（ハルシネーション）しないでください。
2. その検索キーワードに関する最も新しく、ユーザーにとって付加価値の高い記事を最大6件精選してください。
3. 各記事のAI要約は、3行程度の簡潔な日本語箇条書きで分かりやすく要約してください。
4. なぜこの記事を読むべきか、何が面白いのかの選定理由を明快な日本語1文で作成してください。`;

  // 構造化出力スキーマ定義
  const articleSchema = {
    type: "OBJECT",
    properties: {
      title: { type: "STRING", description: "ニュース記事の正確なタイトル" },
      url: { type: "STRING", description: "ニュース記事の正確なWebページのフルURL（有効なURLであること）" },
      source: { type: "STRING", description: "ニュースの配信元・ウェブサイト名 (例: TechCrunch, PR TIMES 等)" },
      ai_summary: { type: "STRING", description: "核心的な内容を3行以内の簡潔な日本語箇条書きでまとめた要約" },
      category: { 
        type: "STRING", 
        enum: ["AI", "Game", "Business", "Tech", "Japan", "World", "Other"],
        description: "この記事に最も合致する大カテゴリ" 
      },
      tags: { 
        type: "ARRAY", 
        items: { type: "STRING" }, 
        description: "記事に関連するキーワードタグの配列（3個以内）" 
      },
      importance: { 
        type: "INTEGER", 
        description: "客観的重要度スコア（1から5、5が最高）" 
      },
      reason: { 
        type: "STRING", 
        description: "なぜこの記事を優先して読むべきかを示す日本語の1文" 
      }
    },
    required: ["title", "url", "source", "ai_summary", "category", "tags", "importance", "reason"]
  };

  const responseSchema = {
    type: "OBJECT",
    properties: {
      articles: {
        type: "ARRAY",
        items: articleSchema,
        description: "探索・発見されたニュース記事の一覧"
      }
    },
    required: ["articles"]
  };

  const payload = {
    contents: [
      { parts: [{ text: prompt }] }
    ],
    tools: [
      { googleSearch: {} }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: responseSchema,
      temperature: 0.3
    }
  };

  const response = fetchWithRetry(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    throw new Error(`Google検索グラウンディングに失敗しました (Status: ${responseCode}): ${responseText}`);
  }

  const json = JSON.parse(responseText);
  
  if (!json.candidates || json.candidates.length === 0 || !json.candidates[0].content) {
    throw new Error(`グラウンディングAPIから無効なレスポンスが返されました: ${responseText}`);
  }

  const resultText = json.candidates[0].content.parts[0].text;
  const parsedData = JSON.parse(resultText);

  return parsedData.articles || [];
}

/**
 * 一時的な通信エラーや429/503混雑制限が発生した際に、自動で指数バックオフ待機して再試行を行うラッパー関数です。
 * 無料プランのAPI制限に引っかかっても、自動で少し待ってから健気にリトライします。
 */
function fetchWithRetry(url, options, maxRetries = 3, initialDelayMs = 3000) {
  let delay = initialDelayMs;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = UrlFetchApp.fetch(url, options);
      const code = response.getResponseCode();
      
      if (code === 200) {
        return response;
      }
      
      // 429 (Quota Exceeded) や 503 (Unavailable) の一時的エラー
      if (code === 429 || code === 503) {
        if (i === maxRetries - 1) {
          return response; // リトライ上限に達した場合は諦めてそのまま返す（上位で詳細エラーを表示するため）
        }
        console.warn(`APIが一時的な制限に達しました (Status: ${code})。${delay / 1000}秒後に自動リトライします... (試行 ${i + 1}/${maxRetries})`);
        Utilities.sleep(delay);
        delay *= 2.5; // バックオフ時間を引き伸ばす (3s -> 7.5s -> 18.75s)
        continue;
      }
      
      return response; // その他のエラーは即時返して上位で検知させる
    } catch (e) {
      if (i === maxRetries - 1) {
        throw e;
      }
      console.warn(`通信エラーが発生しました: ${e.toString()}。${delay / 1000}秒後に自動リトライします... (試行 ${i + 1}/${maxRetries})`);
      Utilities.sleep(delay);
      delay *= 2.5;
    }
  }
  throw new Error("最大再試行回数を超過しました。");
}

/**
 * URLに実際にアクセスし、有効性（200 OK）の検証と、リダイレクト解決後の最終URLを取得します。
 * @param {string} url 検証対象のURL
 * @return {string|null} 有効な場合は最終URL、無効な場合は null
 */
function validateAndGetFinalUrl(url) {
  if (!url || typeof url !== 'string') return null;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return null;

  let currentUrl = url;
  const maxRedirects = 5;
  let redirectCount = 0;

  try {
    while (redirectCount < maxRedirects) {
      const response = UrlFetchApp.fetch(currentUrl, {
        method: 'get',
        followRedirects: false, // リダイレクトを自動追従せず手動で追従する
        muteHttpExceptions: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      const code = response.getResponseCode();

      // リダイレクト (3xx) の場合、Locationヘッダーから次のURLを取得
      if (code >= 300 && code < 400) {
        const headers = response.getHeaders();
        const nextUrl = headers['Location'] || headers['location'];
        if (nextUrl) {
          // 相対パスの解決
          if (!nextUrl.startsWith('http://') && !nextUrl.startsWith('https://')) {
            const match = currentUrl.match(/^(https?:\/\/[^\/]+)/);
            const domain = match ? match[1] : '';
            if (nextUrl.startsWith('/')) {
              currentUrl = domain + nextUrl;
            } else {
              const basePath = currentUrl.substring(0, currentUrl.lastIndexOf('/') + 1);
              currentUrl = basePath + nextUrl;
            }
          } else {
            currentUrl = nextUrl;
          }
          redirectCount++;
          continue;
        }
      }

      // 200番台は成功（検証通過）
      if (code >= 200 && code < 300) {
        return currentUrl;
      }

      console.warn(`URL検証失敗 (Status: ${code}): ${currentUrl}`);
      return null;
    }

    console.warn(`リダイレクト回数が上限に達しました: ${url}`);
    return null;
  } catch (e) {
    console.warn(`URL検証中に例外が発生しました (${currentUrl}): ${e.message}`);
    return null;
  }
}
