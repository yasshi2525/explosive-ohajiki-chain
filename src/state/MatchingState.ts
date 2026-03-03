import * as fsm from "../finite-state-machine";
import * as utils from "../utils";
import * as common from "./common";
import * as tl from "@akashic-extension/akashic-timeline";
import { resolvePlayerInfo } from "@akashic-extension/resolve-player-info";
import { HowToPlayE, FlashButtonE, CountDownE, DoingE } from "../E";
import type { System } from "../System";
import type { OhajikiActionData, OhajikiCommand } from "../coeMessages";
import type { OhajikiState } from "./OhajikiState";
import { BaseState } from "./BaseState";
import { LevelStartState } from "./LevelStartState";
import type { Difficulty } from "../types";

function createDifficultyButtons(context: System): FlashButtonE[] {
	const scene = context.scene;
	const buttonSettings = [
		{ difficulty: "easy", img1: "/assets/ui/matching/txt_easy.png", img2: "/assets/ui/matching/txt_easy_disable.png" },
		{ difficulty: "normal", img1: "/assets/ui/matching/txt_normal.png", img2: "/assets/ui/matching/txt_normal_disable.png" },
		{ difficulty: "hard", img1: "/assets/ui/matching/txt_hard.png", img2: "/assets/ui/matching/txt_hard_disable.png" },
		{ difficulty: "crazy", img1: "/assets/ui/matching/txt_crazy.png", img2: "/assets/ui/matching/txt_crazy_disable.png" }
	];

	let flashButtonX = 140;
	const flashButtons = buttonSettings.map(info => {
		const flashButton = new FlashButtonE({
			scene,
			x: flashButtonX,
			y: 479,
			width: 220,
			height: 110,
			active: true,
			patchMode: "nine",
			patchSize: 5,
			activeButtonImage: scene.asset.getImage("/assets/ui/matching/difficult_btn.png"),
			inactiveButtonImage: scene.asset.getImage("/assets/ui/matching/difficult_btn_disable.png"),
			activeLabelImage: scene.asset.getImage(info.img1),
			inactiveLabelImage: scene.asset.getImage(info.img2),
			touchable: true,
			tag: info.difficulty
		});
		flashButtonX += flashButton.width + 40;

		return flashButton;
	});

	flashButtons.forEach(btn => {
		btn.onPointDown.addOnce(() => {
			flashButtons.forEach(btn2 => btn2.touchable = false);
			if (context.isHost) {
				// ホストは自動参加。
				context.logger.log("auto apply");
				resolvePlayerInfo({}, (err, playerInfo) => {
					if (err) {
						context.logger.log("resolvePlayerInfo err:", err);
					}
					if (playerInfo?.name) {
						context.displayName = playerInfo.name;
					}
					scene.send({
						type: "select-difficulty",
						difficulty: btn.tag as Difficulty
					});
					utils.applyForPlay(context);
				});
			} else {
				// 念の為のフォールバック
				scene.send({
					type: "select-difficulty",
					difficulty: btn.tag as Difficulty
				});
			}
		});
	});

	return flashButtons;
}

function createCountDown(scene: g.Scene, y: number, initialNum: number): CountDownE {
	const numbers = "0123456789".split("").map(ch => scene.asset.getImage("/assets/common/numbers/txt_num_" + ch + ".png"));
	const countDown = new CountDownE({
		scene: scene,
		body: scene.asset.getImage("/assets/ui/matching/txt_remain_sec.png"),
		numbers: numbers,
		numberArea: {
			x: 324, y: 0, width: 80, height: 36
		},
		initialNum: initialNum
	});
	countDown.x = (g.game.width - countDown.width) / 2;
	countDown.y = y;
	countDown.modified();

	return countDown;
}

/**
 * マッチングステートのホスト固有の処理。
 */
class HostMatchingState extends BaseState {
	private countDownInSec: number;

	private timeline!: tl.Timeline;

	private uiRoot!: g.E;
	private difficultyButtons!: FlashButtonE[];
	private difficultySelectMessageSpr!: g.Sprite;
	private difficultySequenceMessageSpr!: g.Sprite;
	private countDownE!: CountDownE;

	constructor(countDownInSec: number) {
		super();
		this.countDownInSec = countDownInSec;
	}

	enter(context: System): void {
		this.timeline = new tl.Timeline(context.scene);

		this.uiRoot = this.setupUI(context);

		context.origin!.append(this.uiRoot);
	}

	update(_context: System): OhajikiState | null {
		return null;
	}

	leave(_context: System): void {
		this.timeline.destroy();
		this.uiRoot.destroy();
	}

	command(context: System, command: OhajikiCommand): OhajikiState | null {
		const scene = context.scene;

		if (command.type === "add-player") {
			context.logger.log(`エントリー数: ${context.playerManager.players.length}`);
		} else if (command.type === "select-difficulty") {
			this.difficultyButtons.forEach(btn => {
				if (btn.tag === command.difficulty) {
					btn.startFlash();
				} else {
					btn.startCrossfade();
				}
			});

			let waitMsgSpr: g.Sprite | null = null;

			// 参加者が決定するまでお待ちください。
			const tween = this.timeline.create({});
			tween
				.wait(1000) // flash が終わるのを待つ。
				.call(() => {
					this.difficultySelectMessageSpr.destroy();
					this.difficultySequenceMessageSpr.destroy();

					waitMsgSpr = new g.Sprite({
						scene,
						src: scene.asset.getImage("/assets/ui/matching/txt_wait.png"),
						x: 167, y: 374
					});

					this.countDownE = createCountDown(scene, 637, this.countDownInSec);
					this.countDownE.start();

					this.uiRoot.append(waitMsgSpr);
					this.uiRoot.append(this.countDownE);
				})
				.wait((this.countDownInSec + 1) * 1000)
				.call(() => {
					this.countDownE.destroy();
					waitMsgSpr!.destroy();

					// 参加者が決定しました。
					const spr = new g.Sprite({
						scene,
						src: scene.asset.getImage("/assets/ui/matching/txt_join_set.png"),
						x: 363, y: 374
					});
					this.uiRoot.append(spr);
				})
				.wait(4000);

			// active instance が次のシーンへ進める。
			// sandbox では active instance は host.
			// serve では active instance は guest.
			if (g.game.isActiveInstance()) {
				tween
					.call(() => context.scene.send({
						type: "start-introduction",
						difficulty: command.difficulty
					}));
			}
		}

		return null;
	}

	private setupUI(context: System): g.E {
		const scene = context.scene;
		const root = new g.E({ scene });

		this.difficultyButtons = createDifficultyButtons(context);
		this.difficultyButtons.forEach(btn => root.append(btn));

		this.difficultySelectMessageSpr = new g.Sprite({
			scene,
			src: scene.asset.getImage("/assets/ui/matching/txt_choise_difficult.png"),
			x: 307,
			y: 375
		});
		this.difficultySequenceMessageSpr = new g.Sprite({
			scene,
			src: scene.asset.getImage("/assets/ui/matching/txt_choise.png"),
			x: 317,
			y: 636
		});

		root.append(this.difficultySelectMessageSpr);
		root.append(this.difficultySequenceMessageSpr);

		return root;
	}
}

/**
 * マッチングステートのゲスト固有の処理。
 */
class GuestMatchingState extends BaseState {
	private countDownInSec: number;
	private timeline!: tl.Timeline;
	private uiRoot!: g.E;
	private doingE!: DoingE;
	private countDownE!: CountDownE;

	constructor(countDownInSec: number) {
		super();
		this.countDownInSec = countDownInSec;
	}

	enter(context: System): void {
		this.timeline = new tl.Timeline(context.scene);

		this.uiRoot = this.setupUI(context);

		context.origin!.append(this.uiRoot);
	}

	update(_context: System): OhajikiState | null {
		return null;
	}

	leave(_context: System): void {
		this.timeline.destroy();
		this.uiRoot.destroy();
	}

	command(context: System, command: OhajikiCommand): OhajikiState | null {
		const scene = context.scene;

		if (command.type === "add-player") {
			context.logger.log(`エントリー数: ${context.playerManager.players.length}`);
		} else if (command.type === "select-difficulty") {

			let applyButton: FlashButtonE;

			const tween = this.timeline.create({});
			tween
				.wait(1000)
				.call(() => {
					this.doingE.destroy();

					this.countDownE = createCountDown(scene, 528, this.countDownInSec);
					this.countDownE.start();

					const activeLabelImagePaths = {
						easy: "/assets/ui/matching/btn_txt_easy.png",
						normal: "/assets/ui/matching/btn_txt_normal.png",
						hard: "/assets/ui/matching/btn_txt_hard.png",
						crazy: "/assets/ui/matching/btn_txt_crazy.png"
					};

					applyButton = new FlashButtonE({
						scene,
						x: 277, y: 360,
						width: 720, height: 120,
						active: true,
						patchMode: "nine",
						patchSize: 5,
						activeButtonImage: scene.asset.getImage("/assets/ui/matching/difficult_btn.png"),
						inactiveButtonImage: scene.asset.getImage("/assets/ui/matching/difficult_btn_disable.png"),
						activeLabelImage: scene.asset.getImage(activeLabelImagePaths[command.difficulty]),
						inactiveLabelImage: scene.asset.getImage("/assets/ui/matching/btn_txt_join_done.png"),
						touchable: true
					});

					applyButton.onPointUp.addOnce(() => {
						applyButton.startFlash();
						applyButton.flashPeak.add(() => applyButton.startCrossfade(0)); // 暗い画像へは一瞬で切り替える。
						applyButton.touchable = false;
						resolvePlayerInfo({}, (err, playerInfo) => {
							if (err) {
								context.logger.log("resolvePlayerInfo err:", err);
							}
							if (playerInfo?.name) {
								context.displayName = playerInfo.name;
							}
							utils.applyForPlay(context);
						});
					});


					this.uiRoot.append(this.countDownE);
					this.uiRoot.append(applyButton);
				})
				.wait((this.countDownInSec + 1) * 1000)
				.call(() => {
					if (applyButton.touchable) {
						applyButton.touchable = false;
						// 押せない孤島を示すためにグレーにしていたが、
						// "参加受付完了" となって紛らわしいので
						// これをやめる。
						// applyButton.startCrossfade();
					}
				})
				.wait(4000);

			// active instance が次のシーンへ進める。
			// sandbox では active instance は host.
			// serve では active instance は guest.
			if (g.game.isActiveInstance()) {
				tween
					.call(() => context.scene.send({
						type: "start-introduction",
						difficulty: command.difficulty
					}));
			}
		}

		return null;
	}

	private setupUI(context: System): g.E {
		const scene = context.scene;
		const root = new g.E({ scene });

		this.doingE = new DoingE({
			scene,
			x: 318,
			y: 478,
			body: scene.asset.getImage("/assets/ui/matching/txt_choosing_difficult.png"),
			dot: scene.asset.getImage("/assets/ui/matching/txt_point.png")
		});
		this.doingE.start();

		root.append(this.doingE);

		return root;
	}
}

/**
 * マッチングステート。
 *
 * プレイヤーの参加を呼びかけるステート。
 *
 * 内部にサブステートを持ち、ホストとゲストそれぞれ固有の処理を委譲している。
 */
export class MatchingState extends BaseState {
	private stateManager!: fsm.StateManager<System, OhajikiActionData, OhajikiCommand>;
	private howToPlayE!: g.E;
	private background!: g.FilledRect;

	constructor() {
		super();
	}

	enter(context: System): void {
		const scene = context.scene;

		context.originStack.push(new g.E({ scene }));

		this.background = new g.FilledRect({
			scene,
			width: g.game.width,
			height: g.game.height,
			cssColor: "#00062B",
			opacity: 0xB3 / 0xFF
		});

		const font = new g.DynamicFont({
			game: g.game,
			size: 32,
			fontFamily: "monospace"
		});

		this.howToPlayE = HowToPlayE.createWithPageButton({
			scene,
			backgroundImage: scene.asset.getImage("/assets/ui/cutin/howto_dialog.png"),
			asobikataImageAsset: scene.asset.getImage("/assets/ui/matching/txt_howto.png"),
			pageNoImageAssets: [
				scene.asset.getImage("/assets/ui/matching/txt_howto_NO1.png"),
				scene.asset.getImage("/assets/ui/matching/txt_howto_NO2.png"),
				scene.asset.getImage("/assets/ui/matching/txt_howto_NO3.png"),
				scene.asset.getImage("/assets/ui/matching/txt_howto_NO4.png"),
				scene.asset.getImage("/assets/ui/matching/txt_howto_NO5.png")
			],
			leftButtonImageAsset: scene.asset.getImage("/assets/ui/matching/howto_btn.png"), // 右向きを内部で反転。
			rightButtonImageAsset: scene.asset.getImage("/assets/ui/matching/howto_btn.png"),
			textLines: context.config.matching.howToPlayText,
			font,
			width: 1000,
			height: 280,
			x: 140,
			y: 48,
			borderWidth: 14,
		});

		context.origin!.append(this.background);
		context.origin!.append(this.howToPlayE);

		const countDownInSec = context.config.matching.receptionTimeInSec;
		const state = context.isHost ?
			new HostMatchingState(countDownInSec) :
			new GuestMatchingState(countDownInSec);

		this.stateManager = new fsm.StateManager<System, OhajikiActionData, OhajikiCommand>(context, state);
	}

	update(_context: System): OhajikiState | null {
		this.stateManager.update();
		return null;
	}

	leave(context: System): void {
		this.stateManager.state.leave(context);
		this.howToPlayE.destroy();
		this.background.destroy();
		context.originStack.pop();
	}

	command(context: System, command: OhajikiCommand): OhajikiState | null {
		let next: OhajikiState | null = null;

		if (command.type === "add-player") {
			common.handleAddPlayerCommand(context, command);
		} else if (command.type === "start-introduction") {
			context.difficulty = command.difficulty;
			next = new LevelStartState({
				withTutorial: true,
				mode: "new-game"
			});
		}

		this.stateManager.command(command);

		return next;
	}
}
