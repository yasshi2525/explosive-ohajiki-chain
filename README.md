# ぶっこわしカーリング

これは「ストーン」と呼ばれる石を投げて、ぶつけて、破壊するゲームです。みんなで協力してノルマクリアを目指しましょう。

![スクリーンショット](./img/screenshot.png)

## [オリジナル](https://github.com/akashic-contents/explosive-ohajiki-chain) からの変更点

- 非サンドボックス環境でも動作するように
- プレイヤー名をユーザ名取得プラグインで取得
- 放送者（部屋主）が投球待ちキューのプレイヤーをプレイヤー追放プラグインで BAN 可能に（BAN されたプレイヤーは待機列・抽選から外れる）
  - BAN 機能は [`@multi-indiegame/akashic-player-ban`](https://github.com/multi-indiegame/akashic-player-ban) に対応した実行基盤で有効になります
- ゲーム終了時、結果を登録
  - ## スコア登録機能は [`@multi-indiegame/akashic-scoreboard`](https://github.com/multi-indiegame/akashic-scoreboard) に対応した実行基盤で有効になります
    - 全レベルクリア (`2-1`開始時点で参加していたプレイヤー)
      - `92.5%` 一人で投石した場合、ソロプレイクリア
      - `5` 人以上 (`2-1`開始時点以降)でクリアした場合、多人数プレイクリア
    - ゲーム終了時
      - 最大コンボ数
      - 急死に一生賞受賞

## ビルド方法

```sh
npm install # 最初に一度だけ
npm run build
```

## 実行方法

```sh
npm run serve # ブラウザで http://localhost:3300 を開く
```

## ゲーム設定

`assets/config.json` を編集することでゲームに関する設定を変更することができます。設定項目の詳細は `Configuration.ts` を参照ください。

## ライセンス

本リポジトリは MIT License の元で公開されています。 詳しくは [LICENSE](./LICENSE) をご覧ください。

ただし、画像ファイルおよび音声ファイルは CC BY 2.1 JP の元で公開されています。
