# MICHIKUSA 実装計画書

## 1. 目的

現在地と空き時間から、Google ADKが行き先・順番・現地での遊び・帰宅時刻を決定し、地図とGoogleカレンダーへ反映するスマホ対応Webアプリを完成させます。

提出物は次を含みます。

- Next.js Webアプリ
- Google ADKエージェントAPI
- Google Places / Routes / Calendar接続
- Turso永続化
- APIキーなしで動くデモモード
- Cloud Run用コンテナとCloud Build設定
- CI、テスト、セキュリティ資料
- 審査デモ台本

## 2. 完了条件

### 体験

- スマホ幅390pxで地図と一つの開始ボタンが表示される。
- 家／外／自動判定のいずれからもルートを生成できる。
- 生成中にADKノード、候補点、ピン、ルートが段階表示される。
- 60〜180分の標準入力で2〜4地点のルートが作られる。
- 各地点に一つの遊びとLUCKが付く。
- 出発承認後、Calendarイベントを一括登録する。
- 遅延、休業、疲労、帰宅希望で再計画できる。
- 完了後に共有カードを表示・保存できる。

### 技術

- WebとAgentを別Cloud Runサービスとして配置できる。
- Agentサービスは非公開にできる。
- ADK計画グラフ18ノード、再計画7ノード、Calendar実行4ノードが動く。
- 実API失敗時にデモデータへ切り替えられる。
- Calendarトークンを暗号化して保存する。
- lint、型検査、Agentテスト、Next.jsビルドが通る。
- ZIPに認証情報、`.env.local`、ビルド成果物、依存関係を含めない。

## 3. 実装フェーズ

| フェーズ | 実装内容 | 受入条件 | 状態 |
|---|---|---|---|
| A. 基盤 | Next.js、TypeScript、Python、ADK、Turso、環境変数 | WebとAgentのhealthが返る | 完了 |
| B. ドメイン | Plan、Stop、Activity、Safety、CalendarEventの型 | Web/Python間でJSON検証できる | 完了 |
| C. 計画グラフ | 状況、並列探索、経路、遊び、安全、時間割、記憶 | 18ノードが完走しPlanを返す | 完了 |
| D. 再計画 | 遅延、休業、疲労、帰宅 | 帰宅時刻を超えずPlanを更新 | 完了 |
| E. Calendar | OAuth、freeBusy、専用Calendar、作成・更新 | 承認後だけ予定を反映 | 完了 |
| F. UI | 地図一枚、韓国系パステル、状態遷移 | 390pxで主要操作が一つに見える | 完了 |
| G. 永続化 | セッション、設定、Plan、LUCK、OAuth | 再読込後も設定と履歴を取得 | 完了 |
| H. デモモード | デモPlaces、推定経路、デモLLM、Calendar領収書 | 認証情報なしで全導線を操作 | 完了 |
| I. 配置 | Docker、Cloud Build、Cloud Run、Secret Manager | 2サービスを配置可能 | 完了（設定ファイル） |
| J. 検証 | pytest、ESLint、tsc、build、API、ブラウザ | 検証記録に結果を残す | 実行中 |

## 4. 実装順序

### 4.1 共通データモデル

1. Web側の`src/types/michikusa.ts`を定義する。
2. Agent側のPydanticモデルを同じJSON形状にそろえる。
3. API入口でZod、Agent入口でPydanticによる二重検査を行う。
4. 日時はISO 8601、タイムゾーンは`Asia/Tokyo`を明示する。

### 4.2 ADK計画グラフ

1. Situation Agentで家／外を判定する。
2. Calendar、Places、Mobility、Memoryを並列実行する。
3. Join後、候補ごとの移動時間を算出する。
4. 直前地点からの移動時間を毎回計算し、ジグザグ経路を避ける。
5. 次の予定と帰宅余白を含めて、実行可能な地点だけを採用する。
6. Geminiで各地点の一行アクティビティを作る。
7. 営業、予算、夜間、帰宅時刻をコードで検査する。
8. 必要箇所だけ修復し、再検査する。
9. Calendarイベントと共有情報を作る。
10. Geminiで短い呼び名を作り、Planを確定する。

### 4.3 ストリーミング

Agent APIはNDJSONを返します。

```text
run_started
trace: situation_agent running/done
trace: parallel scouts ...
candidate ...
pin ...
plan ...
```

Next.js Route Handlerはこのストリームをブラウザへ中継し、PlanイベントだけTursoへ保存します。UIは候補、ピン、トレースを受信した順に描画します。

### 4.4 Calendar

1. `calendar.freebusy`で空き状況を取得する。
2. `calendar.app.created`でMICHIKUSA専用Calendarを管理する。
3. OAuth stateをHttpOnly Cookieで照合する。
4. トークンをAES-256-GCMで暗号化する。
5. 「この道草で出発」の後にCalendar実行グラフを呼ぶ。
6. 再計画時は既存イベントIDを渡し、作成ではなく更新する。

### 4.5 UI

1. 画面全体を地図にする。
2. 通常時の主要操作を一つにする。
3. 設定、履歴、Calendar接続、AgentトレースはBottom Sheetに隠す。
4. 計画中は、文章ではなく候補点、ピン、線の動きでAgentを見せる。
5. 色に意味を割り当てる。
   - ピンク: 発見
   - パープル: 移動・予想外
   - グリーン: 休憩・読書・自然
   - オレンジ: 出発・LUCK・実行
6. `prefers-reduced-motion`へ対応する。
7. 主要操作は44px以上、画面下部の親指領域へ配置する。

## 5. テスト計画

### Agent契約テスト

| ケース | 検査内容 |
|---|---|
| 標準90分 | 18ノード以上、2〜4ピン、Calendar下書き、安全通過 |
| 家 | departureモード |
| 外 | detourモード |
| Calendarデモ | 下書きと同数のイベント領収書 |
| 遅延 | 終了時刻がreturn_byを超えない |
| 休業 | 残り地点を差し替える |
| 疲労 | 滞在・地点数を減らす |
| 帰宅 | 未完了地点を取り除く |

### Web静的検査

- ESLint
- TypeScript `--noEmit`
- Next.js本番ビルド
- 本番依存関係の脆弱性監査
- シークレット文字列検査

### 実行検査

- `/api/health`
- `/api/plan/stream`
- `/api/calendar/commit`デモ
- `/api/replan`
- Plan保存と履歴取得
- スマホ幅390pxの全状態
- ブラウザConsole Errorがないこと

## 6. リスクと対処

| リスク | 対処 |
|---|---|
| 外部APIが失敗 | 同じADKグラフをデモPlacesと推定経路で継続 |
| 候補が遠くルートが1件になる | 直前地点から再評価し、帰宅余白に収まる候補だけ採用 |
| LLM出力が不正 | Pydanticの構造化出力、フォールバックActivity Library |
| Calendarを重複登録 | 既存イベントIDを再計画時に渡して更新 |
| 自宅位置が共有される | 共有データをエリア名と抽象経路に限定 |
| OAuthトークン漏えい | HttpOnly Cookie、state照合、AES-GCM、Secret Manager |
| 非公開Agentへ不正アクセス | Cloud Run IAM IDトークンと共有シークレット |
| 課金増加 | フィールドマスク、候補上限、レート制御、Cloud Run最大数 |

## 7. 提出前チェック

- [x] 認証情報なしで起動できる
- [x] ADKグラフテストが通る
- [x] lintと型検査が通る
- [ ] Next.js本番ビルドが通る
- [ ] WebとAgentを同時起動しスモークテストが通る
- [ ] 390pxのスクリーンショットを確認する
- [ ] ZIP展開後に同じ手順で起動できる
- [ ] ZIPへ秘密情報が入っていない
- [ ] SHA-256を発行する
