# Project Rules & Custom Instructions - Personal News Agent

Google Antigravity は、本プロジェクト（Personal News Agent）で作業する際、以下のルールを常に最優先で順守してください。

---

## 🚨 Git およびコミットに関する最優先ルール

*   **自動コミットの禁止**:
    *   作業の完了時やファイルの新規作成時であっても、**自動的に `git commit` コマンドを実行してはなりません**。
    *   コミット操作は、**ユーザーからチャット上で「コミットして」と明示的な指示があった場合のみ**実行してください。
*   **ステージング（`git add`）の扱い**:
    *   ファイルの追加や変更を行った場合、内容の確認や状況整理のために `git status` を確認したり、ステージング領域に追加（`git add`）することは許可されますが、コミットは必ずユーザーの指示を待ってください。

---

## 🛠️ プロジェクト概要とアーキテクチャ

*   **技術スタック**:
    *   Google Apps Script (GAS) 実行環境 (V8ランタイム)
    *   Google Sheets (簡易データベースとして使用)
    *   Gemini API (Google AI Studio / `gemini-1.5-flash` モデル)
    *   Google ドキュメント (Master Doc を用いた NotebookLM 連携)
*   **主要な動作仕様**:
    *   **完全自律探索**: Inoreader などの外部有料RSS収集サービスは使用せず、Gemini の **Google Search Grounding (Web検索ツール)** を用いて、興味タグからインターネット全体を毎朝自律リサーチします。
    *   **構造化出力の徹底**: APIでの要約・分類のやり取りは `responseSchema` を適用した Structured Outputs で行い、不安定なテキスト置換によるJSONパースは避けてください。
    *   **アクションリンクの安全性**: Gmail通知に埋め込まれるフィードバックリンク（Good/Bad等）は、メールスキャナーの自動クリック誤作動を防ぐために、GAS Webアプリの doGet で「確定ボタン」を挟んだ確認用UIを返す設計を維持してください。
    *   **NotebookLM 連携の省力化**: 月次まとめは単一のマスターGoogleドキュメント `📖 Master News Agent Archive` の末尾に自動追記（アペンド）し、NotebookLM上でソースの「再同期」を1クリックするだけで最新ニュースが反映される構造を維持してください。
