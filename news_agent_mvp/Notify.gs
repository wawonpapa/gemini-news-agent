/**
 * 通知メール作成・送信モジュール
 * Gmail にプレミアム感のある HTML形式のデイリーニュースレターを配信します。
 */

/**
 * 厳選された上位記事リストを HTML メールでユーザーへ送信します。
 * @param {Array<Object>} articles ソート済みの厳選記事リスト (最大10件等)
 */
function sendDailyDigest(articles) {
  const props = PropertiesService.getScriptProperties();
  const email = props.getProperty('NOTIFY_EMAIL');
  const webAppUrl = props.getProperty('WEB_APP_URL');

  if (!email) {
    throw new Error("通知先メールアドレス（NOTIFY_EMAIL）がスクリプトプロパティに設定されていません。");
  }
  if (!webAppUrl) {
    throw new Error("WebアプリURL（WEB_APP_URL）がスクリプトプロパティに設定されていません。");
  }

  const today = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd");
  const subject = `✨ 今日のAIニュースサマリ [${today}]`;

  // HTMLの組み立て (インラインCSSでGmailに最適化しつつ、圧倒的プレミアムなデザイン)
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Outfit', 'Inter', -apple-system, sans-serif; background-color: #f7fafc; color: #2d3748; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.05); }
        .header { background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 40px 30px; text-align: center; color: #ffffff; }
        .header h1 { font-size: 26px; margin: 0; font-weight: 800; letter-spacing: -0.5px; }
        .header p { font-size: 14px; margin: 10px 0 0 0; opacity: 0.9; font-weight: 300; }
        .content { padding: 30px 25px; }
        .card { background-color: #ffffff; border: 1px solid #edf2f7; border-radius: 12px; padding: 24px; margin-bottom: 24px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.02); transition: transform 0.2s; }
        .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .source-tag { font-size: 11px; font-weight: 700; color: #7c3aed; background-color: #f3e8ff; padding: 4px 10px; border-radius: 99px; text-transform: uppercase; letter-spacing: 0.5px; }
        .score-badge { font-size: 11px; font-weight: 700; color: #059669; background-color: #d1fae5; padding: 4px 10px; border-radius: 99px; }
        .card-title { font-size: 18px; font-weight: 700; color: #1e293b !important; line-height: 1.4; margin: 8px 0 14px 0; text-decoration: none; display: block; }
        .card-title:hover { color: #6366f1 !important; text-decoration: underline; }
        .ai-summary { font-size: 14px; color: #4a5568; line-height: 1.6; background-color: #f8fafc; border-radius: 8px; padding: 14px; margin-bottom: 16px; border-left: 3px solid #cbd5e1; }
        .reason-box { font-size: 13px; font-weight: 500; color: #1e1b4b; background-color: #eef2ff; border-radius: 8px; padding: 12px 14px; margin-bottom: 20px; border-left: 4px solid #4f46e5; }
        .tags-container { margin-bottom: 20px; }
        .tag-pill { display: inline-block; font-size: 11px; color: #4a5568; background-color: #edf2f7; padding: 3px 8px; border-radius: 6px; margin-right: 6px; margin-bottom: 6px; }
        .action-bar { border-top: 1px solid #edf2f7; padding-top: 16px; text-align: center; }
        .btn { display: inline-block; font-size: 12px; font-weight: 700; padding: 8px 18px; border-radius: 8px; text-decoration: none; margin: 4px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08); transition: all 0.2s; }
        .btn-open { background-color: #6366f1; color: #ffffff !important; }
        .btn-good { background-color: #10b981; color: #ffffff !important; }
        .btn-bad { background-color: #f43f5e; color: #ffffff !important; }
        .btn-later { background-color: #0ea5e9; color: #ffffff !important; }
        .footer { background-color: #f8fafc; border-top: 1px solid #edf2f7; padding: 30px; text-align: center; font-size: 12px; color: #a0aec0; line-height: 1.5; }
        .footer a { color: #7c3aed; text-decoration: none; font-weight: 600; }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- ヘッダー -->
        <div class="header">
          <h1>PERSONAL NEWS AGENT</h1>
          <p>あなたの興味プロファイルに基づいて、本日の最新情報をAIが要約・厳選しました</p>
        </div>

        <!-- コンテンツ -->
        <div class="content">
  `;

  articles.forEach((a, index) => {
    const baseLink = `${webAppUrl}?article_id=${encodeURIComponent(a.article_id)}`;
    
    // タグの配列整形 (配列と文字列の両方に対応)
    let tagList = [];
    if (Array.isArray(a.tags)) {
      tagList = a.tags;
    } else if (typeof a.tags === 'string') {
      tagList = a.tags.split(',').map(t => t.trim());
    } else if (a.tags) {
      tagList = [String(a.tags)];
    }

    const tagsHtml = tagList
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0)
      .map(tag => `<span class="tag-pill">#${tag}</span>`)
      .join(' ');

    // 3行要約の箇条書き化（Geminiが返す先頭の「- 」「・」「• 」などを除去してから付与）
    const formattedSummary = (a.ai_summary || '')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => line.replace(/^[-・•＊\*]\s*/, ''))  // 先頭の箇条書きマーカーを除去
      .filter(line => line.length > 0)
      .map(line => `• ${line}`)
      .join('<br>');

    html += `
      <div class="card">
        <div class="card-header">
          <span class="source-tag">${a.source}</span>
          <span class="score-badge">興味度: ${a.interest_score}pts</span>
        </div>
        <a href="${baseLink}&action=open" target="_blank" class="card-title">${index + 1}. ${a.title}</a>
        
        <div class="ai-summary">
          <strong>AI 要約:</strong><br>
          ${formattedSummary}
        </div>

        <div class="reason-box">
          &#128161; <strong>読むべき理由:</strong> ${a.reason}
        </div>

        <div class="tags-container">
          ${tagsHtml}
        </div>

        <div class="action-bar">
          <a href="${baseLink}&action=open" target="_blank" class="btn btn-open">読む &#8599;</a>
          <a href="${baseLink}&action=good" target="_blank" class="btn btn-good">Good &#128077;</a>
          <a href="${baseLink}&action=bad" target="_blank" class="btn btn-bad">Bad &#128078;</a>
          <a href="${baseLink}&action=read_later" target="_blank" class="btn btn-later">あとで読む &#128204;</a>
        </div>
      </div>
    `;
  });

  html += `
        </div>

        <!-- フッター -->
        <div class="footer">
          <p>このニュースサマリは自動生成されました。<br>アクションリンクをクリックすると、あなたの興味プロファイルが学習されます。</p>
          <p>設定・ログの確認は <a href="${SpreadsheetApp.getActiveSpreadsheet().getUrl()}" target="_blank">スプレッドシート</a> を開いてください。</p>
          <p>© 2026 Personal News Agent MVP</p>
        </div>
      </div>
    </body>
    </html>
  `;

  // Gmail送信の実行
  GmailApp.sendEmail(
    email,
    subject,
    "HTMLメールを表示できるクライアントで確認してください。",
    {
      htmlBody: html,
      name: "Personal News Agent",
      noReply: true
    }
  );
}
