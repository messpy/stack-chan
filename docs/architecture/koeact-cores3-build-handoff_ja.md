# KoeAct-JP CoreS3 単体ビルド・検証手順 (kmac)

- GitHub: messpy/stack-chan
- branch: feat/koeact-cores3-standalone-handoff-20261103
- local clone: /mnt/data/Development/stackchan/stack-chan
- upstream: https://huggingface.co/ayousanz/KoeAct-JP (Apache-2.0)

**重要**: 現在のStackChanファームウェアへのESP-DLネイティブ推論統合は未完成。ここでは公式のKoeAct単体版を別フォルダに取得・検証・ビルドする。CoreS3への書込は禁止。公式単体版でもJSON復元・棄却の一部はPC側に残る。

## 1. まずGitの変更確認

    clear
    cd /mnt/data/Development/stackchan/stack-chan
    git status --short --branch
    git remote -v

変更があれば無断でreset/cleanしない。作業ツリーがクリーンな場合のみ次を実行。

    clear
    cd /mnt/data/Development/stackchan/stack-chan
    git fetch origin
    git switch -c feat/koeact-cores3-standalone-handoff-20261103 --track origin/feat/koeact-cores3-standalone-handoff-20261103

同名のローカルブランチが存在する場合はgit switchで選択し、git pull --ff-only。

## 2. 開発環境を準備

kmacの既知状態はNode v18.19.1、mcconfig未検出、MODDABLE/IDF_PATH未設定。Node 22を使用する。nvmがあるならnvm use 22、未インストールならnvm install 22。そのあと:

    clear
    cd /mnt/data/Development/stackchan/stack-chan/firmware
    npm ci
    npm run doctor

Moddable SDKが無ければREADMEの手順通り npm run setup と npm run setup -- --device=esp32。xs-devの設定が存在する場合は source "$HOME/.local/share/xs-dev-export.sh" の後、command -v mcconfig と idf.py --version で確認する。

## 3. 既存Archiveの試験・ビルド（本体書込なし）

    clear
    cd /mnt/data/Development/stackchan/stack-chan/firmware
    npm run test:koeact-standalone
    npm run test:archive-ui
    npm run init:archive
    npm run build:archive

init:archiveは未存在のprivate manifestだけ作る。既存ファイルは上書きしない。build:archiveはKoeAct推論がまだ組み込まれていない既存のArchiveをビルドする。

## 4. KoeAct公式単体版を別途ビルド

事前にhf CLIを準備（uv tool install huggingface_hub等）。公式のCoreS3版はESP-IDF v5.5.5で動作確認されている。使用するidf.py --versionを確認し、既存のSDKを勝手に上書きしない。

    clear
    cd /mnt/data/Development/stackchan/stack-chan/firmware
    export KOEACT_MODEL_DIR=/mnt/data/Development/stackchan/koeact-jp
    bash scripts/koeact-standalone-build.sh check
    bash scripts/koeact-standalone-build.sh fetch
    bash scripts/koeact-standalone-build.sh verify
    bash scripts/koeact-standalone-build.sh build

check/verifyは読み取り専用、fetch/buildはyes/noで確認。SHA256SUMSとモデル重みを照合してからビルド。buildはFlashへ書き込まない。

## 5. 次に必要な実装

Issue #17: ESP-DLのModdable/Cへの組込み、I2Sマイク排他、モデル重み格納用の16MB Flashパーティション、RAM/PSRAM負荷、CoreS3内でのJSON復元、実機音声試験。これらが完成するまではKoeActを利用した本体単独の操作は未実装。

ログ共有ではprivate manifest、秘密トークン、Wi-Fiパスワードを除外。
