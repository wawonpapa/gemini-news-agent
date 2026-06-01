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
 * @return {Array<Object>} 探索され、要約・分類された標準フォーマットの記事リスト
 */
function discoverNewsViaGoogleSearch(tags, focusDomains) {
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

  console.log("探索に使用するクエリ:", queries);
  let allDiscoveredArticles = [];

  // 2. 生成された3つのクエリを個別にGoogle検索ツール（グラウンディング）で実行
  queries.forEach((query, index) => {
    try {
      console.log(`探索クエリ [${index + 1}/3] 実行中: "${query}"`);
      const articles = executeSingleSearchQuery(query, focusDomains);
      allDiscoveredArticles = allDiscoveredArticles.concat(articles);
      
      // API制限の回避およびGAS実行保護のための10秒間の十分なインターバル（無料枠対策）
      Utilities.sleep(10000);
    } catch(err) {
      console.error(`クエリ「${query}」での探索に失敗しました:`, err);
      writeLog(functionName, 'warning', `Search query [${query}] failed: ${err.message}`);
    }
  });

  // 3. 発見された全記事を、正規化したURLに基づいて重複排除（ユニーク化）
  const seenUrls = new Set();
  const uniqueArticles = [];

  allDiscoveredArticles.forEach(art => {
    const normUrl = normalizeUrl(art.url);
    if (!seenUrls.has(normUrl)) {
      seenUrls.add(normUrl);
      uniqueArticles.push(art);
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
1. 信頼できる配信元の正確なWebページの「URL」および「サイト名（source）」を抜き出してください。
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
