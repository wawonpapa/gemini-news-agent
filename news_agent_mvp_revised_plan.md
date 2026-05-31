# 個人自律型ニュースリサーチエージェント MVP プラン（完全無料・Google検索自動探索＆NotebookLM連携版）

本プランは、当初のInoreader（有料）を仲介する設計から変更し、**「Gemini APIのGoogle検索グラウンディング（リアルタイムWeb探索機能）」**を駆使して、**完全無料**で動作する自律的なニュース発掘エージェントシステムへ進化させたものです。

さらに、NotebookLMへの投入を実質的に自動化（1クリック化）するため、**「Googleドライブ上の単一マスタードキュメント追記＋再同期機能」**を採用しています。

---

## 🚀 自律型リサーチエージェントのメリット・効率化されるポイント

1. **維持費が完全無料 (0円)**  
   有料のInoreader Proプランの契約が完全に不要になります。GASの実行環境およびGemini APIの無料枠の範囲内で、完全に無料かつ自立的に稼働します。
2. **RSSフィード登録の手間がゼロ**  
   巡回するサイトのRSSフィードのURLを探して手動登録する手間がなくなります。AIがあなたの興味プロファイルに基づいて、Google検索経由でインターネット全体から面白い記事を勝手に探してきます。
3. **最新情報のリアルタイム収集 (Google Search Grounding)**  
   Gemini APIの強力なリアルタイム検索ツールを利用し、ここ24時間以内の重要ニュース、プレスリリース、技術記事などをWeb上から直接見つけ出し、ソース元（URL含む）を正確に引用してスプレッドシートへ格納します。
4. **学習による探索キーワードの自己進化**  
   スプレッドシート上の興味タグの重みが増減すると、毎朝のGoogle検索クエリ自体が自動的に調整され、発掘してくるニュースのジャンルや深さが勝手にシフトします。
5. **NotebookLM連携の実質的自動化 (マスタードキュメント同期方式)**  
   毎月新しいファイルを作るのではなく、単一のマスタードキュメント `📖 Master News Agent Archive` の末尾に自動追記する設計にします。NotebookLM側で「再同期」を1クリックするだけで最新ニュースが流し込まれ、手動のアップロード作業が完全消滅します。
6. **メールスキャナー誤作動対策の搭載 (Confirm画面の導入)**  
   Gmail内のリンクをセキュリティシステムが事前スキャン（勝手にクリック）しても「Good/Bad」が誤登録されないよう、確認画面をGAS Web Appで挟む安全設計にします。

---

## 🛠️ 新・アーキテクチャ・ファイル構成 (ローカルワークスペース)

プロジェクトフォルダ（`d:\Git\News_Agent_Test`）内に以下の構成を作成し、`clasp`でGoogle Driveへプッシュします。

```text
news_agent_mvp/
├── appsscript.json        # Apps Scriptの設定ファイル
├── Initialize.gs          # スプレッドシート初期セットアップ自動化スクリプト
├── Code.gs                # メインエントリポイント（dailyNewsJob: 自律探索の司令塔）
├── SearchAgent.gs         # GeminiのGoogle検索グラウンディングを用いた自律探索コア
├── Sheets.gs              # スプレッドシート読み書き・興味プロファイル管理
├── Notify.gs              # Gmail送信ロジック（プレミアムなキュレーションレイアウト）
├── Actions.gs             # Webアプリ doGet(e) 処理（メールクリック時のアクション確認画面）
└── MonthlyDigest.gs       # 【追記型】月次アーカイブDocs生成（NotebookLM連携用）
```

---

## 📊 新・データベース構造 (Google Sheets)

`initSpreadsheet()` によって自動作成されるテーブル構成です。

1. **articles** (収集した記事データベース)
   - カラム：`article_id`, `fetched_at`, `published_at`, `source`, `title`, `url`, `author`, `ai_summary`, `category`, `tags`, `importance`, `interest_score`, `reason`, `status`, `notified_at`
2. **reactions** (あなたのフィードバック履歴)
   - カラム：`timestamp`, `article_id`, `action` (open / good / bad / read_later), `url`, `title`, `note`
3. **interest_profile** (あなたの興味タグと重み)
   - カラム：`tag`, `weight`, `last_updated`, `reason`
4. **sources** (自律探索の補助キーワード／注目ドメイン等)
   - カラム：`keyword_or_domain`, `type` (include / exclude / focus), `enabled`, `note`
5. **settings** (動作設定)
   - カラム：`key`, `value`
6. **logs** (実行ログ)
   - カラム：`timestamp`, `function_name`, `status`, `message`

---

## 📅 今後の導入手順 (2段階方式)

### 段階 1: ローカルでの自動生成と clasp 同期
1. **コードの全自動書き換え**: 本プランに基づき、アンチグラビティがローカルワークスペース内のコード（`Initialize.gs`, `Code.gs`, `SearchAgent.gs`等）をすべて最新の自律探索・マスタードキュメント対応版に書き換えました。
2. **`clasp` による同期**: `clasp push` を行い、Google Apps Script プロジェクトへすべてのスクリプトファイルを一括転送します。

### 段階 2: クラウド配置と初期化
3. **スプレッドシート初期化**: GAS上で `initSpreadsheet()` を1回実行し、スプレッドシートに完璧な6枚のシートを構築します。
4. **環境変数の登録**:
   * GASの「スクリプトプロパティ」に以下を追加します。
     * `GEMINI_API_KEY` (Google AI Studioより取得)
     * `NOTIFY_EMAIL` (通知用のGmailアドレス)
     * `WEB_APP_URL` (GASをデプロイしたウェブアプリURL)
5. **マスターアーカイブ自動連携 (初月のみ)**:
   * 月次ジョブを実行すると、Google Driveのルートに自動的に `📖 Master News Agent Archive` というGoogle Docが作られます。このドキュメントをNotebookLMに一度ソース追加するだけで、以降はNotebookLM上の「再同期」をポチッと押すだけで自動的に全ニュースを学習させることができます。
6. **自動トリガー設定**: 毎朝動く時間主導トリガーをGAS管理画面から登録して完成です。
