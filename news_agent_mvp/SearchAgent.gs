/**
 * 自律型ニュース探索エージェントモジュール (SearchAgent.gs)
 * Gemini API の「Google検索グラウンディング (Google Search Tool)」を利用し、
 * インターネット全体から最新記事をリアルタイムに自動リサーチします。
 */

/**
 * 興味タグとフォーカスドメインに基づいて、最新ニュースをGoogle検索経由で自律探索します。
 * @param {Array<string>} tags 探索対象の興味タグ配列
 * @param {Array<string>} focusDomains 優先的に巡回させたいドメイン・キーワード配列
 * @return {Array<Object>} 探索され、要約・分類された標準フォーマットの記事リスト
 */
function discoverNewsViaGoogleSearch(tags, focusDomains) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error("Gemini APIキー（GEMINI_API_KEY）がスクリプトプロパティに設定されていません。");
  }

  // リアルタイム検索と推論を両立する安定版の gemini-1.5-flash を利用
  const modelName = 'gemini-1.5-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

  const todayStr = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd");
  
  // プロンプトの構築
  let prompt = `あなたは非常に優秀な自律型ニュースリサーチエージェントです。
Google検索ツールを活用し、現在（基準日: ${todayStr}）から過去24〜48時間以内にWeb上に公開された、以下の興味タグに関する最新かつ重要度の高いニュース記事、プレスリリース、技術的なブログ記事を探索・発見してください。

■ 探索の優先キーワード・タグ：
${tags.map(t => `- "${t}"`).join('\n')}

■ 優先して巡回・検索すべきドメインやサイト（あれば）：
${focusDomains.map(d => `- ${d}`).join('\n')}

【探索・評価のルール】：
1. 興味タグの領域における業界動向、新技術、ビジネス戦略、重要リリースに焦点を当ててください。
2. 信頼できる配信元から、正確な「URL」および「サイト名（source）」を引用してください。
3. 発見した記事の中から、優先的にユーザーが読むべき良質な記事を最大10〜15件精選してください。
4. 各記事のAI要約は、3行程度の簡潔な日本語箇条書きで分かりやすく整理してください。`;

  // 構造化出力のためのスキーマ定義 (発見された複数記事の一括返却用)
  const articleSchema = {
    type: "OBJECT",
    properties: {
      title: { type: "STRING", description: "ニュース記事の正確なタイトル" },
      url: { type: "STRING", description: "ニュース記事の正確なWebページのフルURL（有効なURLであること）" },
      source: { type: "STRING", description: "ニュースの配信元・ウェブサイト名 (例: TechCrunch, ファミ通, PR TIMES 等)" },
      ai_summary: { type: "STRING", description: "核心的な内容を3行以内の簡潔な日本語箇条書きでまとめた要約" },
      category: { 
        type: "STRING", 
        enum: ["AI", "Game", "Business", "Tech", "Japan", "World", "Other"],
        description: "この記事に最も合致する大カテゴリ" 
      },
      tags: { 
        type: "ARRAY", 
        items: { type: "STRING" }, 
        description: "記事に関連するキーワードタグの配列（例: ['semiconductor', 'generative AI'] 等。3個以内）" 
      },
      importance: { 
        type: "INTEGER", 
        description: "1から5までの客観的重要度スコア（5が最高）" 
      },
      reason: { 
        type: "STRING", 
        description: "なぜこの記事を優先して読むべきか（ユーザーにとっての価値や業界へのインパクト）を分かりやすく表現した日本語の1文" 
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
        description: "探索・発見された最新ニュース記事の一覧"
      }
    },
    required: ["articles"]
  };

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt }
        ]
      }
    ],
    // Google検索ツールを有効化！
    tools: [
      {
        googleSearch: {}
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: responseSchema,
      temperature: 0.3
    }
  };

  console.log("Geminiの自律検索グラウンディングを開始します...");

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
    throw new Error(`自律探索APIエラー (Status: ${responseCode}): ${responseText}`);
  }

  const json = JSON.parse(responseText);
  
  if (!json.candidates || json.candidates.length === 0 || !json.candidates[0].content) {
    throw new Error(`探索APIから無効なレスポンスが返されました: ${responseText}`);
  }

  const resultText = json.candidates[0].content.parts[0].text;
  const parsedData = JSON.parse(resultText);

  if (!parsedData.articles || !Array.isArray(parsedData.articles)) {
    return [];
  }

  console.log(`自律探索完了。Web上から ${parsedData.articles.length} 件の記事が発見・要約されました。`);
  
  return parsedData.articles;
}
