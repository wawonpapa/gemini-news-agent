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
