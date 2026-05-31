# 個人ニュース収集エージェント MVP 構築手順

## 目的

このMVPでは、以下の一連の流れを実現します。

```text
Inoreader
  → ニュース収集

Google Apps Script
  → 毎朝実行、記事取得、Gemini要約、通知、リアクション記録

Google Sheets
  → 記事DB、リアクション履歴、興味プロファイル

Gmail または Slack
  → 日次サマリ通知

Google Docs
  → 月次NotebookLM投入用レポート

NotebookLM
  → 月次で後から質問する場所
```

---

## MVPで作る範囲

```text
毎朝:
1. Inoreaderから未読/新着記事を取得
2. 各記事をGeminiで分類・要約
3. Google Sheetsに保存
4. 上位10件をGmailまたはSlackに通知

あなた:
5. 通知内のリンクから Good / Bad / あとで読む / Open を押す

毎週:
6. Good/Bad履歴から興味タグの重みを更新

毎月:
7. Good記事と重要記事をGoogle Docs化
8. そのDocsをNotebookLMに投入
```

MVPでは、NotebookLMへの投入は手動でよいです。  
最初から完全自動投入を狙うと、個人版NotebookLM側の制約で詰まる可能性があります。

---

## Step 0: 準備するもの

### 必須

- Google AI Plus契約済みのGoogleアカウント
- Gemini APIキー
- Google Sheets
- Google Apps Script
- Inoreader Pro
- 通知先: Gmail、またはSlack

### 任意

- Google Drive上の月次アーカイブ用フォルダ
- NotebookLM用の専用ノートブック
- SlackのIncoming Webhook

最初は Gmail通知 が一番簡単です。

---

## Step 1: Google Sheetsを作る

`Personal News Agent` のような名前でスプレッドシートを作ります。

以下のシートを作成します。

```text
articles
reactions
interest_profile
sources
settings
logs
```

### articles

記事ごとの情報を保存します。

| column | 内容 |
|---|---|
| article_id | URLをハッシュ化したID |
| fetched_at | 取得日時 |
| published_at | 公開日時 |
| source | 媒体名 |
| title | タイトル |
| url | URL |
| author | 著者、なければ空 |
| raw_summary | Inoreader側の概要 |
| ai_summary | Gemini要約 |
| category | 大分類 |
| tags | カンマ区切りタグ |
| importance | 1〜5 |
| interest_score | 興味スコア |
| reason | なぜ選んだか |
| status | new / opened / good / bad / read_later |
| notified_at | 通知日時 |

### reactions

あなたの操作履歴を保存します。

| column | 内容 |
|---|---|
| timestamp | 反応日時 |
| article_id | 記事ID |
| action | open / good / bad / read_later |
| url | 記事URL |
| title | 記事タイトル |
| note | 任意メモ |

### interest_profile

興味タグの重みを保存します。

| column | 内容 |
|---|---|
| tag | タグ名 |
| weight | 重み |
| last_updated | 更新日時 |
| reason | 更新理由 |

初期値の例です。

| tag | weight |
|---|---:|
| PlayStation | 5 |
| game industry | 5 |
| AI agent | 5 |
| generative AI | 4 |
| platform business | 4 |
| semiconductor | 3 |
| Japan market | 3 |

### sources

取得元を管理します。

| column | 内容 |
|---|---|
| source_name | 名前 |
| source_type | inoreader / rss / manual |
| query_or_feed | フィード名や検索条件 |
| enabled | TRUE/FALSE |
| priority | 1〜5 |

### settings

キー・設定値を置く場所です。  
ただし、APIキーはSheetsに直接置かず、Apps ScriptのScript Propertiesに入れる方が安全です。

| key | value |
|---|---|
| notify_email | 自分のメールアドレス |
| daily_limit | 20 |
| notify_top_n | 10 |
| gemini_model | gemini-2.5-flash |

---

## Step 2: Gemini APIキーを用意する

Google AI StudioでAPIキーを作成します。

注意点として、Google AI PlusのGeminiアプリ利用枠と、Gemini APIの利用枠は同一ではないと考えておくのが安全です。  
Apps Scriptから自動要約する場合はGemini API呼び出しになります。

Apps Scriptで以下のように保存します。

1. Apps Scriptエディタを開く
2. 左メニューの「プロジェクトの設定」
3. 「スクリプト プロパティ」
4. 以下を追加

```text
GEMINI_API_KEY = xxxxx
INOREADER_ACCESS_TOKEN = xxxxx
NOTIFY_EMAIL = your-email@example.com
```

---

## Step 3: Apps Scriptプロジェクトを作る

Google Sheetsから以下を開きます。

```text
拡張機能 → Apps Script
```

ファイル構成はこのくらいで十分です。

```text
Code.gs
Gemini.gs
Inoreader.gs
Sheets.gs
Notify.gs
Actions.gs
MonthlyDigest.gs
```

MVPなら1ファイルに全部書いても動きますが、後で保守しやすいよう分けるのがおすすめです。

---

## Step 4: Inoreaderから記事を取得する

MVPでは、以下のどちらかで始めます。

### 方式A: Inoreader APIを使う

おすすめです。

取得対象は、まず以下で十分です。

```text
新着記事
スター付き
特定フォルダ
特定タグ
```

### 方式B: InoreaderのRSS出力を使う

実装は簡単ですが、取得できる情報や認証まわりが制限されることがあります。  
まずはAPIの方が後々拡張しやすいです。

---

## Step 5: 記事IDを作る

同じURLを何度も保存しないために、URLからIDを作ります。

```javascript
function makeArticleId(url) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    url
  );
  return digest
    .map(function(byte) {
      const v = (byte < 0 ? byte + 256 : byte).toString(16);
      return v.length === 1 ? '0' + v : v;
    })
    .join('')
    .slice(0, 16);
}
```

---

## Step 6: Geminiで要約・分類する

記事ごとにGeminiへ渡す入力は、最初はこれで十分です。

```text
title
source
url
published_at
raw_summary
```

全文取得はMVPでは避けてよいです。  
著作権・実装負荷・処理コストの面で、まずはタイトルと概要ベースで十分に使えます。

GeminiにはJSONで返させます。

```javascript
function summarizeArticleWithGemini(article) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const model = 'gemini-2.5-flash';

  const prompt = `
あなたは個人向けニュースキュレーターです。
以下の記事を日本語で要約・分類してください。

出力は必ずJSONのみ。
余計な説明は不要です。

記事:
title: ${article.title}
source: ${article.source}
url: ${article.url}
summary: ${article.raw_summary || ''}

返すJSON:
{
  "summary": "3行以内の日本語要約",
  "category": "AI / Game / Business / Tech / Japan / World / Other のいずれか",
  "tags": ["tag1", "tag2", "tag3"],
  "importance": 1,
  "reason": "なぜ読む価値があるかを1文で"
}
`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt }
        ]
      }
    ]
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

  const json = JSON.parse(response.getContentText());
  const text = json.candidates[0].content.parts[0].text;

  return JSON.parse(text.replace(/```json|```/g, '').trim());
}
```

---

## Step 7: 興味スコアを計算する

Geminiの `importance` だけではなく、あなたの興味プロファイルを掛け合わせます。

```javascript
function calculateInterestScore(tags, importance) {
  const profile = getInterestProfileMap();

  let tagScore = 0;
  tags.forEach(tag => {
    tagScore += profile[tag] || 0;
  });

  return importance * 10 + tagScore;
}
```

初期MVPでは単純で十分です。

```text
interest_score = importance * 10 + タグ重み合計
```

例:

```text
importance = 4
tags = ["AI agent", "game industry"]
AI agent = 5
game industry = 5

score = 4 * 10 + 10 = 50
```

---

## Step 8: Sheetsに保存する

同じ `article_id` が既に存在する場合はスキップします。

```javascript
function saveArticle(article) {
  const sheet = SpreadsheetApp.getActive().getSheetByName('articles');
  const articleId = makeArticleId(article.url);

  if (articleExists(articleId)) {
    return;
  }

  sheet.appendRow([
    articleId,
    new Date(),
    article.published_at || '',
    article.source || '',
    article.title || '',
    article.url || '',
    article.author || '',
    article.raw_summary || '',
    article.ai_summary || '',
    article.category || '',
    (article.tags || []).join(','),
    article.importance || '',
    article.interest_score || '',
    article.reason || '',
    'new',
    ''
  ]);
}
```

---

## Step 9: 通知メールを作る

Gmailで送る場合、通知本文にアクションリンクを入れます。

```text
[Open]
[Good]
[Bad]
[あとで読む]
```

これらはApps ScriptのWebアプリURLにします。

```text
https://script.google.com/macros/s/xxxx/exec?action=good&article_id=xxxxx
```

メール本文の例です。

```javascript
function sendDailyDigest(articles) {
  const email = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
  const webAppUrl = PropertiesService.getScriptProperties().getProperty('WEB_APP_URL');

  let html = '<h2>今日のニュースサマリ</h2>';

  articles.forEach((a, index) => {
    const base = `${webAppUrl}?article_id=${encodeURIComponent(a.article_id)}`;

    html += `
      <hr>
      <h3>${index + 1}. ${a.title}</h3>
      <p><b>Source:</b> ${a.source}</p>
      <p>${a.ai_summary}</p>
      <p><b>Tags:</b> ${a.tags}</p>
      <p><b>Reason:</b> ${a.reason}</p>
      <p>
        <a href="${base}&action=open">Open</a> |
        <a href="${base}&action=good">Good</a> |
        <a href="${base}&action=bad">Bad</a> |
        <a href="${base}&action=read_later">あとで読む</a>
      </p>
    `;
  });

  GmailApp.sendEmail(
    email,
    '今日のニュースサマリ',
    'HTMLメールで確認してください',
    { htmlBody: html }
  );
}
```

---

## Step 10: Good / Bad / あとで読むを記録する

Apps ScriptをWebアプリとして公開し、`doGet(e)` でアクションを受け取ります。

```javascript
function doGet(e) {
  const action = e.parameter.action;
  const articleId = e.parameter.article_id;

  if (!action || !articleId) {
    return HtmlService.createHtmlOutput('Missing action or article_id');
  }

  const article = getArticleById(articleId);

  if (!article) {
    return HtmlService.createHtmlOutput('Article not found');
  }

  recordReaction(articleId, action, article);

  if (action === 'open') {
    updateArticleStatus(articleId, 'opened');
    return HtmlService.createHtmlOutput(
      `<script>window.location.href="${article.url}"</script>`
    );
  }

  if (action === 'good') {
    updateArticleStatus(articleId, 'good');
  }

  if (action === 'bad') {
    updateArticleStatus(articleId, 'bad');
  }

  if (action === 'read_later') {
    updateArticleStatus(articleId, 'read_later');
  }

  return HtmlService.createHtmlOutput(`
    <p>Recorded: ${action}</p>
    <p><a href="${article.url}">記事を開く</a></p>
  `);
}
```

リアクション記録:

```javascript
function recordReaction(articleId, action, article) {
  const sheet = SpreadsheetApp.getActive().getSheetByName('reactions');

  sheet.appendRow([
    new Date(),
    articleId,
    action,
    article.url,
    article.title,
    ''
  ]);
}
```

---

## Step 11: Webアプリとしてデプロイする

Apps Scriptで以下を実行します。

```text
デプロイ
→ 新しいデプロイ
→ 種類: ウェブアプリ
→ 次のユーザーとして実行: 自分
→ アクセスできるユーザー: 自分のみ、またはリンクを知っている全員
```

MVPでは、メール内のリンクから自分だけが使う想定なので、まずは自分のGoogleアカウントでアクセスできる設定にします。

発行されたWebアプリURLを、Script Propertiesに保存します。

```text
WEB_APP_URL = https://script.google.com/macros/s/xxxx/exec
```

---

## Step 12: 毎朝実行する関数を作る

メイン関数です。

```javascript
function dailyNewsJob() {
  try {
    const rawArticles = fetchInoreaderArticles();
    const newArticles = [];

    rawArticles.forEach(raw => {
      const articleId = makeArticleId(raw.url);

      if (articleExists(articleId)) {
        return;
      }

      const ai = summarizeArticleWithGemini(raw);
      const score = calculateInterestScore(ai.tags || [], ai.importance || 1);

      const article = {
        article_id: articleId,
        title: raw.title,
        url: raw.url,
        source: raw.source,
        author: raw.author,
        published_at: raw.published_at,
        raw_summary: raw.raw_summary,
        ai_summary: ai.summary,
        category: ai.category,
        tags: ai.tags || [],
        importance: ai.importance,
        interest_score: score,
        reason: ai.reason
      };

      saveArticle(article);
      newArticles.push(article);
    });

    const topArticles = newArticles
      .sort((a, b) => b.interest_score - a.interest_score)
      .slice(0, 10);

    if (topArticles.length > 0) {
      sendDailyDigest(topArticles);
      markNotified(topArticles);
    }

    writeLog('dailyNewsJob', 'success', `${topArticles.length} articles notified`);
  } catch (error) {
    writeLog('dailyNewsJob', 'error', error.message);
    throw error;
  }
}
```

---

## Step 13: 時間主導トリガーを設定する

Apps Scriptのトリガーで以下を設定します。

```text
dailyNewsJob
毎日
午前7時〜8時
```

---

## Step 14: 週次で興味プロファイルを更新する

最初はルールベースで十分です。

```text
Good       → タグ +2
あとで読む → タグ +1
Open       → タグ +0.5
Bad        → タグ -2
```

```javascript
function weeklyUpdateInterestProfile() {
  const reactions = getRecentReactions(30);
  const tagDelta = {};

  reactions.forEach(r => {
    const article = getArticleById(r.article_id);
    if (!article || !article.tags) return;

    const tags = article.tags.split(',').map(t => t.trim());

    let delta = 0;
    if (r.action === 'good') delta = 2;
    if (r.action === 'read_later') delta = 1;
    if (r.action === 'open') delta = 0.5;
    if (r.action === 'bad') delta = -2;

    tags.forEach(tag => {
      tagDelta[tag] = (tagDelta[tag] || 0) + delta;
    });
  });

  updateInterestWeights(tagDelta);
}
```

慣れてきたら、Geminiにこう依頼します。

```text
過去30日のGood/Bad/あとで読む/Open履歴を見て、
ユーザーの興味プロファイルを更新してください。

出力はJSONのみ:
{
  "increase": [{"tag": "...", "delta": 1, "reason": "..."}],
  "decrease": [{"tag": "...", "delta": -1, "reason": "..."}],
  "new_queries": ["..."],
  "summary": "興味傾向の説明"
}
```

---

## Step 15: 月次NotebookLM用Google Docsを作る

毎月1日に、前月のGood記事・重要記事をまとめたDocsを作ります。

```javascript
function monthlyDigestJob() {
  const articles = getMonthlyGoodAndImportantArticles();

  const doc = DocumentApp.create(
    Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM') + ' News Digest'
  );

  const body = doc.getBody();

  body.appendParagraph('Monthly News Digest').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('Goodした記事、重要度の高い記事、あとで読む記事の月次まとめです。');

  articles.forEach(a => {
    body.appendParagraph(a.title).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendParagraph(`Source: ${a.source}`);
    body.appendParagraph(`URL: ${a.url}`);
    body.appendParagraph(`Category: ${a.category}`);
    body.appendParagraph(`Tags: ${a.tags}`);
    body.appendParagraph(`Summary: ${a.ai_summary}`);
    body.appendParagraph(`Reason: ${a.reason}`);
  });

  doc.saveAndClose();

  sendMonthlyDigestNotification(doc.getUrl());
}
```

このGoogle DocsをNotebookLMに手動で追加します。

---

## Step 16: MVPの運用フロー

完成後の毎日の流れはこうなります。

```text
07:30
Apps Scriptが起動

07:31
Inoreaderから記事取得

07:32
Geminiで要約・分類

07:35
Google Sheetsに保存

07:36
Gmailに今日のニュースサマリが届く

あなた:
通知を見る
→ 気になる記事はOpen
→ 良ければGood
→ 微妙ならBad
→ 後で読みたいものはあとで読む

毎週:
興味タグが更新される

毎月:
Good記事まとめDocsが作られる
→ NotebookLMへ投入
```

---

## 最初の2週間の作業順

### Day 1: 土台作成

- Google Sheets作成
- `articles`, `reactions`, `interest_profile`, `logs` 作成
- Apps Scriptプロジェクト作成
- Gemini APIキー保存
- Gmail通知のテスト

この時点では、Inoreader連携なしでもよいです。  
手動で記事URLを数件入れて、Gemini要約と通知だけテストします。

### Day 2: Inoreader連携

- Inoreader API設定
- 新着記事取得
- URL重複除去
- Sheets保存

### Day 3: Gemini分類・要約

- タイトルと概要をGeminiへ渡す
- JSONで返す
- `ai_summary`, `category`, `tags`, `importance`, `reason` を保存

### Day 4: 通知

- 上位10件をGmail通知
- Open / Good / Bad / あとで読むリンクを入れる

### Day 5: リアクション記録

- Webアプリとしてデプロイ
- `doGet(e)` 実装
- `reactions` に記録
- `articles.status` を更新

### Day 6: 毎朝実行

- 時間主導トリガー設定
- エラーログ保存
- 失敗時メール通知

### Day 7: 週次興味更新

- Good/Bad/Open/あとで読むからタグ重み更新
- 次回ランキングに反映

### Day 8〜14: 運用しながら調整

見るべきポイントは以下です。

```text
記事数が多すぎないか
要約は短すぎ/長すぎないか
Good/Badが押しやすいか
あとで読むが溜まりすぎないか
タグが荒すぎないか
興味スコアが納得感あるか
```

---

## 実装時の注意点

### 1. 最初は全文取得しない

ニュース記事の全文取得は、サイトごとの仕様や権利関係、スクレイピング対策で面倒です。  
MVPでは以下だけで十分です。

```text
タイトル
媒体名
公開日
Inoreader概要
URL
```

### 2. 通知件数は少なめにする

最初は10件がおすすめです。

```text
notify_top_n = 10
daily_fetch_limit = 30
```

多すぎるとGood/Badが面倒になり、学習データも荒れます。

### 3. Badはテーマ否定とは限らない

Badには複数の意味があります。

```text
テーマに興味がない
記事品質が低い
既に知っている
媒体が微妙
タイトル釣りだった
```

将来的にはBad理由を分けると精度が上がります。

```text
Bad: not_interested
Bad: low_quality
Bad: duplicate
Bad: already_known
```

MVPでは単純なBadで十分です。

### 4. 興味プロファイルは急に変えすぎない

1回Goodしただけで大きく変えると、翌日から偏ります。  
重みはゆっくり動かすのが良いです。

```text
Good: +1〜2
Bad: -1〜2
週ごとに最大変化量を制限
```

### 5. NotebookLMは月次投入でよい

毎日入れるより、月次Docsの方が見通しが良いです。

```text
2026-05 News Digest
2026-06 News Digest
AI Agent News Digest
Game Industry News Digest
```

のように分けると、後から質問しやすくなります。

---

## MVPの完成条件

以下ができたらMVP完成です。

```text
毎朝ニュースサマリが届く
Good / Bad / あとで読む / Open が記録される
同じ記事が重複通知されない
Goodした記事だけ抽出できる
過去30日のGood記事サマリを作れる
月次Google DocsをNotebookLMに入れられる
```

この段階で、元の要件に対して以下の達成度になります。

| 要件 | MVPでの達成度 |
|---|---:|
| デイリーでニュース収集 | ◎ |
| 興味に応じた自動調整 | ○ |
| ドキュメント管理ツールに入れる | ○、月次Docs経由 |
| 完了通知 | ◎ |
| サマリ確認 | ◎ |
| 詳細リンク確認 | ◎ |
| 閲覧挙動の履歴保持 | ◎ |
| あとで読む | ◎ |
| Good / Bad | ◎ |
| 直近1か月Good記事サマリ | ◎ |
| Gemini/NotebookLMで後から質問 | ○〜◎ |

---

## 次の拡張候補

MVP後に追加すると良いのはこの順です。

```text
1. Slack通知対応
2. Bad理由の細分化
3. 週次の興味プロファイル更新をGemini化
4. 記事本文の一部取得
5. 重要テーマ別の月次Docs自動生成
6. NotebookLM投入の半自動化
7. Readwise Reader連携
```

最初から全部やるより、まずは Gmail通知 + Sheets履歴 + Gemini要約 + 月次Docs まで作るのが一番堅いです。
