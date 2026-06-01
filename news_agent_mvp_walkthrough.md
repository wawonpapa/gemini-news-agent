# ウォークスルー - 自律型ニュースリサーチエージェント MVP

[news_agent_mvp/](file:///d:/Git/News_Agent_Test/news_agent_mvp) フォルダ内に、Gemini APIの **「Google検索グラウンディング (リアルタイムWeb検索)」** を用いた、完全無料で動作する最新の **「個人自律ニュースリサーチエージェント MVP」** の構築を完了しました。

さらに、NotebookLMへの連携を圧倒的に簡単にするため、**「Googleドライブ上の単一マスタードキュメント追記＋再同期機能」**を採用しています。

---

## 📂 生成されたファイル構成と各機能の役割

処理ごとにファイルをきれいに分割しており、ローカルでの変更が容易です：

1. **[appsscript.json](file:///d:/Git/News_Agent_Test/news_agent_mvp/appsscript.json)**:
   - GASプロジェクトの設定ファイル。V8ランタイムの有効化、タイムゾーンの「Asia/Tokyo」設定、Webアプリの動作権限などを定義しています。
2. **[Initialize.gs](file:///d:/Git/News_Agent_Test/news_agent_mvp/Initialize.gs)**:
   - 初期セットアップスクリプト。関数 `initSpreadsheet()` を実行すると、不要なデフォルトシートを削除し、必要な全シート（`articles`, `reactions`, `interest_profile`, `sources`, `settings`, `logs`）をカラムヘッダー、初期タグ値、列幅調整まで含めて自動生成します。
3. **[SearchAgent.gs](file:///d:/Git/News_Agent_Test/news_agent_mvp/SearchAgent.gs)**:
   - コア探索エンジン。Gemini API の **Google検索グラウンディング** 機能を利用し、ユーザーの「興味タグ」に合致する過去24〜48時間以内の有益なWeb記事・速報を自動的にインターネット全体から発掘します。**Structured Outputs（構造化出力）** 機能を適用しており、パースエラーの起きない正確なJSONを返却します。
4. **[Sheets.gs](file:///d:/Git/News_Agent_Test/news_agent_mvp/Sheets.gs)**:
   - データベース（スプレッドシート）操作ヘルパー群。記事のハッシュID重複防止、興味タグ情報の読み込み、探索条件の補助キーワード読み込み、ログ出力、タグ重みの自動更新などを行います。
5. **[Notify.gs](file:///d:/Git/News_Agent_Test/news_agent_mvp/Notify.gs)**:
   - Gmailで届く日次ニュースレターのHTML作成・配信を担当。美しいグラデーションヘッダー、ニュースカード、タグバッジ、フィードバック用のアクションボタン（Good / Bad 等）を備えたプレミアムなレスポンシブデザインです。
6. **[Actions.gs](file:///d:/Git/News_Agent_Test/news_agent_mvp/Actions.gs)**:
   - GAS Web Appの `doGet(e)` 処理を担当。メール内のボタン（Good / Bad 等）をクリックした際、セキュリティシステム（メールスキャナー）による自動誤クリックを防ぐための「確定ボタン（ワンクッション画面）」を挟んだセキュアなUIを提供します。
7. **[MonthlyDigest.gs](file:///d:/Git/News_Agent_Test/news_agent_mvp/MonthlyDigest.gs)**:
   - **【マスタードキュメント追記型】**月次のNotebookLM向けインプット生成を担当。毎月新しいファイルを量産するのではなく、Googleドライブ上の単一のドキュメント `📖 Master News Agent Archive` の末尾に最新記事を自動追記（アペンド）します。
8. **[Code.gs](file:///d:/Git/News_Agent_Test/news_agent_mvp/Code.gs)**:
   - 毎朝起動するメインジョブ `dailyNewsJob()` の司令塔。スプレッドシートから興味プロファイルを読み込み、AI自律探索を実行、新規記事をスコアリング保存し、上位記事をメール配信します。

---

## 🛠️ クラウド配置と運用のセットアップ手順

エージェントを完全に動作させるための詳細なセットアップ手順です。

### ステップ 1: スプレッドシートの作成と自動初期化
1. ご自身の Google ドライブで空の Google スプレッドシートを新規作成します。（例: `Personal News Agent`）
2. メニューから **「拡張機能」 -> 「Apps Script」** を開きます。
3. エディタ内のデフォルトコードをすべて削除し、ローカルの **[Initialize.gs](file:///d:/Git/News_Agent_Test/news_agent_mvp/Initialize.gs)** の中身をコピペして貼り付けます。
4. ツールバー of 実行関数に `initSpreadsheet` を選択し、**「実行」** ボタンを押します（初回のみGoogleへのアクセス承認プロンプトが出るので、許可してください）。
5. スプレッドシートに戻ると、すべてのシートとカラムが完璧なデザインで全自動生成されています！

### ステップ 2: ローカル開発環境のセットアップ (任意ですが推奨)
ローカルのVS Code等からコードをコピペなしで一発同期したい場合、以下のツール（`clasp`）を設定できます：
1. PCのコマンドライン（PowerShellなど）で、`clasp`をグローバルインストールします：
   ```bash
   npm install -g @google/clasp
   ```
2. Google Apps Script API を有効化します： [https://script.google.com/home/usersettings](https://script.google.com/home/usersettings) にアクセスし、APIの設定を **「オン」** にします。
3. コマンドラインでログインを実行します（ブラウザで認証画面が開きます）：
   ```bash
   clasp login
   ```
4. Web版GASエディタの「プロジェクトの設定（歯車マーク）」から「プロジェクトID」をコピーし、ローカルフォルダで以下を実行して紐付けます：
   ```bash
   clasp clone "コピーしたプロジェクトID"
   ```
5. 以降、ローカルでコードを変更したら、コマンド一発でGASクラウド側に同期（アップロード）できるようになります：
   ```bash
   clasp push
   ```

### ステップ 3: アクション受付用 Webアプリのデプロイ
メール内の「Good」や「Bad」のクリックをGASで受信できるようにするため、Webアプリとしてデプロイします：
1. Web版GASエディタの右上にある **「デプロイ」 -> 「新しいデプロイ」** をクリックします。
2. 種類の選択（歯車マーク）で **「ウェブアプリ」** を選択します。
3. 設定項目を以下のように構成します：
   - *次のユーザーとして実行*: **「自分（お客様のGmail）」**
   - *アクセスできるユーザー*: **「全員」**（自分以外の余計な自動スキャンなどが入らないよう、Actions.gs側でセキュリティ確認を挟むのでこれで安全です）
4. **「デプロイ」** をクリックし、発行された **「ウェブアプリのURL」** をコピーしておきます。（`https://script.google.com/macros/s/〜〜〜/exec` のような形式です）

### ステップ 4: GAS「スクリプト プロパティ」に環境変数を保存する
1. Web版GASエディタの左側メニューから **「プロジェクトの設定（歯車マーク）」** を開きます。
2. **「スクリプト プロパティ」** セクションまでスクロールし、**「スクリプト プロパティを追加」** を押して以下のキーと値を登録します：
   - `GEMINI_API_KEY`: Google AI Studioから取得したAPIキー。
   - `NOTIFY_EMAIL`: ニュースサマリを受け取りたいご自身のGmailアドレス。
   - `WEB_APP_URL`: **ステップ 3** でコピーした「ウェブアプリのURL」。

### ステップ 5: 自律探索の「探索補助キーワード」の設定（スプレッドシート）
1. スプレッドシートの `sources` シートを開きます。
2. AIに「特に優先して巡回・検索してほしい特定のドメインやサイト名（例: `techcrunch.com` や `prtimes.jp` など）」があれば、`keyword_or_domain` 列に登録し、`type` を `focus`、`enabled` を `TRUE` にします。
   * ※ 特に指定がない場合は空欄（初期値のまま）で構いません。AIは興味タグから自動でGoogle検索を縦横無尽に行います。

### ステップ 6: 動作テストと「マスタードキュメント」の初期生成
1. GASエディタで **[Code.gs](file:///d:/Git/News_Agent_Test/news_agent_mvp/Code.gs)** を開きます。
2. 上部メニューの関数選択で `dailyNewsJob` を選択し、**「実行」** をクリックします。数分後、メールでニュースレターが届きます。
3. Next, **[MonthlyDigest.gs](file:///d:/Git/News_Agent_Test/news_agent_mvp/MonthlyDigest.gs)** を開き、関数選択で `monthlyDigestJob` を選択し、**「実行」** をクリックします。
4. Google ドライブのルートに自動的に **`📖 Master News Agent Archive`** という Google Doc ファイルが作成されます。
5. GASの「プロジェクトの設定（スクリプトプロパティ）」画面を開き直すと、自動的に `MASTER_DOC_ID` というキーで今作成されたドキュメントIDが保存されているのを確認できます。

### ステップ 7: NotebookLM への一度限りの登録（ここが重要！）
1. **[NotebookLM](https://notebooklm.google.com/)** をブラウザで開きます。
2. 新しいノートブックを作成するか、既存のノートブックを開きます。
3. ソースの追加画面（Add Source）で **「Google ドライブ（Google Drive）」** を選択し、先ほど生成された **`📖 Master News Agent Archive`** ドキュメントを選択して追加します。
4. これで紐付けは完了です！以降、毎月GASがバックグラウンドでこのドキュメントの末尾に優良ニュースを自動追記します。
5. 追記が行われた際は、**NotebookLMを開いて、そのソースの横にある「再同期（Sync）」ボタンを1クリックするだけ**で、新着の全情報が瞬時に自動学習されます！

### ステップ 8: 自動スケジュールトリガーの設定
1. GASエディタの左側メニューから **「トリガー（時計マーク）」** を開きます。
2. **`dailyNewsJob`** 用に、「時間主導型」 -> 「日別タイマー」 -> 「午前7時〜8時」のトリガーを登録します。
3. さらに、**`monthlyDigestJob`** 用に、「時間主導型」 -> 「月別タイマー」 -> 「1日の午前9時〜10時」などのトリガーを登録します。
4. これで完璧な自律稼働リサーチエージェントシステムの完成です！

---

## 🚀 モデル切り替え後のレビューに基づく堅牢化・最適化 (全10件の改善点反映)

エージェントコードの更なる堅牢化、パフォーマンス向上、セキュリティ強化のため、モデル視点での徹底レビューを行い、以下の **10件の改善・修正** をすべての対象ファイルに適用しました。

### 1. セキュリティと安定性の向上
- **XSS（クロスサイトスクリプティング）対策の強化** ([Actions.gs](file:///d:/Git/News_Agent_Test/news_agent_mvp/Actions.gs)): 
  ユーザーからのアクション受付確認画面で、URLのサニタイズ関数 `sanitizeUrlForHtml()` を追加・適用し、不正スクリプト注入を防ぎます。
- **URL正規化の最適化** ([Sheets.gs](file:///d:/Git/News_Agent_Test/news_agent_mvp/Sheets.gs)): 
  `normalizeUrl` を改善し、一般的な広告/アナリティクストラッキングパラメータのみを除去するようにしました。これにより、特定のニュースサイトで重要な役割を果たすパスやアンカーパラメータを不必要に削ることなく正確に保持します。

### 2. コードの堅牢性と制限対策
- **GAS 6分間実行制限ガードの導入** ([Code.gs](file:///d:/Git/News_Agent_Test/news_agent_mvp/Code.gs)): 
  Google Apps Scriptの最大実行時間（6分間制限）に対し、実行途中で残り時間が1分未満（5分経過）になった段階で安全にループを抜け、その時点までの探索結果を処理してメール配信するようガード機構を追加しました。タイムアウトによるデータ未送信エラーを完全に防止します。
- **興味タグ型統一とパース例外処理の堅牢化** ([Code.gs](file:///d:/Git/News_Agent_Test/news_agent_mvp/Code.gs)): 
  JSON出力から返却される興味タグ（`tags`）が文字列と配列のどちらで返ってきても安全に処理できるようパースロジックを強化し、実行時エラーの発生を抑止しました。

### 3. バグ修正と学習ループの復活
- **フィードバック学習機能の復活** ([Actions.gs](file:///d:/Git/News_Agent_Test/news_agent_mvp/Actions.gs)): 
  ユーザーがニュースレターで「Good」「Bad」をクリックした際、`reactions` シートへの記録はされていたものの、実際のタグの重みを学習する `updateInterestWeights()` が呼び出されていないバグを修正。クリックした瞬間にユーザーの関心プロフィールへ即時学習が適用されるようになりました。

### 4. パフォーマンスの最適化
- **スプレッドシートアクセス最適化（profileMapのキャッシュ化）** ([Code.gs](file:///d:/Git/News_Agent_Test/news_agent_mvp/Code.gs)): 
  記事の類似度や関連スコアを計算する際、ループ内で何度もスプレッドシートから関心プロファイルを読み込んでいた非効率な処理を改善。メモリ上に `profileMap` として一度だけロードしキャッシュすることで、API呼び出し回数と実行時間を劇的に削減しました。
- **ログ自動クリーンアップの最適化** ([Sheets.gs](file:///d:/Git/News_Agent_Test/news_agent_mvp/Sheets.gs)): 
  ログシートが1000行を超えた際、100行分の余剰行を自動的に削除してスプレッドシートの肥大化を防ぐ `cleanupOldLogs()` 関数において、不要な空行作成を伴わないクリーンな削除処理に最適化しました。

### 5. リファクタリングと共通化
- **APIキー取得処理の共通ヘルパー化** ([Sheets.gs](file:///d:/Git/News_Agent_Test/news_agent_mvp/Sheets.gs) 他): 
  各ファイル（`SearchAgent.gs`、`Gemini.gs`、`Sheets.gs`）に散在していた `PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY')` の呼び出しを、`getGeminiApiKey()` ヘルパー関数に一本化し、コードの保守性を向上させました。
- **未使用変数の削除** ([Initialize.gs](file:///d:/Git/News_Agent_Test/news_agent_mvp/Initialize.gs)): 
  初期化スクリプト内に残存していた未使用の `notify_email` 記述を整理し、コードベースをクリーンに保っています。
- **デッドコードの明確化とドキュメント化** ([Gemini.gs](file:///d:/Git/News_Agent_Test/news_agent_mvp/Gemini.gs)): 
  他のAI呼び出しとの対比用、あるいは開発時に使用する予備関数のコメントアウト部について、意図せず有効化されないようデッドコードであることをコメントで明記しました。
