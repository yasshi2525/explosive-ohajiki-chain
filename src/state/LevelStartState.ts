import * as tl from "@akashic-extension/akashic-timeline";
import * as common from "./common";
import * as audio from "../audio";
import type { System } from "../System";
import type { OhajikiState } from "./OhajikiState";
import { BaseState } from "./BaseState";
import { ExplainGoalCutinE, LevelStartCutinE } from "../E";
import type { OhajikiGameEntity } from "../entity";
import type { FieldParameter } from "../Configuration";
import { TurnState } from "./TurnState";
import type { OhajikiCommand } from "../coeMessages";
import { GameClearState } from "./GameClearState";
import { LevelClearState } from "./LevelClearState";

/**
 * レベル開始モード。
 *
 * - new-game: 新しくゲームを始める。
 *   - レベル 0-0 から始まる。
 *   - プレイヤーパネルが３つ横から現れる。
 * - go-next: 次のレベル進む。
 *   - プレイヤーパネル１つ進める。
 */
export type LevelStartMode = "new-game" | "go-next";

export interface LevelStartStateParameterObject {
	/**
	 * レベル開始モード。
	 */
	mode: LevelStartMode;

	/**
	 * 真の時、チュートリアルから開始する。
	 */
	withTutorial: boolean;

	/**
	 * 真の時、プレイヤー待機列を１つ進める。
	 *
	 * mode === "go-next" の時のみ参照される。
	 * 省略時、偽。
	 */
	changePlayer?: boolean;
}

/**
 * レベルを進行し投石可能な状態にするステート。
 */
export class LevelStartState extends BaseState {
	private font!: g.Font;
	private timeline!: tl.Timeline;

	private withTutorial: boolean;
	private changePlayer: boolean;
	private mode: LevelStartMode;

	/**
	 * コンストラクタ。
	 */
	constructor(param: LevelStartStateParameterObject) {
		super();
		this.withTutorial = param.withTutorial;
		this.changePlayer = !!param.changePlayer;
		this.mode = param.mode;
	}

	enter(system: System): void {
		this.font = new g.DynamicFont({
			game: g.game,
			fontFamily: "monospace",
			size: 36
		});

		this.timeline = new tl.Timeline(system.scene);

		if (this.mode === "new-game") {
			system.playerManager.initQueue();
			this.setupField(system.config.fields[system.fieldIndex], system);

			// マネージャに登録なく BAN されてないプレイヤーなら途中参加を認める。
			if (!system.playerManager.findPlayer(g.game.selfId ?? "") &&
				!system.playerManager.isBannedPlayer(g.game.selfId ?? "")) {
				system.showInPlayApplyButton();
			}

			audio.playbackBGM("/assets/common/bgm/playing");
		}

		this.setupSequence(system);
	}

	update(_system: System): OhajikiState | null {
		return null;
	}

	leave(_system: System): void {
		this.timeline.destroy();
		this.font.destroy();
	}

	command(system: System, command: OhajikiCommand): OhajikiState | null {
		let nextState: OhajikiState | null = null;

		// NOTE: wind する必要のない（してはいけない）コマンドは早期リターンすること。
		if (command.type === "add-player") {
			common.handleAddPlayerCommand(system, command);
			return nextState;
		}

		this.timeline.completeAll();

		if (command.type === "start-game") {
			nextState = new TurnState();
		} else if (command.type === "level-clear-multi") {
			system.restore(command.serialized);
			nextState = new LevelClearState(true);
		} else if (command.type === "game-clear") {
			system.restore(command.serialized);
			nextState = new GameClearState();
		}

		return nextState;
	}

	private setupField(param: FieldParameter, system: System): void {
		system.setupField(param);
	}

	/**
	 * シーケンスの準備。
	 */
	private setupSequence(system: System): void {
		const scene = system.scene;

		const tween = this.timeline.create({});

		// 待機列パネルの初期配置。
		if (this.mode === "new-game") {
			// それぞれのプレイヤーパネルが画面外から現れる。
			// パネルの blink はここで設定するので notifyWinningByLottery() = 通知演出 では blink させない。
			let winning = false;
			system.playerManager.queue.forEach((playerData, idx) => {
				system.addPlayerPanel(playerData, idx === 0, tween);
				const isMyPanel = playerData.player.id === g.game.selfId;
				const panel = system.getPlayerPanel(idx);
				panel.blink = isMyPanel;
				winning = winning || isMyPanel;
			});
			if (winning) {
				tween
					.call(() => system.notifyWinningByLottery(this.timeline.create({}), null));
			}
		}

		// ゲームの目標提示。
		if (this.withTutorial) {
			tween
				.call(() => {
					const cutin = new ExplainGoalCutinE({
						scene,
						messageImageAsset: scene.asset.getImage("/assets/ui/cutin/cut_in_text.png"),
						opacity: 0
					});
					scene.append(cutin);
					const cutinTween = this.timeline.create(cutin);
					cutinTween
						.fadeIn(150)
						.call(() => audio.playbackSE("/assets/common/se/jingle/game_start"))
						.wait(3000)
						.fadeOut(150)
						.call(() => cutin.destroy());
				})
				.wait(150 + 3000 + 150);
		}

		if (this.mode === "new-game") {
			// レベル 0-0 へ進行、おはじきの配置。
			tween
				.call(() => {
					const hiddenOhajikis = system.setupLevel({
						type: "go-to",
						cont: false,
						hidden: true,
						worldId: 0,
						areaId: 0
					}).filter(entity => entity.ohajikiE && !entity.ohajikiE.visible());
					this.setupSequenceSequel(system, tween, hiddenOhajikis);
				});
		} else if (this.mode === "go-next") {
			if (this.changePlayer) {
				const playerManager = system.playerManager;

				// 待機列(queue)の進行。
				playerManager.changePlayer();

				// 待機列パネルの更新、次のレベルへ進行、おはじきの配置。
				// 全員が追放されて待機列が埋まらなかった時はパネルを足さない。
				const addedPanels = system.syncPlayerPanels(true, tween);

				// もし自分が待機列に現れた＝当選したなら、当選通知。
				const myAddedPanel = addedPanels.filter(added => added.playerData.player.id === g.game.selfId)[0];
				if (myAddedPanel) {
					tween
						.call(() => system.notifyWinningByLottery(this.timeline.create({}), myAddedPanel.panel));
				}
			}

			tween
				.call(() => {
					const hiddenOhajikis = system.setupLevel({
						type: "go-next",
						cont: true,
						hidden: true

					}).filter(entity => entity.ohajikiE && !entity.ohajikiE.visible());
					this.setupSequenceSequel(system, tween, hiddenOhajikis);
				});
		}
	}

	/**
	 * シーケンスの続きの準備。
	 *
	 * おはじきの出現、レベルやノルマ・進捗の表示。
	 */
	private setupSequenceSequel(system: System, tween: tl.Tween, hiddenOhajikis: OhajikiGameEntity[]): void {
		const scene = system.scene;

		const winningRateEStartOpacity = system.winningRateE.opacity;
		tween.every(
			(e, p) => {
				const opacity = winningRateEStartOpacity * (1 - p) + p;
				system.winningRateE.opacity = opacity;
				system.winningRateE.modified();
			},
			500
		);

		// tween に続きを与える
		hiddenOhajikis.forEach(ohajiki => {
			tween
				.wait(250)
				.call(() => {
					ohajiki.ohajikiE.show();
					audio.playbackSE("/assets/common/se/spawn");
				});
		});

		tween
			.wait(1000)
			.call(() => {
				const cutin = new LevelStartCutinE({
					scene,
					worldId: system.worldId,
					areaId: system.areaId,
					remianNorma: system.remainNorma,
					currentLevelIdx: system.getCurrentLevelUId(),
					universeSize: system.getUniverseSize(),
					normalMarkImageAsset: scene.asset.getImage("/assets/ui/cutin/cut_in_circle.png"),
					currentMarkImageAsset: scene.asset.getImage("/assets/ui/cutin/cut_in_circle_now.png"),
					completeMarkImageAsset: scene.asset.getImage("/assets/ui/cutin/cut_in_circle_done.png"),
					lineImageAsset: scene.asset.getImage("/assets/ui/cutin/cut_in_circle_back_line.png"),
					opacity: 0
				});
				scene.append(cutin);
				const cutinTween = this.timeline.create(cutin);
				cutinTween
					.fadeIn(150)
					.call(() => audio.playbackSE("/assets/common/se/jingle/stage_start"))
					.wait(3000)
					.fadeOut(150)
					.call(() => cutin.destroy());
			})
			.wait(150 + 3000 + 150);

		// Active Instance がゲームの進行と結果の責任を持つ。
		if (g.game.isActiveInstance()) {
			tween
				.wait(1000) // 進行の遅れているクライアントへの配慮。
				.call(() => {
					// おはじきを配置してもノルマが０以下ならクリア処理から。
					if (system.remainNorma > 0) {
						system.scene.send({ type: "start-game" });
					} else {
						if (system.isGameClear()) {
							system.scene.send({
								type: "game-clear",
								serialized: system.save()
							});
						} else {
							system.scene.send({
								type: "level-clear-multi",
								serialized: system.save()
							});
						}
					}
				});
		}
	}
}
