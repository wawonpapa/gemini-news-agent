/**
 * Gemini API 連携モジュール
 * Structured Outputs (構造化出力) 機能を用いて、パースエラーの起きない安全な要約と分類を行います。
 *
 * 【現状の位置づけ】
 * 現在、日次探索フローでは SearchAgent.gs の executeSingleSearchQuery() が
 * 探索と要約・分類を同時に行っているため、このモジュールは dailyNewsJob から直接呼び出されていません。
 * 今後、「既存記事の再要約」や「手動URL投入からの単組要約」など、探索とは独立した
 * スタンドアロン要約機能を追加する際に使用します。
 */

/**
 * Gemini API を用いて記事を要約・分類します。
 * @param {Object} article 統一フォーマットの記事データ
 * @return {Object} AI要約結果 (summary, category, tags, importance, reason)
 */
function summarizeArticleWithGemini(article) {
  const apiKey = getGeminiApiKey();

  // 安定版かつ超低コストな gemini-3.1-flash-lite を利用
  const modelName = 'gemini-3.1-flash-lite';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

  const prompt = `あなたは個人向けの優れたニュースキュレーターです。
以下のニュース記事のタイトルと概要をもとに、客観的に評価した上で、日本語での要約・分析を生成してください。

【記事タイトル】
${article.title}

【配信元】
${article.source}

【概要情報】
${article.raw_summary || '概要なし'}`;

  // Structured Outputsのスキーマ定義
  const responseSchema = {
    type: "OBJECT",
    properties: {
      summary: { 
        type: "STRING", 
        description: "元の記事の核心的な内容を3行以内の日本語（箇条書き形式等）で簡潔にまとめた要約" 
      },
      category: { 
        type: "STRING", 
        enum: ["AI", "Game", "Business", "Tech", "Japan", "World", "Other"],
        description: "この記事に最も合致する大カテゴリ"
      },
      tags: { 
        type: "ARRAY", 
        items: { type: "STRING" }, 
        description: "記事に関連するキーワードタグの配列（例: ['semiconductor', 'PlayStation 5', 'generative AI'] 等。日本語または英語の短文）" 
      },
      importance: { 
        type: "INTEGER", 
        description: "ビジネスパーソン／クリエイターの視点からこの記事が持つ客観的重要度スコア（1: 低い、5: 極めて高い）" 
      },
      reason: { 
        type: "STRING", 
        description: "なぜこの記事を優先して読むべきか（ユーザーにとっての価値や業界へのインパクト）を親しみやすく明快な日本語1文で表現したもの" 
      }
    },
    required: ["summary", "category", "tags", "importance", "reason"]
  };

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: responseSchema,
      temperature: 0.2 // 再現性と正確性を高めるため、低めの温度に設定
    }
  };

  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-goog-api-key': apiKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    throw new Error(`Gemini API呼び出しに失敗しました (Status: ${responseCode}): ${responseText}`);
  }

  const json = JSON.parse(responseText);
  
  if (!json.candidates || json.candidates.length === 0 || !json.candidates[0].content) {
    throw new Error(`Gemini APIから無効なレスポンスが返されました: ${responseText}`);
  }

  const resultText = json.candidates[0].content.parts[0].text;
  
  // APIから直接スキーマ通りのJSONが返るため、マークダウンの置換をせずに安全にパース可能
  return JSON.parse(resultText);
}
