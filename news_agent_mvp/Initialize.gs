/**
 * スプレッドシート データベース初期セットアップスクリプト
 * 拡張機能 -> Apps Script に貼り付け後、この関数を実行してください。
 * 完全自律探索版のデータベーステーブルを構築します。
 */
function initSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  const sheetsToCreate = [
    {
      name: 'articles',
      headers: [
        'article_id', 'fetched_at', 'published_at', 'source', 'title', 'url', 
        'author', 'ai_summary', 'category', 'tags', 
        'importance', 'interest_score', 'reason', 'status', 'notified_at'
      ]
    },
    {
      name: 'reactions',
      headers: ['timestamp', 'article_id', 'action', 'url', 'title', 'note']
    },
    {
      name: 'interest_profile',
      headers: ['tag', 'weight', 'last_updated', 'reason'],
      initialRows: [
        ['PlayStation', 5, new Date(), '初期値'],
        ['game industry', 5, new Date(), '初期値'],
        ['AI agent', 5, new Date(), '初期値'],
        ['generative AI', 4, new Date(), '初期値'],
        ['platform business', 4, new Date(), '初期値'],
        ['semiconductor', 3, new Date(), '初期値'],
        ['Japan market', 3, new Date(), '初期値']
      ]
    },
    {
      name: 'sources',
      headers: ['keyword_or_domain', 'type', 'enabled', 'note'],
      initialRows: [
        ['techcrunch.com', 'focus', 'TRUE', '優先巡回ドメイン例'],
        ['gizmodo.com', 'focus', 'TRUE', '優先巡回ドメイン例'],
        ['prtimes.jp', 'focus', 'TRUE', 'プレスリリースサイト例']
      ]
    },
    {
      // ※ NOTIFY_EMAIL, GEMINI_API_KEY, WEB_APP_URL, MASTER_DOC_ID は
      //    ScriptProperties（スクリプトプロパティ）で管理します。
      //    ここでは実行時にコードが参照する動作パラメータのみ管理します。
      name: 'settings',
      headers: ['key', 'value'],
      initialRows: [
        ['daily_limit', '30'], // 1日の要約上限
        ['notify_top_n', '10'], // 配信件数
        ['gemini_model', 'gemini-3.5-flash'] // 使用AIモデル
      ]
    },
    {
      name: 'logs',
      headers: ['timestamp', 'function_name', 'status', 'message']
    }
  ];

  sheetsToCreate.forEach(s => {
    let sheet = ss.getSheetByName(s.name);
    if (!sheet) {
      sheet = ss.insertSheet(s.name);
    } else {
      sheet.clear(); // 既存シートのクリア
    }
    
    // ヘッダーデザインの適用 (プレミアム・ダークグレー)
    sheet.getRange(1, 1, 1, s.headers.length)
         .setValues([s.headers])
         .setFontWeight('bold')
         .setFontColor('#ffffff')
         .setBackground('#334155') // Slate Gray
         .setHorizontalAlignment('center');
         
    sheet.setFrozenRows(1);
    
    // 初期データの投入
    if (s.initialRows && s.initialRows.length > 0) {
      sheet.getRange(2, 1, s.initialRows.length, s.initialRows[0].length).setValues(s.initialRows);
    }
    
    // 列幅自動調整
    try {
      sheet.autoResizeColumns(1, s.headers.length);
    } catch(e) {}
  });

  // デフォルトシートの削除
  const defaultSheet = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > sheetsToCreate.length) {
    ss.deleteSheet(defaultSheet);
  }
  
  Browser.msgBox("自律探索型エージェント", "データベースの自動初期化が完了しました！シートをご確認ください。", Browser.Buttons.OK);
}
