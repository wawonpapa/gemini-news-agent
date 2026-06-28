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
      }
    },
    required: ["summary", "category", "tags", "importance"]
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

/**
 * 配信候補の記事リストを受け取り、Gemini APIを用いて内容ベースの重複排除を行います。
 * @param {Array<Object>} articles 配信候補記事の配列
 * @param {Set<string>} excludedIds 除外された記事IDを格納するためのSetオブジェクト（副作用でIDが追加されます）
 * @return {Array<Object>} 重複排除後の記事リスト
 */
function deduplicateArticlesViaAI(articles, excludedIds) {
  if (!articles || articles.length <= 1) {
    return articles;
  }

  const apiKey = getGeminiApiKey();
  const modelName = 'gemini-3.1-flash-lite';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

  // AIに渡すコンパクトな記事メタデータリストを構築（要約を省くことでトークンを約70%節約し高速化）
  const compactList = articles.map(art => ({
    id: art.article_id,
    title: art.title,
    source: art.source,
    category: art.category
  }));

  const prompt = `あなたは非常に優れたニュース編集者です。
与えられたニュース記事のリストを注意深く読み、内容（扱っている時事ニュースイベント、新技術・製品発表など）が実質的に同一である「重複記事」のグループを特定してください。
各重複グループについて、1つの代表的な記事（ID）を残し、それ以外の重複記事（ID）を除外（グループ化）してください。

【代表記事の選定基準】：
1. 重複するグループ内で、最も公開日が新しく、かつ最も具体的で情報量が多い記事を representative_id として選択してください。
2. 異なるメディアが同じイベントを報じている場合（例: NVIDIAが新しいGPUを発表したニュース、特定の企業のレイアウト発表など）、それらは重複グループとみなします。
3. 代表として残す記事以外の重複する記事のIDを duplicate_ids 配列に入れてください。

【記事リスト】:
${JSON.stringify(compactList, null, 2)}

出力は必ず以下のJSONスキーマに従い、余計な説明文は一切含めないでください。`;

  // Structured Outputsのスキーマ定義
  const responseSchema = {
    type: "OBJECT",
    properties: {
      duplicate_groups: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            representative_id: {
              type: "STRING",
              description: "重複グループの中で、代表として配信に残す記事のID"
            },
            duplicate_ids: {
              type: "ARRAY",
              items: { type: "STRING" },
              description: "重複グループ内で、代表記事と同一トピックであるため除外（非表示）すべき記事のID配列"
            }
          },
          required: ["representative_id", "duplicate_ids"]
        },
        description: "重複しているニュース記事のグループ一覧。重複がない場合は空配列。"
      }
    },
    required: ["duplicate_groups"]
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
      temperature: 0.1 // 決定論的で安定した判定を期待するため、極めて低い温度に設定
    }
  };

  try {
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
      console.warn(`[AI重複排除] Gemini APIの呼び出しに失敗しました (Status: ${responseCode}): ${responseText}`);
      return articles; // APIエラー時はフォールバックとして重複排除せずそのまま返す
    }

    const json = JSON.parse(responseText);
    if (!json.candidates || json.candidates.length === 0 || !json.candidates[0].content) {
      console.warn(`[AI重複排除] Gemini APIから無効なレスポンスが返されました: ${responseText}`);
      return articles;
    }

    const resultText = json.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(resultText);

    // AIハルシネーション対策の厳格なID検証
    const validIds = new Set(articles.map(a => a.article_id));
    const duplicateIdsToRemove = new Set();
    
    if (parsed.duplicate_groups && Array.isArray(parsed.duplicate_groups)) {
      parsed.duplicate_groups.forEach(group => {
        // 代表記事IDが入力に存在することを確認
        if (validIds.has(group.representative_id) && Array.isArray(group.duplicate_ids)) {
          group.duplicate_ids.forEach(id => {
            // 除外対象IDが入力に存在し、かつ代表IDと異なること（自身を消さないガード）を確認
            if (validIds.has(id) && id !== group.representative_id) {
              duplicateIdsToRemove.add(id);
              if (excludedIds) {
                excludedIds.add(id); // 副作用で除外対象を呼び出し元に共有
              }
            }
          });
        }
      });
    }

    console.log(`[AI重複排除] 重複と判定されて除外された記事数: ${duplicateIdsToRemove.size} 件`);
    
    // 除外対象となっていない記事のみをフィルタリングして返す
    return articles.filter(art => !duplicateIdsToRemove.has(art.article_id));

  } catch (e) {
    console.error("[AI重複排除] 重複排除処理中に予期せぬエラーが発生しました。元のリストを返します:", e);
    return articles; // エラー時は安全にフォールバック
  }
}

