/**
 * Web アプリ アクション受付モジュール (Actions.gs)
 * Gmail からのクリックをセキュアに受け取り、確認画面を挟んでから処理を確定します。
 */

/**
 * URL文字列をHTML属性内で安全に使えるようサニタイズします。
 * javascript: プロトコルやHTML特殊文字によるXSSを防止します。
 * @param {string} url サニタイズ対象のURL
 * @return {string} サニタイズ済みURL
 */
function sanitizeUrlForHtml(url) {
  if (!url) return '';
  var trimmedUrl = url.toString().trim();
  // javascript: プロトコルをブロック
  if (trimmedUrl.toLowerCase().startsWith('javascript:')) return '';
  // HTML特殊文字をエスケープ
  return trimmedUrl
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * HTTP GET リクエスト受付処理
 */
function doGet(e) {
  const action = e.parameter.action;
  const articleId = e.parameter.article_id;
  const confirm = e.parameter.confirm;

  // パラメータがない場合、またはアクションが登録フォームの場合は登録画面を表示
  if ((!action && !articleId) || action === 'register_form') {
    return createNewsRegistrationForm();
  }

  if (!action || !articleId) {
    return createPremiumHtmlOutput('<h3>パラメータが不足しています。</h3><p>正しいURLをクリックしてください。</p>', '#f44336');
  }

  const article = getArticleById(articleId);
  if (!article) {
    return createPremiumHtmlOutput('<h3>記事が見つかりませんでした。</h3><p>データベースに対象の記事が存在しないか、すでに削除された可能性があります。</p>', '#f44336');
  }

  // --- 1. セキュリティ誤作動防止：ユーザー自身が「確定」ボタンを押していない場合 ---
  if (confirm !== 'true') {
    const webAppUrl = PropertiesService.getScriptProperties().getProperty('WEB_APP_URL');
    const confirmUrl = `${webAppUrl}?article_id=${articleId}&action=${action}&confirm=true`;

    // ─────────────────────────────────────────────────────────────────────────
    // 'open' アクション専用: 1ページ完結方式
    // ─────────────────────────────────────────────────────────────────────────
    // 【問題】GAS Web アプリの iframe は sandbox 属性に
    //   allow-top-navigation-by-user-activation が設定されている。
    //   これにより window.top へのJS遷移は「ユーザーの実クリック操作」がある場合のみ許可され、
    //   window.onload など自動実行では永遠にブロックされる。
    // 【解決策】2ページ目を廃止し、このボタンのクリック（User Activation）の瞬間に
    //   window.top.location.href でニュースサイトへ直接ジャンプ。
    //   反応の記録は fetch の keepalive オプションでバックグラウンド送信。
    if (action === 'open') {
      // JSON.stringify でURL内の特殊文字（スペース等）もJSに安全に埋め込む
      const safeArticleUrlForJs = JSON.stringify(article.url || '');
      const safeConfirmUrlForJs = JSON.stringify(confirmUrl);
      const openHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet">
          <title>記事を開く | News Agent</title>
          <style>
            body {
              font-family: 'Outfit', 'Noto Sans JP', sans-serif;
              background: linear-gradient(135deg, #f1f5f9 0%, #cbd5e1 100%);
              color: #1e293b; text-align: center; padding: 50px 20px; margin: 0;
              min-height: 100vh; display: flex; align-items: center; justify-content: center;
            }
            .card {
              max-width: 480px; width: 100%;
              background: rgba(255,255,255,0.95); backdrop-filter: blur(12px);
              padding: 40px 30px; border-radius: 24px;
              box-shadow: 0 20px 40px rgba(15,23,42,0.1);
              border: 1px solid rgba(255,255,255,0.7);
            }
            .icon-header { font-size: 52px; margin-bottom: 24px; animation: bounce 2s infinite; }
            h2 { margin-top: 0; font-weight: 800; font-size: 24px; color: #0f172a; }
            .article-title {
              font-weight: 700; color: #334155; margin: 24px 0 36px 0;
              font-size: 1.05em; line-height: 1.5; background-color: #f8fafc;
              padding: 20px; border-radius: 12px; border-left: 5px solid #6366f1; text-align: left;
            }
            .btn {
              display: inline-block; width: 90%; padding: 16px; color: white;
              background-color: #6366f1; border: none; border-radius: 12px;
              font-weight: 700; font-size: 1.15em; cursor: pointer;
              transition: transform 0.2s, box-shadow 0.2s;
              box-shadow: 0 4px 15px rgba(99,102,241,0.3);
              font-family: 'Outfit', 'Noto Sans JP', sans-serif;
            }
            .btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(99,102,241,0.4); }
            .cancel-btn {
              display: block; margin-top: 24px; color: #94a3b8; background: none;
              border: none; font-size: 0.95em; font-weight: 600; cursor: pointer;
              font-family: 'Outfit', 'Noto Sans JP', sans-serif;
            }
            .cancel-btn:hover { color: #64748b; }
            @keyframes bounce {
              0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); }
            }
          </style>
          <script>
            function confirmAndOpen() {
              var articleUrl = ${safeArticleUrlForJs};
              var confirmUrl = ${safeConfirmUrlForJs};
              // keepalive: ページ遷移後もリクエストが確実にサーバーへ到達し反応を記録する
              try { fetch(confirmUrl, { mode: 'no-cors', keepalive: true }); } catch(e) {}
              // ボタンクリック = User Activation → allow-top-navigation-by-user-activation をクリア
              window.top.location.href = articleUrl;
            }
          </script>
        </head>
        <body>
          <div class="card">
            <div class="icon-header">↗️</div>
            <h2>アクションの確認</h2>
            <div class="article-title">「${article.title}」</div>
            <button onclick="confirmAndOpen()" class="btn">記事を開いて確定する ↗️</button>
            <button onclick="window.close();" class="cancel-btn">キャンセル（閉じる）</button>
          </div>
        </body>
        </html>
      `;
      return HtmlService.createHtmlOutput(openHtml).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }

    let actionLabel = "";
    let btnColor = "#6366f1";
    let icon = "🔗";

    if (action === 'good') { 
      actionLabel = "Good (高評価・学習反映)"; 
      btnColor = "#10b981"; 
      icon = "👍";
    } else if (action === 'bad') { 
      actionLabel = "Bad (低評価・除外)"; 
      btnColor = "#ef4444"; 
      icon = "👎";
    } else if (action === 'read_later') { 
      actionLabel = "あとで読む (ブックマーク)"; 
      btnColor = "#3b82f6"; 
      icon = "📌";
    }

    // プレミアムデザイン確認画面 (ボットの先読みクリックを防止)
    // open と同様に fetch(keepalive) + window.top.location.href の1クリック完結方式に統一
    const safeArticleUrlForJs = JSON.stringify(article.url || '');
    const safeConfirmUrlForJs = JSON.stringify(confirmUrl);
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet">
        <title>アクションの確定 | News Agent</title>
        <style>
          body { 
            font-family: 'Outfit', 'Noto Sans JP', sans-serif; 
            background: linear-gradient(135deg, #f1f5f9 0%, #cbd5e1 100%); 
            color: #1e293b; 
            text-align: center; 
            padding: 50px 20px; 
            margin: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .card { 
            max-width: 480px; 
            width: 100%;
            background: rgba(255, 255, 255, 0.95); 
            backdrop-filter: blur(12px);
            padding: 40px 30px; 
            border-radius: 24px; 
            box-shadow: 0 20px 40px rgba(15,23,42,0.1); 
            border: 1px solid rgba(255,255,255,0.7);
          }
          .icon-header {
            font-size: 52px;
            margin-bottom: 24px;
            animation: bounce 2s infinite;
          }
          h2 { margin-top: 0; font-weight: 800; font-size: 24px; color: #0f172a; }
          .title { 
            font-weight: 700; 
            color: #334155; 
            margin: 24px 0 36px 0; 
            font-size: 1.1em; 
            line-height: 1.5; 
            background-color: #f8fafc;
            padding: 20px;
            border-radius: 12px;
            border-left: 5px solid ${btnColor};
            text-align: left;
          }
          .btn { 
            display: inline-block; 
            width: 90%; 
            padding: 16px; 
            color: white; 
            background-color: ${btnColor}; 
            border: none;
            border-radius: 12px; 
            font-weight: 700; 
            font-size: 1.15em;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s; 
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
            font-family: 'Outfit', 'Noto Sans JP', sans-serif;
          }
          .btn:hover { 
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(0,0,0,0.15);
            opacity: 0.95;
          }
          .cancel { 
            display: block; 
            margin-top: 24px; 
            color: #94a3b8; 
            background: none;
            border: none;
            font-size: 0.95em; 
            font-weight: 600;
            cursor: pointer;
            font-family: 'Outfit', 'Noto Sans JP', sans-serif;
          }
          .cancel:hover { color: #64748b; }
          @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-8px); }
          }
        </style>
        <script>
          function confirmAndGo() {
            var articleUrl = ${safeArticleUrlForJs};
            var confirmUrl = ${safeConfirmUrlForJs};
            // keepalive: ページ遷移後もリクエストが確実にサーバーへ到達し反応を記録する
            try { fetch(confirmUrl, { mode: 'no-cors', keepalive: true }); } catch(e) {}
            // ボタンクリック = User Activation → sandbox の allow-top-navigation-by-user-activation をクリア
            window.top.location.href = articleUrl;
          }
        </script>
      </head>
      <body>
        <div class="card">
          <div class="icon-header">${icon}</div>
          <h2>アクションの確認</h2>
          <div class="title">「${article.title}」</div>
          <button onclick="confirmAndGo()" class="btn">${actionLabel} を確定する</button>
          <button onclick="window.close();" class="cancel">キャンセル（閉じる）</button>
        </div>
      </body>
      </html>
    `;
    return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // --- 2. 「確定」が押された場合は、スプレッドシートへの書き込みを実行 ---
  try {
    recordReaction(articleId, action, article);
    
    // ステータスの確定
    const finalStatus = (action === 'open') ? 'opened' : action;
    updateArticleStatus(articleId, finalStatus);

    // 【学習機能】Good/Bad リアクション時に興味プロファイルの重みを自動更新
    if (action === 'good' || action === 'bad') {
      var delta = (action === 'good') ? 1 : -1;
      
      var articleTags = [];
      if (Array.isArray(article.tags)) {
        articleTags = article.tags;
      } else if (typeof article.tags === 'string') {
        articleTags = article.tags.split(',').map(function(t) { return t.trim(); });
      } else if (article.tags) {
        articleTags = [String(article.tags)];
      }
      
      var filteredTags = articleTags.filter(function(t) { return t.trim().length > 0; });
      if (filteredTags.length > 0) {
        var tagDelta = {};
        filteredTags.forEach(function(tag) { tagDelta[tag] = delta; });
        updateInterestWeights(tagDelta);
        console.log(`興味プロファイルを自動学習更新しました (action: ${action}, tags: ${filteredTags.join(', ')})`);
      }
    }

    writeLog('doGet-ActionConfirmed', 'success', `Action: ${action}, ArticleId: ${articleId}`);

    // 成功画面のデザインをアクションごとに最適化
    // 記事を開くアクションの場合は対象URLに同一タブ内で直接ジャンプ
    if (action === 'open') {
      const safeUrl = sanitizeUrlForHtml(article.url);
      const redirectHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <script>
            window.onload = function() {
              // GAS Web アプリは常に script.googleusercontent.com の sandbox iframe 内で動作する。
              // window.location.replace() では iframe 自体が遷移してしまい、
              // 外部サイトの X-Frame-Options によってブロックされる（「接続が拒否されました」エラー）。
              // window.top.location.replace() でトップレベルウィンドウを直接遷移させることで完全に回避する。
              try {
                window.top.location.replace("${safeUrl}");
              } catch(e) {
                // cross-origin sandbox で top へのアクセスが拒否された場合のフォールバック
                window.location.href = "${safeUrl}";
              }
            };
          </script>
        </head>
        <body>
          <div style="font-family: sans-serif; text-align: center; padding: 50px; color: #64748b;">
            <p>記事へ移動しています... 自動で遷移しない場合は <a href="${safeUrl}" target="_top" onclick="window.top.location.replace('${safeUrl}'); return false;">こちらをクリック</a> してください。</p>
          </div>
        </body>
        </html>
      `;
      return HtmlService.createHtmlOutput(redirectHtml).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }

    // リアクション記録完了画面
    const successHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;700;800&family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet">
        <title>登録完了 | News Agent</title>
        <style>
          body { 
            font-family: 'Outfit', 'Noto Sans JP', sans-serif; 
            background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); 
            color: #14532d; 
            text-align: center; 
            padding: 50px 20px; 
            margin: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .card { 
            max-width: 450px; 
            width: 100%;
            background: white; 
            padding: 45px 35px; 
            border-radius: 24px; 
            box-shadow: 0 10px 25px rgba(20, 83, 45, 0.05); 
          }
          .success-badge { font-size: 64px; margin-bottom: 24px; }
          h2 { margin-top: 0; font-weight: 800; font-size: 24px; color: #14532d; }
          p { color: #166534; font-size: 1.05em; line-height: 1.6; margin-bottom: 30px; }
          .btn { 
            display: inline-block; 
            padding: 14px 30px; 
            color: white; 
            background-color: #10b981; 
            text-decoration: none; 
            border-radius: 10px; 
            font-weight: 700; 
            box-shadow: 0 4px 12px rgba(16,185,129,0.2);
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="success-badge">🎉</div>
          <h2>アクション登録完了</h2>
          <p>反応「<strong>${action.toUpperCase()}</strong>」を履歴に記録し、興味プロファイルを更新しました！</p>
          <a href="${sanitizeUrlForHtml(article.url)}" target="_blank" class="btn">記事を読む ↗</a>
        </div>
      </body>
      </html>
    `;
    return HtmlService.createHtmlOutput(successHtml).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

  } catch (error) {
    writeLog('doGet-ActionError', 'error', error.message);
    return createPremiumHtmlOutput(`<h3>内部エラーが発生しました。</h3><p>${error.message}</p>`, '#f44336');
  }
}

/**
 * 汎用プレミアムエラー/警告表示画面
 */
function createPremiumHtmlOutput(htmlContent, themeColor) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;700&family=Noto+Sans+JP&display=swap" rel="stylesheet">
      <style>
        body { font-family: 'Outfit', 'Noto Sans JP', sans-serif; background-color: #f8fafc; padding: 50px 20px; text-align: center; }
        .card { max-width: 450px; margin: 0 auto; background: white; padding: 35px; border-radius: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border-top: 6px solid ${themeColor}; }
        h3 { color: #1e293b; margin-top: 0; }
        p { color: #64748b; line-height: 1.6; }
      </style>
    </head>
    <body>
      <div class="card">
        ${htmlContent}
      </div>
    </body>
    </html>
  `;
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * HTTP POST リクエスト受付処理 (自分で見つけたニュースの保存・解析)
 */
function doPost(e) {
  const functionName = 'doPost-UserSubmit';
  const url = e.parameter.url;
  const comment = e.parameter.comment || '';

  if (!url) {
    return createPremiumHtmlOutput('<h3>URLが入力されていません。</h3>', '#f44336');
  }

  // 1. URLの有効性検証とリダイレクト解決
  const finalUrl = validateAndGetFinalUrl(url);
  if (!finalUrl) {
    return createPremiumHtmlOutput('<h3>無効なURL、またはアクセスできないWebページです。</h3><p>入力したURLが正しいか、ブラウザで閲覧可能か確認してください。</p>', '#f44336');
  }

  try {
    // 2. スプレッドシート（articles）での重複チェック
    const articleId = makeArticleId(finalUrl);
    if (articleExists(articleId)) {
      return createPremiumHtmlOutput('<h3>このニュースは既に登録されています。</h3><p>データベースに重複する記事が存在するため、登録をスキップしました。</p>', '#3b82f6');
    }

    // 3. Webページテキストの取得（フォールバック付き）
    let title = '';
    let bodyText = '';
    try {
      const response = UrlFetchApp.fetch(finalUrl, {
        muteHttpExceptions: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      if (response.getResponseCode() === 200) {
        const html = response.getContentText();
        // 簡易タイトル抽出
        const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
        if (titleMatch) {
          title = titleMatch[1].replace(/\s+/g, ' ').trim();
        }
        // 本文抽出（script, style, HTMLタグの除去）
        bodyText = html
          .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
          .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }
    } catch (err) {
      console.warn(`HTML取得エラー (Gemini Search Groundingへフォールバックします): ${err.message}`);
    }

    // 4. Geminiによる解析（構造化出力）
    const analyzed = analyzeRegisteredNews(finalUrl, title, bodyText, comment);

    // 5. 記事データのDB保存（ステータスは 'good' で保存し、notified_atを現在日付にする）
    const processedArticle = {
      article_id: articleId,
      title: analyzed.title,
      url: finalUrl,
      source: analyzed.source,
      author: 'User Submitted',
      published_at: new Date().toISOString(),
      ai_summary: analyzed.ai_summary,
      category: analyzed.category,
      tags: analyzed.tags,
      importance: analyzed.importance,
      interest_score: (analyzed.importance * 10) + 10, // 興味スコアのダミー計算
      reason: analyzed.reason,
      status: 'good'
    };

    saveArticle(processedArticle);
    // notified_at列（15列目）を現在時刻に設定
    updateArticleStatus(articleId, 'good');

    // 6. 興味プロファイルの学習（タグの重みを+1）
    if (analyzed.tags && analyzed.tags.length > 0) {
      const tagDelta = {};
      analyzed.tags.forEach(tag => {
        tagDelta[tag.trim()] = 1;
      });
      updateInterestWeights(tagDelta);
    }

    writeLog(functionName, 'success', `Successfully registered news: ${analyzed.title}`);

    // 7. 解析成功・登録完了画面の表示
    return createRegistrationSuccessPage(processedArticle);

  } catch (err) {
    console.error("ユーザー登録ニュースの解析に失敗しました:", err);
    writeLog(functionName, 'error', err.message);
    return createPremiumHtmlOutput(`<h3>ニュース登録エラー</h3><p>解析処理中にエラーが発生しました: ${err.message}</p>`, '#f44336');
  }
}

/**
 * 自分で見つけたニュースの登録用WebフォームHTMLを生成します。
 */
function createNewsRegistrationForm() {
  const webAppUrl = PropertiesService.getScriptProperties().getProperty('WEB_APP_URL');
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet">
      <title>ニュース登録 | Personal News Agent</title>
      <style>
        body {
          font-family: 'Outfit', 'Noto Sans JP', sans-serif;
          background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%);
          color: #1f2937;
          margin: 0;
          padding: 20px;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .card {
          max-width: 500px;
          width: 100%;
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(10px);
          border-radius: 20px;
          padding: 40px;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.5);
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
        }
        .header h1 {
          font-size: 24px;
          font-weight: 800;
          margin: 0;
          color: #4f46e5;
        }
        .header p {
          font-size: 14px;
          color: #6b7280;
          margin: 8px 0 0 0;
        }
        .form-group {
          margin-bottom: 25px;
        }
        label {
          display: block;
          font-weight: 700;
          margin-bottom: 8px;
          font-size: 14px;
          color: #374151;
        }
        input[type="url"], textarea {
          width: 100%;
          padding: 12px;
          border: 1px solid #d1d5db;
          border-radius: 10px;
          font-size: 15px;
          font-family: inherit;
          box-sizing: border-box;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        input[type="url"]:focus, textarea:focus {
          outline: none;
          border-color: #6366f1;
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
        }
        textarea {
          height: 100px;
          resize: vertical;
        }
        .btn {
          display: block;
          width: 100%;
          padding: 14px;
          background-color: #4f46e5;
          color: white;
          border: none;
          border-radius: 10px;
          font-weight: 700;
          font-size: 16px;
          cursor: pointer;
          transition: background-color 0.2s, transform 0.1s;
          box-shadow: 0 4px 10px rgba(79, 70, 229, 0.2);
          font-family: inherit;
        }
        .btn:hover {
          background-color: #4338ca;
        }
        .btn:active {
          transform: scale(0.98);
        }
        .footer {
          margin-top: 30px;
          text-align: center;
          font-size: 12px;
          color: #9ca3af;
        }
        .loading-overlay {
          display: none;
          position: fixed;
          top: 0; left: 0; width: 100%; height: 100%;
          background: rgba(255, 255, 255, 0.9);
          z-index: 1000;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          border-radius: 20px;
        }
        .spinner {
          border: 4px solid rgba(0, 0, 0, 0.1);
          width: 36px;
          height: 36px;
          border-radius: 50%;
          border-left-color: #4f46e5;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .loading-text {
          margin-top: 15px;
          font-weight: 700;
          color: #4f46e5;
          font-size: 14px;
        }
      </style>
      <script>
        function showLoading() {
          document.getElementById('loading').style.display = 'flex';
          return true;
        }
      </script>
    </head>
    <body>
      <div class="card" style="position: relative;">
        <div id="loading" class="loading-overlay">
          <div class="spinner"></div>
          <div class="loading-text">AIがニュースを解析・登録しています...</div>
        </div>

        <div class="header">
          <h1>&#128221; カスタムニュース登録</h1>
          <p>あなたが見つけたニュースのURLを入力してください。<br>AIが自動で内容を解析し、アーカイブへ登録します。</p>
        </div>

        <form action="${webAppUrl}" method="POST" onsubmit="return showLoading()">
          <div class="form-group">
            <label for="url">ニュースURL *</label>
            <input type="url" id="url" name="url" required placeholder="https://example.com/news/article" autocomplete="off">
          </div>
          <div class="form-group">
            <label for="comment">メモ・コメント（任意）</label>
            <textarea id="comment" name="comment" placeholder="この記事の気に入った点やメモなど"></textarea>
          </div>
          <button type="submit" class="btn">解析して登録する &#128640;</button>
        </form>

        <div class="footer">
          © 2026 Personal News Agent MVP
        </div>
      </div>
    </body>
    </html>
  `;
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 登録されたニュースURLについて、本文テキストがある場合はそれを使い、
 * ない場合はGoogle Search Groundingを使ってGemini APIで構造化解析します。
 */
function analyzeRegisteredNews(url, title, bodyText, comment) {
  const apiKey = getGeminiApiKey();
  const modelName = 'gemini-3.1-flash-lite';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

  let prompt = '';
  let payload = {};

  const articleSchema = {
    type: "OBJECT",
    properties: {
      title: { type: "STRING", description: "ニュース記事の正確なタイトル" },
      source: { type: "STRING", description: "ニュースの配信元・ウェブサイト名 (例: TechCrunch, 窓の杜 等)" },
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
        description: "客観的・社会的観点からの重要度スコア（1から5、5が最高）" 
      },
      reason: { 
        type: "STRING", 
        description: "この記事のどこが有益か、登録者のコメント「" + comment + "」も踏まえた日本語1文の選定理由" 
      }
    },
    required: ["title", "source", "ai_summary", "category", "tags", "importance", "reason"]
  };

  if (bodyText && bodyText.length > 200) {
    prompt = `以下のウェブページの記事本文を詳細に分析し、指定されたJSONスキーマに従ってメタデータを出力してください。

■ 提供されたタイトル: ${title}
■ 本文抜粋:
${bodyText.slice(0, 10000)}

■ 抽出・解析ルール:
1. title: 本文の内容から、最も正確で自然なニュースタイトルを決定してください。
2. source: ニュースの配信元（サイト名）を正確に特定してください。
3. ai_summary: 3行以内の簡潔な日本語箇条書きで、核心部分をまとめてください。
4. category: 指定された enum の中から大カテゴリを選択してください。
5. tags: 関連度の高い重要キーワードタグを日本語または一般的な英語で3個以内抽出してください。
6. importance: 社会的または技術的な重要性を 1〜5 で評価してください。
7. reason: この記事を蓄積すべき理由（ユーザーコメント「${comment}」の内容も適宜考慮する）を、明快な日本語1文で作成してください。`;

    payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: articleSchema,
        temperature: 0.3
      }
    };
  } else {
    prompt = `Google検索ツールを活用し、以下のURL of ニュース記事について、正確なタイトル、配信元、内容を調べ、指定されたJSONスキーマに従ってメタデータを出力してください。
URL: ${url}

■ 抽出・解析ルール:
1. title: 検索して見つかる実際の記事タイトルを正確に取得してください。
2. source: ニュースの配信元（サイト名）を正確に特定してください。
3. ai_summary: 3行以内の簡潔な日本語箇条書きで、核心部分をまとめてください。
4. category: 指定された enum の中から大カテゴリを選択してください。
5. tags: 関連度の高い重要キーワードタグを日本語または一般的な英語で3個以内抽出してください。
6. importance: 社会的または技術的な重要性を 1〜5 で評価してください。
7. reason: この記事を蓄積すべき理由（ユーザーコメント「${comment}」の内容も適宜考慮する）を、明快な日本語1文で作成してください。`;

    payload = {
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: articleSchema,
        temperature: 0.3
      }
    };
  }

  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    throw new Error(`Gemini解析エラー (Status: ${response.getResponseCode()}): ${response.getContentText()}`);
  }

  const json = JSON.parse(response.getContentText());
  const resultText = json.candidates[0].content.parts[0].text;
  return JSON.parse(resultText);
}

/**
 * 登録完了およびAI解析結果のフィードバック画面を生成します。
 */
function createRegistrationSuccessPage(art) {
  let tagList = [];
  if (Array.isArray(art.tags)) {
    tagList = art.tags;
  } else if (typeof art.tags === 'string') {
    tagList = art.tags.split(',').map(t => t.trim());
  }

  const tagsHtml = tagList
    .filter(t => t.length > 0)
    .map(t => `<span class="tag-pill">#${t}</span>`)
    .join(' ');

  const formattedSummary = (art.ai_summary || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => line.replace(/^[-・•＊\*]\s*/, ''))
    .map(line => `• ${line}`)
    .join('<br>');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet">
      <title>登録成功 | Personal News Agent</title>
      <style>
        body {
          font-family: 'Outfit', 'Noto Sans JP', sans-serif;
          background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
          color: #064e3b;
          margin: 0;
          padding: 20px;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .card {
          max-width: 550px;
          width: 100%;
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(10px);
          border-radius: 24px;
          padding: 40px 30px;
          box-shadow: 0 20px 40px rgba(6, 78, 59, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.7);
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
        }
        .success-badge {
          font-size: 64px;
          margin-bottom: 15px;
          animation: bounce 2s infinite;
        }
        .header h1 {
          font-size: 24px;
          font-weight: 800;
          margin: 0;
          color: #059669;
        }
        .header p {
          font-size: 14px;
          color: #047857;
          margin: 8px 0 0 0;
        }
        .article-box {
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          padding: 20px;
          background-color: #f9fafb;
          margin-bottom: 30px;
          text-align: left;
        }
        .meta-row {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          font-weight: 700;
          color: #059669;
          margin-bottom: 12px;
        }
        .source {
          background-color: #ecfdf5;
          padding: 3px 8px;
          border-radius: 6px;
        }
        .importance {
          color: #d97706;
          background-color: #fffbeb;
          padding: 3px 8px;
          border-radius: 6px;
        }
        .title {
          font-size: 17px;
          font-weight: 800;
          color: #111827;
          line-height: 1.4;
          margin: 0 0 16px 0;
        }
        .section-label {
          font-size: 13px;
          font-weight: 700;
          color: #374151;
          margin: 16px 0 6px 0;
        }
        .ai-summary {
          font-size: 14px;
          color: #4b5563;
          line-height: 1.6;
          background-color: #ffffff;
          border-radius: 8px;
          padding: 12px;
          border-left: 3px solid #10b981;
        }
        .reason {
          font-size: 13px;
          font-style: italic;
          color: #1f2937;
          background-color: #f3f4f6;
          border-radius: 8px;
          padding: 10px 12px;
          border-left: 3px solid #6b7280;
        }
        .tags-container {
          margin-top: 15px;
        }
        .tag-pill {
          display: inline-block;
          font-size: 11px;
          color: #374151;
          background-color: #e5e7eb;
          padding: 3px 8px;
          border-radius: 6px;
          margin-right: 6px;
          margin-bottom: 6px;
        }
        .btn-container {
          display: flex;
          gap: 15px;
        }
        .btn {
          flex: 1;
          display: block;
          text-align: center;
          padding: 14px;
          border-radius: 10px;
          font-weight: 700;
          font-size: 15px;
          text-decoration: none;
          transition: background-color 0.2s, transform 0.1s;
          font-family: inherit;
        }
        .btn-primary {
          background-color: #10b981;
          color: white;
          box-shadow: 0 4px 10px rgba(16, 185, 129, 0.2);
        }
        .btn-primary:hover {
          background-color: #059669;
        }
        .btn-secondary {
          background-color: #f3f4f6;
          color: #4b5563;
          border: 1px solid #d1d5db;
        }
        .btn-secondary:hover {
          background-color: #e5e7eb;
        }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <div class="success-badge">&#127881;</div>
          <h1>登録＆解析完了！</h1>
          <p>ニュースの解析と保存が成功しました。<br>興味タグを学習し、週次アーカイブにも追加されます。</p>
        </div>

        <div class="article-box">
          <div class="meta-row">
            <span class="source">${art.source}</span>
            <span class="importance">重要度: ${art.importance}/5</span>
          </div>
          <div class="title">${art.title}</div>
          
          <div class="section-label">【AI要約】</div>
          <div class="ai-summary">${formattedSummary}</div>

          <div class="section-label">【選定理由】</div>
          <div class="reason">${art.reason}</div>

          <div class="tags-container">
            ${tagsHtml}
          </div>
        </div>

        <div class="btn-container">
          <a href="${art.url}" target="_blank" class="btn btn-primary">元記事を読む &#8599;</a>
          <a href="${PropertiesService.getScriptProperties().getProperty('WEB_APP_URL')}?action=register_form" class="btn btn-secondary">続けて登録する</a>
        </div>
      </div>
    </body>
    </html>
  `;
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
