/**
 * Web アプリ アクション受付モジュール (Actions.gs)
 * Gmail からのクリックをセキュアに受け取り、確認画面を挟んでから処理を確定します。
 */

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
    } else if (action === 'open') { 
      actionLabel = "記事を開く (ブラウザ遷移)"; 
      btnColor = "#6366f1"; 
      icon = "↗️";
    }

    // プレミアムデザイン確認画面 (ボットの先読みクリックを防止)
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
            text-decoration: none; 
            border-radius: 12px; 
            font-weight: 700; 
            font-size: 1.15em; 
            transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s; 
            box-shadow: 0 4px 15px rgba(0,0,0,0.1); 
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
            text-decoration: none; 
            font-size: 0.95em; 
            font-weight: 600;
          }
          .cancel:hover { color: #64748b; }
          @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-8px); }
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon-header">${icon}</div>
          <h2>アクションの確認</h2>
          <div class="title">「${article.title}」</div>
          <a href="${confirmUrl}" class="btn">${actionLabel} を確定する</a>
          <a href="#" onclick="window.close();" class="cancel">キャンセル（閉じる）</a>
        </div>
      </body>
      </html>
    `;
    return HtmlService.createHtmlOutput(html);
  }

  // --- 2. 「確定」が押された場合は、スプレッドシートへの書き込みを実行 ---
  try {
    recordReaction(articleId, action, article);
    
    // ステータスの確定
    const finalStatus = (action === 'open') ? 'opened' : action;
    updateArticleStatus(articleId, finalStatus);

    writeLog('doGet-ActionConfirmed', 'success', `Action: ${action}, ArticleId: ${articleId}`);

    // 記事を開くアクションの場合は対象URLにリダイレクト
    if (action === 'open') {
      const redirectHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <script>window.location.href = "${article.url}";</script>
        </head>
        <body>
          <div style="font-family:sans-serif; text-align:center; padding:50px; color:#64748b;">
            <p>記事を開いています... 自動で遷移しない場合は <a href="${article.url}">こちらをクリック</a> してください。</p>
          </div>
        </body>
        </html>
      `;
      return HtmlService.createHtmlOutput(redirectHtml);
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
          <a href="${article.url}" target="_blank" class="btn">記事を読む ↗</a>
        </div>
      </body>
      </html>
    `;
    return HtmlService.createHtmlOutput(successHtml);

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
  return HtmlService.createHtmlOutput(html);
}
