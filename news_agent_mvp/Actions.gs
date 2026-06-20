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

    let formattedPubDate = '';
    if (article.published_at) {
      try {
        const pDate = new Date(article.published_at);
        if (!isNaN(pDate.getTime())) {
          formattedPubDate = Utilities.formatDate(pDate, "Asia/Tokyo", "yyyy/MM/dd");
        } else {
          formattedPubDate = article.published_at;
        }
      } catch (err) {
        formattedPubDate = article.published_at;
      }
    }

    const formattedSummary = (article.ai_summary || '')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => line.replace(/^[-・•＊\*]\s*/, ''))
      .filter(line => line.length > 0)
      .map(line => `• ${line}`)
      .join('<br>');

    let tagList = [];
    if (Array.isArray(article.tags)) {
      tagList = article.tags;
    } else if (typeof article.tags === 'string') {
      tagList = article.tags.split(',').map(t => t.trim());
    } else if (article.tags) {
      tagList = [String(article.tags)];
    }
    tagList = tagList.map(t => t.trim()).filter(t => t.length > 0);
    const defaultTagsJson = JSON.stringify(tagList);

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
            background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
            color: #1e293b;
            margin: 0;
            padding: 24px 16px;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
          }
          .card {
            max-width: 480px;
            width: 100%;
            background: rgba(255, 255, 255, 0.9);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            padding: 32px 24px;
            border-radius: 24px;
            box-shadow: 0 20px 40px rgba(15, 23, 42, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.6);
            box-sizing: border-box;
          }
          .icon-header {
            font-size: 48px;
            margin-bottom: 16px;
            text-align: center;
          }
          h2 {
            margin-top: 0;
            font-weight: 800;
            font-size: 22px;
            color: #0f172a;
            text-align: center;
            margin-bottom: 8px;
          }
          .eval-subtitle {
            font-size: 14px;
            color: #64748b;
            text-align: center;
            margin-bottom: 24px;
          }
          .article-card {
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            padding: 20px;
            margin-bottom: 24px;
            text-align: left;
          }
          .article-source-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
          }
          .source-badge {
            font-size: 11px;
            font-weight: 700;
            color: #4f46e5;
            background-color: #eef2ff;
            padding: 4px 10px;
            border-radius: 99px;
            text-transform: uppercase;
          }
          .date-badge {
            font-size: 11px;
            font-weight: 700;
            color: #64748b;
            background-color: #f1f5f9;
            padding: 4px 10px;
            border-radius: 99px;
          }
          .importance-badge {
            font-size: 11px;
            font-weight: 700;
            color: #059669;
            background-color: #d1fae5;
            padding: 4px 10px;
            border-radius: 99px;
          }
          .article-title {
            font-weight: 800;
            font-size: 16px;
            color: #1e293b;
            line-height: 1.4;
            margin-bottom: 16px;
          }
          .summary-label, .reason-label {
            font-size: 12px;
            font-weight: 700;
            color: #64748b;
            margin-top: 14px;
            margin-bottom: 6px;
            text-transform: uppercase;
          }
          .summary-content, .reason-content {
            font-size: 13px;
            color: #334155;
            line-height: 1.6;
          }
          .summary-content {
            background-color: #ffffff;
            padding: 12px;
            border-radius: 8px;
            border: 1px solid #f1f5f9;
          }
          .reason-content {
            background-color: #eff6ff;
            color: #1e40af;
            padding: 10px 12px;
            border-radius: 8px;
          }
          .btn {
            display: block;
            width: 100%;
            padding: 14px;
            color: white;
            border: none;
            border-radius: 12px;
            font-weight: 700;
            font-size: 15px;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
            font-family: 'Outfit', 'Noto Sans JP', sans-serif;
            text-align: center;
            box-sizing: border-box;
          }
          .btn:hover {
            transform: translateY(-2px);
            opacity: 0.95;
          }
          .btn-primary {
            background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
            box-shadow: 0 4px 15px rgba(79, 70, 229, 0.25);
          }
          .btn-primary:hover {
            box-shadow: 0 6px 20px rgba(79, 70, 229, 0.35);
          }
          .btn-good {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            box-shadow: 0 4px 15px rgba(16, 185, 129, 0.25);
          }
          .btn-good:hover {
            box-shadow: 0 6px 20px rgba(16, 185, 129, 0.35);
          }
          .btn-bad {
            background: linear-gradient(135deg, #f43f5e 0%, #e11d48 100%);
            box-shadow: 0 4px 15px rgba(244, 63, 94, 0.25);
          }
          .btn-bad:hover {
            box-shadow: 0 6px 20px rgba(244, 63, 94, 0.35);
          }
          .btn-later {
            background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
            box-shadow: 0 4px 15px rgba(14, 165, 233, 0.25);
          }
          .btn-later:hover {
            box-shadow: 0 6px 20px rgba(14, 165, 233, 0.35);
          }
          .btn-secondary {
            background-color: #64748b;
            box-shadow: 0 4px 15px rgba(100, 116, 139, 0.25);
          }
          .cancel-btn {
            display: block;
            width: 100%;
            margin-top: 16px;
            color: #94a3b8;
            background: none;
            border: none;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            font-family: 'Outfit', 'Noto Sans JP', sans-serif;
            text-align: center;
          }
          .cancel-btn:hover {
            color: #64748b;
          }
          .eval-buttons {
            display: flex;
            gap: 12px;
            margin-bottom: 24px;
          }
          .eval-buttons .btn {
            flex: 1;
          }

          /* Collapsible Tags Section */
          .collapsible-section {
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            overflow: hidden;
            background-color: #f8fafc;
            margin-top: 20px;
          }
          .collapsible-trigger {
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
            padding: 12px 16px;
            background: none;
            border: none;
            font-size: 13px;
            font-weight: 700;
            color: #4f46e5;
            cursor: pointer;
            text-align: left;
            font-family: 'Outfit', 'Noto Sans JP', sans-serif;
          }
          .collapsible-content {
            padding: 0 16px 16px 16px;
            border-top: 1px solid #f1f5f9;
          }
          .tags-editor-desc {
            font-size: 11px;
            color: #64748b;
            margin-top: 8px;
            margin-bottom: 12px;
            line-height: 1.4;
          }
          .tag-edit-item {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
            background-color: #ffffff;
            padding: 6px 10px;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
          }
          .tag-edit-item input[type="checkbox"] {
            width: 16px;
            height: 16px;
            cursor: pointer;
            accent-color: #4f46e5;
          }
          .tag-text-input {
            flex: 1;
            border: none;
            background: none;
            padding: 2px 4px;
            font-size: 13px;
            color: #334155;
            font-family: 'Outfit', 'Noto Sans JP', sans-serif;
          }
          .tag-text-input:focus {
            outline: 1px solid #cbd5e1;
            border-radius: 4px;
            background-color: #f8fafc;
          }
          .add-tag-row {
            display: flex;
            gap: 8px;
            margin-top: 12px;
          }
          .add-tag-row input[type="text"] {
            flex: 1;
            padding: 8px 12px;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            font-size: 12px;
            font-family: 'Outfit', 'Noto Sans JP', sans-serif;
          }
          .btn-add-tag {
            padding: 8px 14px;
            background-color: #4f46e5;
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            font-family: 'Outfit', 'Noto Sans JP', sans-serif;
          }
          .btn-add-tag:hover {
            background-color: #4338ca;
          }
          .no-tags-msg {
            font-size: 12px;
            color: #94a3b8;
            text-align: center;
            padding: 8px;
          }
          .complete-message {
            font-size: 14px;
            color: #475569;
            line-height: 1.6;
            text-align: center;
            margin-bottom: 28px;
          }
          .article-title-simple {
            font-size: 15px;
            font-weight: 700;
            color: #334155;
            background-color: #f1f5f9;
            padding: 14px;
            border-radius: 8px;
            margin-bottom: 24px;
            text-align: left;
          }
          .feedback-reason-section {
            text-align: left;
            margin-bottom: 20px;
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 16px;
          }
          .reason-choices {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-bottom: 12px;
          }
          .reason-choice-item {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            color: #334155;
            cursor: pointer;
          }
          .reason-choice-item input[type="checkbox"] {
            width: 16px;
            height: 16px;
            cursor: pointer;
            accent-color: #4f46e5;
          }
          .feedback-memo-area {
            width: 100%;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            padding: 8px 12px;
            font-size: 12px;
            color: #334155;
            font-family: 'Outfit', 'Noto Sans JP', sans-serif;
            resize: vertical;
            box-sizing: border-box;
          }
          .feedback-memo-area:focus {
            outline: 1px solid #4f46e5;
            background-color: #ffffff;
          }
          @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-6px); }
          }
          @media (max-width: 480px) {
            body {
              padding: 12px 8px;
            }
            .card {
              padding: 24px 16px;
              border-radius: 16px;
            }
            h2 {
              font-size: 20px;
            }
            .article-title {
              font-size: 17px;
            }
            .summary-content, .reason-content {
              font-size: 14px;
              padding: 12px 10px;
            }
            .summary-label, .reason-label {
              font-size: 12px;
            }
            .btn {
              padding: 16px;
              font-size: 16px;
            }
            .cancel-btn {
              padding: 12px;
              font-size: 14px;
            }
            .reason-choice-item {
              font-size: 15px;
              padding: 6px 0;
            }
            .reason-choice-item input[type="checkbox"] {
              width: 20px;
              height: 20px;
            }
            .feedback-memo-area {
              font-size: 14px;
              padding: 10px 12px;
            }
            .tag-edit-item {
              padding: 8px 12px;
              font-size: 14px;
            }
            .tag-edit-item input[type="checkbox"] {
              width: 18px;
              height: 18px;
            }
            .tag-text-input {
              font-size: 14px;
            }
          }
        </style>
      </head>
      <body>
        <div class="card">
          <!-- Mode 1: Read Mode -->
          <div id="read-mode" style="display: none;">
            <div class="icon-header">&#128214;</div>
            <h2>ニュースを読む</h2>
            <div class="article-card">
              <div class="article-source-row">
                <span class="source-badge">${article.source}</span>
                ${formattedPubDate ? `<span class="date-badge">&#128197; ${formattedPubDate}</span>` : ''}
                <span class="importance-badge">重要度: ${article.importance}/5</span>
              </div>
              <div class="article-title">「${article.title}」</div>
              <div class="summary-label">&#128203; AI要約</div>
              <div class="summary-content">${formattedSummary}</div>
              <div class="reason-label">&#128161; 選定理由</div>
              <div class="reason-content">${article.reason}</div>
            </div>
            <button onclick="openArticle()" class="btn btn-primary">記事を読む &#8599;</button>
            <button onclick="window.close();" class="cancel-btn">閉じる</button>
          </div>

          <!-- Mode 2: Evaluation Mode -->
          <div id="eval-mode" style="display: none;">
            <div class="icon-header">&#9997;</div>
            <h2>この記事はいかがでしたか？</h2>
            <p class="eval-subtitle">評価と興味タグの調整を行ってください。</p>
            
            <div class="eval-buttons">
              <button onclick="submitEvaluation('good')" class="btn btn-good">&#128077; Good</button>
              <button onclick="submitEvaluation('bad')" class="btn btn-bad">&#128078; Bad</button>
            </div>
            
            <div class="feedback-reason-section">
              <div class="summary-label">&#128172; 理由・メモ (任意)</div>
              <div class="reason-choices">
                <label class="reason-choice-item">
                  <input type="checkbox" name="reason-opt" value="リンク切れ(404)" />
                  <span>リンク切れ (404)</span>
                </label>
                <label class="reason-choice-item">
                  <input type="checkbox" name="reason-opt" value="有料制限" />
                  <span>有料記事 (制限あり)</span>
                </label>
                <label class="reason-choice-item">
                  <input type="checkbox" name="reason-opt" value="重複" />
                  <span>重複ニュース</span>
                </label>
              </div>
              <textarea id="feedback-memo" class="feedback-memo-area" placeholder="具体的な理由やメモをご自由に入力してください..." rows="2"></textarea>
            </div>
            
            <div class="collapsible-section">
              <button onclick="toggleTags()" class="collapsible-trigger">
                <span>&#127991; 学習対象タグの調整 (任意)</span>
                <span id="collapsible-chevron">&#9660;</span>
              </button>
              <div id="tags-editor-panel" class="collapsible-content" style="display: none;">
                <div class="tags-editor-desc">
                  チェックを入れたタグが学習対象になります。テキストを編集して変更することもできます。
                </div>
                <div id="tags-list-container"></div>
                <div class="add-tag-row">
                  <input type="text" id="new-tag-input" placeholder="新しいタグを追加..." />
                  <button type="button" onclick="addNewTag()" class="btn-add-tag">追加</button>
                </div>
              </div>
            </div>
            <button onclick="window.close();" class="cancel-btn">戻る（評価しない）</button>
          </div>

          <!-- Mode 3: Read Later Mode -->
          <div id="later-mode" style="display: none;">
            <div class="icon-header">&#128204;</div>
            <h2>あとで読む</h2>
            <div class="article-title-simple">「${article.title}」</div>
            <button onclick="confirmReadLater()" class="btn btn-later">あとで読む（ブックマーク）を確定する</button>
            <button onclick="window.close();" class="cancel-btn">キャンセル</button>
          </div>

          <!-- Mode 4: Complete Mode -->
          <div id="complete-mode" style="display: none;">
            <div class="icon-header">&#127881;</div>
            <h2>評価を登録しました</h2>
            <p class="complete-message">ご協力ありがとうございました。<br>興味プロファイルの学習に反映されました。</p>
            <button onclick="window.close();" class="btn btn-secondary">閉じる</button>
          </div>
        </div>

        <script>
          var ARTICLE_ID = ${JSON.stringify(articleId)};
          var ARTICLE_URL = ${JSON.stringify(article.url || '')};
          var INITIAL_ACTION = ${JSON.stringify(action)};
          var CONFIRM_URL = ${JSON.stringify(confirmUrl)};
          var WEB_APP_URL = ${JSON.stringify(webAppUrl)};
          var DEFAULT_TAGS = ${defaultTagsJson};

          var localTags = [];
          DEFAULT_TAGS.forEach(function(tag) {
            if (tag.trim()) {
              localTags.push({ name: tag.trim(), checked: true });
            }
          });

          window.addEventListener('DOMContentLoaded', function() {
            renderTags();

            if (INITIAL_ACTION === 'open') {
              if (sessionStorage.getItem('opened_' + ARTICLE_ID)) {
                showEvaluationMode();
              } else {
                showReadMode();
              }
            } else if (INITIAL_ACTION === 'good' || INITIAL_ACTION === 'bad') {
              showEvaluationMode();
            } else if (INITIAL_ACTION === 'read_later') {
              showLaterMode();
            }
          });

          window.addEventListener('pageshow', function(event) {
            if (INITIAL_ACTION === 'open' && sessionStorage.getItem('opened_' + ARTICLE_ID)) {
              showEvaluationMode();
            }
          });

          function showReadMode() {
            hideAllModes();
            document.getElementById('read-mode').style.display = 'block';
          }

          function showEvaluationMode() {
            hideAllModes();
            document.getElementById('eval-mode').style.display = 'block';
          }

          function showLaterMode() {
            hideAllModes();
            document.getElementById('later-mode').style.display = 'block';
          }

          function showComplete() {
            sessionStorage.removeItem('opened_' + ARTICLE_ID);
            hideAllModes();
            document.getElementById('complete-mode').style.display = 'block';
          }

          function hideAllModes() {
            document.getElementById('read-mode').style.display = 'none';
            document.getElementById('eval-mode').style.display = 'none';
            document.getElementById('later-mode').style.display = 'none';
            document.getElementById('complete-mode').style.display = 'none';
          }

          function openArticle() {
            sessionStorage.setItem('opened_' + ARTICLE_ID, 'true');
            try {
              fetch(CONFIRM_URL, { mode: 'no-cors', keepalive: true });
            } catch(e) {}
            window.top.location.href = ARTICLE_URL;
          }

          function confirmReadLater() {
            window.top.location.href = CONFIRM_URL;
          }

          function toggleTags() {
            var panel = document.getElementById('tags-editor-panel');
            var chevron = document.getElementById('collapsible-chevron');
            if (panel.style.display === 'none') {
              panel.style.display = 'block';
              chevron.innerHTML = '&#9650;';
            } else {
              panel.style.display = 'none';
              chevron.innerHTML = '&#9660;';
            }
          }

          function renderTags() {
            var container = document.getElementById('tags-list-container');
            container.innerHTML = '';
            if (localTags.length === 0) {
              container.innerHTML = '<div class="no-tags-msg">タグがありません</div>';
              return;
            }
            localTags.forEach(function(tagObj, idx) {
              var item = document.createElement('div');
              item.className = 'tag-edit-item';
              
              var checkbox = document.createElement('input');
              checkbox.type = 'checkbox';
              checkbox.id = 'tag-chk-' + idx;
              checkbox.checked = tagObj.checked;
              checkbox.onchange = function() {
                tagObj.checked = checkbox.checked;
              };
              
              var input = document.createElement('input');
              input.type = 'text';
              input.className = 'tag-text-input';
              input.value = tagObj.name;
              input.placeholder = "タグ名";
              input.onchange = function() {
                tagObj.name = input.value.trim();
              };
              
              item.appendChild(checkbox);
              item.appendChild(input);
              container.appendChild(item);
            });
          }

          function addNewTag() {
            var input = document.getElementById('new-tag-input');
            var val = input.value.trim();
            if (val) {
              localTags.push({ name: val, checked: true });
              input.value = '';
              renderTags();
            }
          }

          function getSelectedTags() {
            var tags = [];
            localTags.forEach(function(tagObj) {
              if (tagObj.checked && tagObj.name.trim()) {
                tags.push(tagObj.name.trim());
              }
            });
            return tags;
          }

          function submitEvaluation(action) {
            var tags = getSelectedTags();
            
            // 理由・メモの収集
            var selectedOpts = [];
            var checkboxes = document.querySelectorAll('input[name="reason-opt"]:checked');
            checkboxes.forEach(function(cb) {
              selectedOpts.push('[' + cb.value + ']');
            });
            var textareaVal = document.getElementById('feedback-memo').value.trim();
            var memo = selectedOpts.join('') + (textareaVal ? (selectedOpts.length ? ' ' : '') + textareaVal : '');

            var btns = document.querySelectorAll('#eval-mode .btn');
            btns.forEach(function(b) { b.disabled = true; });
            
            google.script.run
              .withSuccessHandler(function() {
                showComplete();
              })
              .withFailureHandler(function(err) {
                console.warn("google.script.run failed, falling back to form submit:", err);
                fallbackSubmit(action, tags, memo);
              })
              .submitEvaluationWithTags(ARTICLE_ID, action, tags, memo);
          }

          function fallbackSubmit(action, tags, memo) {
            var form = document.createElement('form');
            form.method = 'GET';
            form.action = WEB_APP_URL;
            
            var params = [
              ['action', action],
              ['article_id', ARTICLE_ID],
              ['confirm', 'true'],
              ['tags', tags.join(',')],
              ['memo', memo || '']
            ];
            
            params.forEach(function(p) {
              var input = document.createElement('input');
              input.type = 'hidden';
              input.name = p[0];
              input.value = p[1];
              form.appendChild(input);
            });
            
            document.body.appendChild(form);
            form.submit();
          }
        </script>
      </body>
      </html>
    `;
    return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL).addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // --- 2. 「確定」が押された場合は、スプレッドシートへの書き込みを実行 ---
  try {
    const memo = e.parameter.memo;
    recordReaction(articleId, action, article, memo);
    
    // ステータスの確定
    const finalStatus = (action === 'open') ? 'opened' : action;
    updateArticleStatus(articleId, finalStatus);

    // 【学習機能】Good/Bad リアクション時に興味プロファイルの重みを自動更新
    if (action === 'good' || action === 'bad') {
      var delta = (action === 'good') ? 1 : -1;
      
      var articleTags = [];
      const userTags = e.parameter.tags;
      if (userTags !== undefined) {
        // フォールバック時のユーザー編集済みタグを使用
        articleTags = userTags.split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t.length > 0; });
      } else {
        // 通常のデフォルトタグを使用
        if (Array.isArray(article.tags)) {
          articleTags = article.tags;
        } else if (typeof article.tags === 'string') {
          articleTags = article.tags.split(',').map(function(t) { return t.trim(); });
        } else if (article.tags) {
          articleTags = [String(article.tags)];
        }
      }
      
      var filteredTags = articleTags.filter(function(t) { return t.trim().length > 0; });
      if (filteredTags.length > 0) {
        var tagDelta = {};
        filteredTags.forEach(function(tag) { tagDelta[tag] = delta; });
        updateInterestWeights(tagDelta);
        console.log(`興味プロファイルを自動学習更新しました (action: ${action}, tags: ${filteredTags.join(', ')})`);
      }

      // articles シートのタグ情報も更新する（フォールバック時）
      if (userTags !== undefined) {
        updateArticleTags(articleId, filteredTags);
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
      return HtmlService.createHtmlOutput(redirectHtml).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL).addMetaTag('viewport', 'width=device-width, initial-scale=1');
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
    return HtmlService.createHtmlOutput(successHtml).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL).addMetaTag('viewport', 'width=device-width, initial-scale=1');

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
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL).addMetaTag('viewport', 'width=device-width, initial-scale=1');
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
      published_at: analyzed.published_at || new Date().toISOString(), // AIが抽出した公開日を優先
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
        @media (max-width: 480px) {
          body {
            padding: 10px;
          }
          .card {
            padding: 24px 20px;
          }
          .header h1 {
            font-size: 20px;
          }
          input[type="url"], textarea {
            font-size: 16px;
            padding: 12px;
          }
          .btn {
            font-size: 16px;
            padding: 16px;
          }
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
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL).addMetaTag('viewport', 'width=device-width, initial-scale=1');
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
      published_at: { type: "STRING", description: "記事の元サイトにおける公開日または更新日時（例: yyyy/MM/dd、不明な場合は大体の公開時期や空文字。フォーマットは可能な限り yyyy/MM/dd とする）" },
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
    required: ["title", "source", "published_at", "ai_summary", "category", "tags", "importance", "reason"]
  };

  if (bodyText && bodyText.length > 200) {
    prompt = `以下のウェブページの記事本文を詳細に分析し、指定されたJSONスキーマに従ってメタデータを出力してください。

■ 提供されたタイトル: ${title}
■ 本文抜粋:
${bodyText.slice(0, 10000)}

■ 抽出・解析ルール:
1. title: 本文の内容から、最も正確で自然なニュースタイトルを決定してください。
2. source: ニュースの配信元（サイト名）を正確に特定してください。
3. published_at: 記事の実際の公開日または更新日時（可能なら yyyy/MM/dd の形式）を抽出してください。不明な場合は空文字を返してください。
4. ai_summary: 3行以内の簡潔な日本語箇条書きで、核心部分をまとめてください。
5. category: 指定された enum の中から大カテゴリを選択してください。
6. tags: 関連度の高い重要キーワードタグを日本語または一般的な英語で3個以内抽出してください。
7. importance: 社会的または技術的な重要性を 1〜5 で評価してください。
8. reason: この記事を蓄積すべき理由（ユーザーコメント「${comment}」の内容も適宜考慮する）を、明快な日本語1文で作成してください。`;

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
3. published_at: 記事の実際の公開日または更新日時（可能なら yyyy/MM/dd の形式）を抽出してください。不明な場合は空文字を返してください。
4. ai_summary: 3行以内の簡潔な日本語箇条書きで、核心部分をまとめてください。
5. category: 指定された enum の中から大カテゴリを選択してください。
6. tags: 関連度の高い重要キーワードタグを日本語または一般的な英語で3個以内抽出してください。
7. importance: 社会的または技術的な重要性を 1〜5 で評価してください。
8. reason: この記事を蓄積すべき理由（ユーザーコメント「${comment}」の内容も適宜考慮する）を、明快な日本語1文で作成してください。`;

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

  let formattedPubDate = '';
  if (art.published_at) {
    try {
      const pDate = new Date(art.published_at);
      if (!isNaN(pDate.getTime())) {
        formattedPubDate = Utilities.formatDate(pDate, "Asia/Tokyo", "yyyy/MM/dd");
      } else {
        formattedPubDate = art.published_at;
      }
    } catch (err) {
      formattedPubDate = art.published_at;
    }
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
        .date {
          color: #047857;
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
        @media (max-width: 480px) {
          body {
            padding: 10px;
          }
          .card {
            padding: 24px 16px;
            border-radius: 16px;
          }
          .header h1 {
            font-size: 20px;
          }
          .article-box {
            padding: 16px;
            margin-bottom: 20px;
          }
          .title {
            font-size: 16px;
          }
          .ai-summary {
            font-size: 13px;
          }
          .reason {
            font-size: 12px;
          }
          .btn-container {
            flex-direction: column;
            gap: 10px;
          }
          .btn {
            padding: 12px;
            font-size: 14px;
          }
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
            ${formattedPubDate ? `<span class="date">&#128197; ${formattedPubDate}</span>` : ''}
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
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * フロントエンドから google.script.run で呼ばれる評価送信関数。
 * ユーザーが編集・選択したタグを使って、リアクション記録と興味プロファイル学習を行う。
 * @param {string} articleId
 * @param {string} action 'good' または 'bad'
 * @param {Array<string>} tags ユーザーが編集・選択したタグの配列
 * @param {string} memo フィードバックの理由・メモ
 */
function submitEvaluationWithTags(articleId, action, tags, memo) {
  const article = getArticleById(articleId);
  if (!article) throw new Error('記事が見つかりません: ' + articleId);

  // リアクション記録（理由・メモ付き）
  recordReaction(articleId, action, article, memo);
  
  // ステータスの確定
  updateArticleStatus(articleId, action);

  // 興味プロファイルの重み更新（ユーザー編集済みタグで）
  const delta = (action === 'good') ? 1 : -1;
  const tagDelta = {};
  
  // 安全性のためのフィルタリング
  if (tags && Array.isArray(tags)) {
    tags.map(t => t.trim()).filter(t => t.length > 0).forEach(t => {
      tagDelta[t] = delta;
    });
  }
  
  if (Object.keys(tagDelta).length > 0) {
    updateInterestWeights(tagDelta);
  }

  // articles シートのタグ情報も更新
  if (tags && Array.isArray(tags)) {
    updateArticleTags(articleId, tags.map(t => t.trim()).filter(t => t.length > 0));
  }

  writeLog('submitEvaluationWithTags', 'success',
    `action: ${action}, articleId: ${articleId}, tags: ${tags ? tags.join(', ') : ''}, memo: ${memo || ''}`);
}

