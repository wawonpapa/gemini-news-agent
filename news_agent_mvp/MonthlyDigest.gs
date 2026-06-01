/**
 * 月次ニュースダイジェスト（NotebookLMインプット用）作成モジュール (MonthlyDigest.gs)
 * Google ドライブ上の単一の「マスタードキュメント」の末尾に、毎月優良記事を自動追記します。
 * これにより、NotebookLM側では「再同期(Sync)」ボタンを1クリックするだけで最新ニュースが反映されます。
 */

/**
 * 定期実行ジョブ: 先月の優良記事を収集し、マスターGoogle Docsの末尾に自動追記してメール通知します。
 */
function monthlyDigestJob() {
  const functionName = 'monthlyDigestJob';
  writeLog(functionName, 'running', '月次マスターアーカイブの更新処理を開始します。');

  try {
    const articles = getMonthlyGoodAndImportantArticles();
    
    if (articles.length === 0) {
      console.log("過去30日以内に対象となる優良記事（Goodまたは高興味スコア）が存在しないため、追記をスキップします。");
      writeLog(functionName, 'success', 'No articles qualified for monthly digest');
      return;
    }

    const props = PropertiesService.getScriptProperties();
    let masterDocId = props.getProperty('MASTER_DOC_ID');
    let doc;

    // 1. マスタードキュメントの取得または新規作成
    if (masterDocId) {
      try {
        doc = DocumentApp.openById(masterDocId);
      } catch (e) {
        console.log("登録されていたIDのドキュメントが開けませんでした。新規に作成し直します。");
      }
    }

    if (!doc) {
      // 存在しない場合は、新規にマスター用ドキュメントを作成してIDを永続化
      doc = DocumentApp.create("📖 Master News Agent Archive");
      masterDocId = doc.getId();
      props.setProperty('MASTER_DOC_ID', masterDocId);
      
      // 初回のドキュメントヘッダー設定
      const body = doc.getBody();
      body.setMarginTop(54).setMarginBottom(54).setMarginLeft(54).setMarginRight(54);
      
      const docTitle = body.appendParagraph("📖 Master News Agent Archive");
      docTitle.setHeading(DocumentApp.ParagraphHeading.HEADING1)
              .setFontFamily('Arial')
              .setFontSize(24)
              .setBold(true)
              .setForegroundColor('#1e1b4b');
              
      body.appendParagraph("このドキュメントは、自律リサーチエージェントによって厳選されたニュース記事が蓄積される自動マスターアーカイブです。\n本ファイルを NotebookLM にソースとして1回だけ登録しておけば、毎月GASがバックグラウンドで最新情報を追記し、NotebookLM側で「再同期」を押すだけで最新ナレッジに同期されます。\n");
    }

    const body = doc.getBody();
    const today = new Date();
    const formattedMonth = Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM');

    // 2. セパレーターと新規月次ヘッダーの追記
    body.appendHorizontalRule();
    const sectionHeader = body.appendParagraph(`■ ${formattedMonth} アーカイブ追加分 (${articles.length}件)`);
    sectionHeader.setHeading(DocumentApp.ParagraphHeading.HEADING2)
                 .setFontSize(16)
                 .setBold(true)
                 .setForegroundColor('#1e1b4b')
                 .setSpacingBefore(18);

    const descPara = body.appendParagraph(`追加処理日時: ${Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')}\n`);
    descPara.setFontSize(9).setForegroundColor('#64748b').setItalic(true).setSpacingAfter(12);

    // 3. 各ニュース記事のフォーマット追記
    articles.forEach((a, index) => {
      // 記事タイトル
      const itemTitle = body.appendParagraph(`[${index + 1}] ${a.title}`);
      itemTitle.setFontSize(12).setBold(true).setForegroundColor('#0f172a').setSpacingBefore(8);

      // メタデータ
      const metaText = `配信元: ${a.source}  |  重要度: ${a.importance}/5  |  興味スコア: ${a.interest_score}pts\nURL: ${a.url}\nカテゴリ: ${a.category}  |  タグ: ${a.tags}`;
      const metaPara = body.appendParagraph(metaText);
      metaPara.setFontSize(8.5).setForegroundColor('#64748b').setLineSpacing(1.2);

      // AI要約
      const summaryLabel = body.appendParagraph("【AI要約】");
      summaryLabel.setBold(true).setFontSize(9.5).setForegroundColor('#334155').setSpacingBefore(4);
      const summaryPara = body.appendParagraph(a.ai_summary || '要約なし');
      summaryPara.setFontSize(9.5).setForegroundColor('#334155').setLineSpacing(1.3);

      // 読むべき理由
      const reasonLabel = body.appendParagraph("【選定理由】");
      reasonLabel.setBold(true).setFontSize(9.5).setForegroundColor('#334155').setSpacingBefore(4);
      const reasonPara = body.appendParagraph(a.reason || '選定理由なし');
      reasonPara.setFontSize(9.5).setForegroundColor('#1e1b4b').setItalic(true).setSpacingAfter(10);
    });

    doc.saveAndClose();
    
    // 生成完了通知メールの送信
    sendMonthlyDigestNotification(doc.getUrl(), articles.length);
    writeLog(functionName, 'success', `Successfully appended monthly digest of ${articles.length} articles to Master Doc.`);

  } catch(error) {
    console.error("月次ダイジェストの追記に失敗しました:", error);
    writeLog(functionName, 'error', error.message);
  }
}

/**
 * 過去30日間の「Good」評価記事、または「興味スコア35以上」の重要記事を抽出します。
 */
function getMonthlyGoodAndImportantArticles() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('articles');
  const results = [];
  if (!sheet) return results;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return results;

  const rows = sheet.getRange(2, 1, lastRow - 1, 15).getValues();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  rows.forEach(row => {
    const fetchedAt = new Date(row[1]);
    const score = parseFloat(row[11]) || 0; // interest_score
    const status = row[13].toString().trim(); // status

    // 過去30日以内のデータが対象
    if (fetchedAt >= thirtyDaysAgo) {
      if (status === 'good' || status === 'read_later') {
        results.push({
          title: row[4],
          source: row[3],
          url: row[5],
          ai_summary: row[7], // ai_summary
          category: row[8],   // category
          tags: row[9],       // tags
          importance: row[10],// importance
          interest_score: score,
          reason: row[12]     // reason
        });
      }
    }
  });

  return results.sort((a, b) => b.interest_score - a.interest_score);
}

/**
 * 月次ダイジェストマスターの追記完了を通知するメールを送信します。
 */
function sendMonthlyDigestNotification(docUrl, count) {
  const email = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
  if (!email) return;

  const subject = `[月次レポート] 月次ニュースダイジェストが追記更新されました [${count}件]`;
  const body = `
Personal News Agent よりお知らせです。

先月1か月間の「Good記事」および「重要ニュース」を集約し、Google ドライブ上のマスターアーカイブに自動追記しました。

■ 今回の追記数
${count} 件

■ マスタードキュメントのリンクはこちら
${docUrl}

■ NotebookLM への同期方法
1. NotebookLM ( https://notebooklm.google.com/ ) を開きます。
2. 対象のノートブックを開き、ソース一覧にある「Master News Archive」の横に表示される「再同期（Sync）」ボタンを1クリックしてください。
3. 今回追記された最新のニュースナレッジが、NotebookLMに即座に読み込まれます。

※ 手動での新規ファイルの追加やコピペは一切不要です！
  `;

  GmailApp.sendEmail(email, subject, body, { name: "Personal News Agent" });
}
