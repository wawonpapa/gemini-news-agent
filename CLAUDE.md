# Personal News Agent - Project Guidelines

This file provides critical guidelines and constraints for Claude Code when working on this project.

## 🚨 Critical Constraints (Strict Rules)

- **Do Not Auto-Commit**: Never run `git commit` automatically. Staging files (`git add`) and checking status (`git status`) are allowed, but commits must only be executed when the user explicitly instructs to "commit".
- **Prevent Emoji Character Corruption (GAS Environment)**: Do not write raw 4-byte characters/emojis (e.g., `📝`, `🚀`, `🎉`, `↗`) inside Google Apps Script (.gs) code or HTML files. Use their corresponding HTML numeric entities (e.g., `&#128221;`, `&#128640;`, `&#127881;`, `&#8599;`) or Unicode escape sequences to prevent character encoding issues.
- **Strict PR & Issue Association**: When creating pull requests, ensure that `Resolves #<IssueNumber>` or `Closes #<IssueNumber>` is explicitly written in the PR description (not just the title) to ensure issues automatically close on merge.

## 🛠️ Architecture & Technology Stack

- **Platform**: Google Apps Script (GAS) (V8 Runtime)
- **Database**: Google Sheets (used as a lightweight relational store)
- **AI Models**: Gemini API (`gemini-3.1-flash-lite` for cost-efficiency)
- **Structured Outputs**: Always use `responseSchema` for API calls to prevent parser failures.
- **Safe Feedback Actions**: The feedback links (Good/Bad/Read Later) in emails must redirect to a confirmation screen served by `doGet` in `Actions.gs` to prevent spam-clicks by automated mail scanners.

## 💡 Future Development & Refactoring Policies

- **Feature Flags / Toggle-able Implementations**:
  - When introducing or modifying score adjustment logic (e.g., tags weighting, domain-based ranking), **keep the previous logic intact** at a functional level.
  - Implement new changes using a switchable design (e.g., using settings stored in the `settings` sheet or global configuration constants) so that new logic can be easily toggled **ON/OFF** without breaking legacy behavior.
