import * as tl from "@akashic-extension/akashic-timeline";
import { isBanned } from "@multi-indiegame/akashic-player-ban";
import * as audio from "../audio";
import * as utils from "../utils";
import * as common from "./common";
import type { ExplosionEvent, SparkEvent, ExplosionParamEx } from "../System";
import type { System, OhajikiScene } from "../System";
import type { OhajikiState } from "./OhajikiState";
import { BaseState } from "./BaseState";
import type { Vector2Like } from "../math";
import { Vec2 } from "../math";
import type { ExplosionParam, Appearance } from "../entity";
import type { OhajikiGameEntity } from "../entity";
import { SwingArrow, KoKoE, NiceButtonE } from "../E";
import type { OhajikiCommand } from "../coeMessages";
import { GameClearState } from "./GameClearState";
import { GameOverState } from "./GameOverState";
import { LevelClearState } from "./LevelClearState";

/**
 * FrameSprite を一度再生し破棄するアクションを tween に作成する。
 *
 * @param frameSprite
 * @param tween
 */
function createFrameSpriteTween(
	frameSprite: g.FrameSprite,
	tween: tl.Tween,
): void {
	const duration = frameSprite.frames.length * ((1 / g.game.fps) * 1000);

	tween
		.every((e, p) => {
			frameSprite.frameNumber = Math.floor(
				(frameSprite.frames.length - 1) * p,
			);
			// context.logger.log(`frame number = ${frameSprite.frameNumber}, p = ${p}`);
			frameSprite.modified();
		}, duration)
		.call(() => {
			frameSprite.destroy();
		});
}

/**
 * 制限角度内のランダムな方向を返す。
 */
function getRandomDirection(maxAngle: number): Vec2 {
	const th = (g.game.random.generate() * 2 - 1) * maxAngle + Math.PI;
	return new Vec2(Math.cos(th), Math.sin(th));
}

/**
 * 投石ボタン生成。
 *
 * @param scene
 * @param impulse
 * @param swingArrow
 */
function createStrikeButton(
	scene: OhajikiScene,
	impulse: number,
	swingArrow: SwingArrow,
): g.E {
	const button = new g.E({
		scene,
		width: g.game.width,
		height: g.game.height,
		touchable: true,
	});

	// SwingArrow の角度更新と StrikeButton の角度参照のタイミングを
	// ハンドリングするため、次のように実装している。
	//
	// 1. SwingArrowの更新を button に任せ、投石方向取得前に更新する。
	// 2. 投石方向が確定したら swing を止める。

	let pushed = false;
	button.onPointDown.addOnce(() => {
		pushed = true;
	});

	button.onUpdate.add(() => {
		swingArrow.calc();

		let impulseVec: Vector2Like | null = null;

		if (pushed) {
			impulseVec = swingArrow.getDirection().scale(impulse);
		}

		if (impulseVec) {
			scene.send({
				type: "strike",
				impulse: impulseVec,
				autoStrike: false,
			});

			// このハンドラを解除する。
			return true;
		}
	});

	return button;
}

function createFlyingCrystal(
	scene: g.Scene,
	timeline: tl.Timeline,
	crystalImageAsset: g.ImageAsset,
	fromX: number,
	fromY: number,
	toX: number,
	toY: number,
): { flyingCrystal: g.E; tween: tl.Tween } {
	const scale = 0.5;
	const duration = 500;
	const surface = crystalImageAsset.asSurface();

	const flyingCrystal = new g.E({
		scene,
		scaleX: scale,
		scaleY: scale,
		x: fromX,
		y: fromY,
	});

	const spr = new g.Sprite({
		scene,
		src: surface,
	});

	flyingCrystal.append(spr);

	const tween = timeline.create(flyingCrystal);
	tween
		.moveBy(0, -64, 1000, tl.Easing.easeOutCubic)
		.moveTo(toX, toY, duration, tl.Easing.easeOutCubic);

	return {
		flyingCrystal,
		tween,
	};
}

function emitNice(
	scene: g.Scene,
	timeline: tl.Timeline,
	x: number,
	y: number,
): g.E {
	const niceSpr = new g.Sprite({
		scene,
		src: scene.asset.getImage("/assets/gameplay/ui/nice_fukidasi.png"),
		x,
		y,
		opacity: 0,
	});

	const tween = timeline.create(niceSpr);
	tween
		.moveBy(0, -32, 1000, tl.Easing.easeOutCubic)
		.con()
		.fadeIn(1000, tl.Easing.easeOutCubic)
		.moveBy(0, -8, 1000, tl.Easing.linear)
		.con()
		.fadeOut(1000, tl.Easing.easeOutCubic)
		.call(() => niceSpr.destroy());

	return niceSpr;
}

/**
 * TurnState 内部状態。
 *
 * - null: 初期状態。
 * - started: 開始処理が完了した状態。具体的には startTurn() の完了。
 * - striked: プレイヤーがおはじきを弾いた状態。
 * - rest: プレイヤーがおはじきを弾いた後、全てのおはじきが静止した状態。
 * - evaluated: プレイヤーがおはじきを弾いたあと全てのおはじきが静止し、プレイ内容を評価した状態。
 * - skipped: 追放されたプレイヤーの手番を飛ばすよう要求した状態。
 *
 * null -> started -> striked -> rest -> evaluated (-> started) と遷移する。
 * 追放されたプレイヤーの手番では started -> skipped (-> started) と遷移する。
 */
type InternalState =
	| null
	| "started"
	| "striked"
	| "rest"
	| "evaluated"
	| "skipped";

/**
 * TurnState。
 *
 * 投石受付から投石結果評価までを扱うステート。
 */
export class TurnState extends BaseState {
	private nextState: OhajikiState | null;

	private playerOhajiki: OhajikiGameEntity | null;
	private remainNormaAtStart!: number;

	/**
	 * active instance 用内部状態。
	 */
	private activeInstanceInternalState: InternalState;

	private strikeButton: g.E | null;
	private swingArrow: SwingArrow | null;
	private niceButton!: NiceButtonE;
	private kokoButton: g.E | null;
	private burstKokoButton!: g.E;
	private kokoRoot!: g.E;
	private timeline!: tl.Timeline;

	private autoStrikeTimerId: g.TimerIdentifier | null;

	private niceSprites!: g.E[];

	constructor() {
		super();
		this.nextState = null;
		this.playerOhajiki = null;
		this.activeInstanceInternalState = null;
		this.strikeButton = null;
		this.swingArrow = null;
		this.kokoButton = null;
		this.autoStrikeTimerId = null;
	}

	enter(context: System): void {
		const scene = context.scene;

		this.setupNiceButton(context);

		this.kokoRoot = new g.E({
			scene,
		});
		context.origin!.append(this.kokoRoot);
		this.timeline = new tl.Timeline(scene);
		this.nextState = null;
		this.remainNormaAtStart = 0;
		this.activeInstanceInternalState = null;
		this.autoStrikeTimerId = null;
		this.niceSprites = [];

		context.explosion.add(this.onExplosion, this);
		context.spark.add(this.onSpark, this);

		this.startTurn(context, false);
	}

	onExplosion(ev: ExplosionEvent): void {
		this.createExplosion(ev.system, ev.explosionParam);
		this.createComboEffect(ev.system, ev.explosionParam);
	}

	onSpark(ev: SparkEvent): void {
		const context = ev.system;
		const scene = ev.system.scene;

		// 火花が発生するのはおはじき同士の接触。
		// 簡単のため damage source 用の区分を利用する。
		if (ev.bodyA.type === "ohajiki" && ev.bodyB.type === "border") {
			audio.playbackSE("/assets/gameplay/se/stone_vs_wall");
		} else if (ev.bodyA.type === "ohajiki" && ev.bodyB.type === "ohajiki") {
			if (ev.bodyA.invMass !== 0 && ev.bodyB.invMass !== 0) {
				const stoneVsStoneAudioAssetNames = [
					"/assets/gameplay/se/stone_vs_stone_1",
					"/assets/gameplay/se/stone_vs_stone_2",
					"/assets/gameplay/se/stone_vs_stone_3",
				];
				const index = utils.randomInt(
					g.game.random,
					0,
					stoneVsStoneAudioAssetNames.length - 1,
				);
				const stoneVsStoneAssetName =
					stoneVsStoneAudioAssetNames[index];

				audio.playbackSE(stoneVsStoneAssetName);
			} else {
				const stoneVsFixedAudioAssetNames = [
					"/assets/gameplay/se/stone_vs_fixed_1",
					"/assets/gameplay/se/stone_vs_fixed_2",
					"/assets/gameplay/se/stone_vs_fixed_3",
				];
				const index = utils.randomInt(
					g.game.random,
					0,
					stoneVsFixedAudioAssetNames.length - 1,
				);
				const stoneVsFixedAssetName =
					stoneVsFixedAudioAssetNames[index];

				audio.playbackSE(stoneVsFixedAssetName);
			}

			const tween = this.timeline.create({});

			// context.logger.log(`OnSpark: ${JSON.stringify(ev.position)}, ${JSON.stringify(ev.angle)}`);

			const src = scene.asset.getImage(
				"/assets/gameplay/effects/hibana.png",
			);
			const width = src.width / 3;
			const height = src.height / 2;

			const sparkFrameSprite = new g.FrameSprite({
				scene,
				x: ev.position.x - width / 2,
				y: ev.position.y - height / 2,
				// angle: ev.angle / Math.PI * 180, // 角度を合わせる必要のない画像のようなので。
				src,
				width,
				height,
				srcWidth: width,
				srcHeight: height,
				frames: [
					0, 1, 2, 3,
					// 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
					4, 5,
				],
			});

			createFrameSpriteTween(sparkFrameSprite, tween);

			context.effectLayer.append(sparkFrameSprite);
		}
	}

	createExplosion(context: System, param: ExplosionParam): void {
		const scene = context.scene;
		const tween = this.timeline.create({});

		const assetPaths: { [key in Appearance]: string } = {
			normal: "/assets/gameplay/effects/bomb_normal.png",
			big: "/assets/gameplay/effects/bomb_big.png",
			crystal: "/assets/gameplay/effects/bomb_cleanness.png",
		};
		const src = scene.asset.getImage(assetPaths[param.appearance]);

		const width = src.width / 4;
		const height = src.height / 2;
		const explosionFrameSprite = new g.FrameSprite({
			scene,
			src,
			x: param.position.x - width / 2,
			y: param.position.y - height / 2,
			width,
			height,
			srcWidth: width,
			srcHeight: height,
			frames: [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7],
			loop: false,
		});

		createFrameSpriteTween(explosionFrameSprite, tween);

		context.effectLayer.append(explosionFrameSprite);
	}

	createComboEffect(context: System, param: ExplosionParamEx): void {
		const scene = context.scene;
		const e = new g.E({ scene });
		const explosionCount = context.explosionCount;
		const numberImagePaths = [
			"/assets/common/numbers/chainNum_00.png",
			"/assets/common/numbers/chainNum_01.png",
			"/assets/common/numbers/chainNum_02.png",
			"/assets/common/numbers/chainNum_03.png",
			"/assets/common/numbers/chainNum_04.png",
			"/assets/common/numbers/chainNum_05.png",
			"/assets/common/numbers/chainNum_06.png",
			"/assets/common/numbers/chainNum_07.png",
			"/assets/common/numbers/chainNum_08.png",
			"/assets/common/numbers/chainNum_09.png",
		];
		const explosionCountChars = (explosionCount + "").split("");

		let x = 0;
		for (let i = 0; i < explosionCountChars.length; i++) {
			const ch = explosionCountChars[i];
			const n = parseInt(ch, 10);
			const imageAsset = scene.asset.getImage(numberImagePaths[n]);
			const spr = new g.Sprite({
				scene,
				x,
				src: imageAsset,
			});
			e.append(spr);
			x += imageAsset.width;
		}
		const chainTextAsset = scene.asset.getImage(
			"/assets/gameplay/effects/chainText.png",
		);
		e.append(
			new g.Sprite({
				scene,
				x,
				src: chainTextAsset,
			}),
		);
		x += chainTextAsset.width;

		e.x = param.position.x - x / 2;
		e.y = param.position.y;
		e.modified();

		context.effectLayer.append(e);

		const textTween = this.timeline.create(e);

		textTween
			.moveBy(0, -64, 1000, tl.Easing.easeOutCubic)
			.call(() => e.destroy());

		if (!param.spawnCrystal) {
			return;
		}

		audio.playbackSE("/assets/gameplay/se/cheers");

		const comboBonusIndicator = context.comboBonusIndicator;

		comboBonusIndicator.show();

		const to = comboBonusIndicator.ohajikiRelativePosition();
		to.x += comboBonusIndicator.x;
		to.y += comboBonusIndicator.y;

		const { flyingCrystal, tween } = createFlyingCrystal(
			scene,
			this.timeline,
			scene.asset.getImage("/assets/common/ohajiki/ball_cleanness.png"),
			param.position.x + x / 2,
			param.position.y,
			to.x,
			to.y,
		);

		tween.call(() => {
			comboBonusIndicator.count++;
			flyingCrystal.destroy();
		});

		context.effectLayer.append(flyingCrystal);
	}

	update(context: System): OhajikiState | null {
		// Active Instance がゲームの進行と結果の責任を持つ。
		if (g.game.isActiveInstance()) {
			// 追放されたプレイヤーの投石は待たず、投数を使わずに手番を飛ばす。
			// 制限時間まで待つと、追放したのに毎ターン待たされることになる。
			// 自動投石で済ませると、追放しただけで投数が減ってしまう。
			if (
				this.activeInstanceInternalState === "started" &&
				context.playerManager.queue.length > 0 &&
				isBanned(context.playerManager.getCurrentPlayer().id)
			) {
				context.logger.info(
					"Skip the turn because the current player is banned.",
				);
				context.scene.send({ type: "skip-turn" });
				this.activeInstanceInternalState = "skipped";
			}

			if (this.activeInstanceInternalState === "striked") {
				if (
					context.isTurnCompleted() &&
					utils.isTimelineFinished(this.timeline)
				) {
					this.activeInstanceInternalState = "rest";
				}
			}

			if (this.activeInstanceInternalState === "rest") {
				this.recordPlay(context);

				// 強制的にゲームクリアーへ。
				// if (true) {
				// 	context.scene.send({
				// 		type: "game-clear",
				// 		serialized: context.save()
				// 	});
				// } else

				// 強制的にゲームオーバーへ遷移。
				// if (true) {
				// 	context.scene.send({
				// 		type: "game-over",
				// 		serialized: context.save()
				// 	});
				// } else

				if (context.isGameClear()) {
					context.scene.send({
						type: "game-clear",
						serialized: context.save(),
					});
				} else if (context.isGameOver()) {
					context.scene.send({
						type: "game-over",
						serialized: context.save(),
					});
				} else if (context.isLevelClear()) {
					context.scene.send({
						type: "level-clear",
						serialized: context.save(),
					});
				} else {
					context.scene.send({
						type: "go-next-turn",
						serialized: context.save(),
					});
				}

				this.activeInstanceInternalState = "evaluated";
			}
		}

		return this.nextState;
	}

	leave(context: System): void {
		this.kokoRoot.destroy();
		this.niceButton.destroy();
		this.destroySwingArrowUI();
		this.destroyNiceSprites();
		if (this.kokoButton && !this.kokoButton.destroyed()) {
			this.kokoButton.destroy();
		}
		if (this.burstKokoButton && !this.burstKokoButton.destroyed()) {
			this.burstKokoButton.destroy();
		}
		this.timeline.destroy();
		context.explosion.remove(this.onExplosion, this);
		context.spark.remove(this.onSpark, this);
	}

	command(context: System, command: OhajikiCommand): OhajikiState | null {
		//
		// wind(akashic-timelineの完了) する必要のない(してはいけない)コマンドは早期リターンすること。
		//
		if (command.type === "add-player") {
			common.handleAddPlayerCommand(context, command);
			this.resumeIfQueueEmpty(context);
			return null;
		} else if (command.type === "koko") {
			// 自分のKOKOはローカルでエミットしているのでここでは無視する。
			if (command.userId !== g.game.selfId) {
				this.emitKoko(context, command.x, command.y);
			}
			return null;
		} else if (command.type === "nice") {
			const niceSpr = emitNice(
				context.scene,
				this.timeline,
				command.x,
				command.y,
			);

			context.effectLayer.append(niceSpr);
			this.niceSprites.push(niceSpr);

			// ナイス加算。
			// 手番が進んで待機列が空になった後に届くことがある。
			if (context.playerManager.queue.length > 0) {
				const player = context.playerManager.getCurrentPlayer();
				player.playRecord.nice++;
			}

			audio.playbackSE("/assets/gameplay/se/se_nice");

			return null;
		}
		//
		// ここまで wind させないように早期リターン。
		//

		this.timeline.completeAll();

		if (command.type === "skip-turn") {
			this.skipTurn(context);
		} else if (command.type === "strike") {
			this.activeInstanceInternalState = "striked";

			if (this.autoStrikeTimerId) {
				if (this.autoStrikeTimerId.destroyed()) {
					context.logger.info("AutoStrikeTimer is destroyed.");
				} else {
					context.scene.clearTimeout(this.autoStrikeTimerId);
				}
				this.autoStrikeTimerId = null;
			}

			if (!this.playerOhajiki) {
				// タイミングによっては自動投石と通常の投石の両方が起こり得る("strike" が二度発せられる)。
				context.logger.warn("No player ohajiki to be striked");
			} else if (this.playerOhajiki.destroyed()) {
				context.logger.warn("Destroyed player ohajiki is striked");
			} else {
				context.logger.info(
					`Strike ohajiki. autoStrike = ${command.autoStrike}`,
				);

				const impulse = new Vec2(command.impulse);
				this.playerOhajiki.ohajiki.velocity.add(
					impulse.scale(this.playerOhajiki.ohajiki.invMass),
				);
				this.playerOhajiki.striked = true;
				this.playerOhajiki = null;

				audio.playbackSE("/assets/gameplay/se/strike_stone");

				if (command.autoStrike) {
					const player = context.playerManager.getCurrentPlayer();
					player.autoStrikeCount++;
					context.logger.info(
						`Player ${player.id} autoStrikeCount = ${player.autoStrikeCount}`,
					);
					if (player.autoStrikeCount >= 2 && !player.isHost) {
						context.playerManager.ban(player);
					}
				}
			}
			this.destroySwingArrowUI();

			if (
				context.playerManager.queue.length > 0 &&
				context.playerManager.getCurrentPlayer().id !== g.game.selfId
			) {
				this.niceButton.disabled = false;
				this.niceButton.show();
				this.niceButton.opacity = 0;
				this.timeline.create(this.niceButton).fadeIn(100);
			}
		} else if (command.type === "game-clear") {
			context.restore(command.serialized);
			this.nextState = new GameClearState();
		} else if (command.type === "game-over") {
			context.restore(command.serialized);
			this.nextState = new GameOverState();
		} else if (command.type === "level-clear") {
			context.restore(command.serialized);
			this.startDeployingCrystalOhajiki(context);
		} else if (command.type === "go-next-level") {
			context.restore(command.serialized);
			this.nextState = new LevelClearState(false);
		} else if (command.type === "go-next-turn") {
			context.restore(command.serialized);
			this.startTurn(context, true);
		}

		return null;
	}

	private createKokoButton(context: System): g.E {
		let coolTime = 0;

		const kokoButton = new g.E({
			scene: context.scene,
			x: 8,
			y: 86,
			width: 936,
			height: 628,
			touchable: true,
		});

		kokoButton.onUpdate.add(() => {
			coolTime = Math.max(0, coolTime - 1);
		});

		kokoButton.onPointDown.add((ev) => {
			if (coolTime > 0) {
				return;
			}

			// 荒らし対策:
			// "ココ"できるのは参加プレイヤーのみとする。
			// - 非参加プレイヤーによる荒らし対策。
			// - 「ココ」機能利用者特定のためのログ出力。
			//
			// 参加ボタンを押してすぐに"ココ"できるよう、
			// ボタンは常に生成し、参加状態を常に確認するようにする。
			if (!context.playerManager.findPlayer(g.game.selfId)) {
				return;
			}

			const x = ev.point.x + kokoButton.x;
			const y = ev.point.y + kokoButton.y;

			context.scene.send({ type: "koko", x, y });

			// ローカルでエミットする。コマンド受信側では自身以外のKOKOのみエミットする。
			this.emitKoko(context, x, y);

			coolTime = g.game.fps * 3;
		});

		return kokoButton;
	}

	/**
	 * ココ流量制限テスト用ココバーストボタンを生成する。
	 *
	 * @param context
	 * @param numKoko 一度に送信するコココマンドの数。
	 */
	private createBurstKokoButton(context: System, numKoko: number): g.E {
		const kokoButton = new g.FilledRect({
			scene: context.scene,
			x: 8,
			y: 8,
			width: 64,
			height: 64,
			cssColor: "purple",
			touchable: true,
		});

		kokoButton.onPointDown.add((_ev) => {
			for (let i = 0; i < numKoko; i++) {
				const x = 8 + 936 * g.game.random.generate();
				const y = 86 + 628 * g.game.random.generate();
				context.scene.send({ type: "koko", x, y });
			}
		});

		return kokoButton;
	}

	private emitKoko(context: System, x: number, y: number): void {
		const koko = new KoKoE({
			scene: context.scene,
			x,
			y,
			src: context.scene.asset.getImage(
				"/assets/gameplay/ui/koko_anime.png",
			),
			width: 536 / 4,
			height: 900 / 6,
			srcWidth: 536 / 4,
			srcHeight: 900 / 6,
			frames: [
				0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
				18, 19, 20, 21, 22, 23,
			],
			centerX: 72,
			centerY: 90,
		});

		this.kokoRoot.append(koko);

		koko.start();

		audio.playbackSE("/assets/gameplay/se/koko");
	}

	/**
	 * System#explosionCount 基づいて透明石を配置する。
	 *
	 * 配置が完了すると System#explosionCount はクリアされる。
	 */
	private deployCrystalOhajiki(context: System, tween: tl.Tween): void {
		const numCrystalOhajiki = context.crystalOhajikiCount();

		if (numCrystalOhajiki > 0) {
			const crystalOhajikis =
				context.deployCrystalOhajiki(numCrystalOhajiki);

			crystalOhajikis.forEach((ohajiki) => {
				tween.wait(250).call(() => {
					ohajiki.ohajikiE.show();
					context.comboBonusIndicator.count--;
					audio.playbackSE("/assets/common/se/spawn");
				});
			});

			tween.wait(1000).call(() => {
				context.explosionCount = 0;
				context.comboBonusIndicator.hide();
			});
		} else {
			context.explosionCount = 0;
		}
	}

	private startDeployingCrystalOhajiki(context: System): void {
		const tween = this.timeline.create({});

		this.deployCrystalOhajiki(context, tween);

		if (g.game.isActiveInstance()) {
			tween.wait(1000).call(() =>
				context.scene.send({
					type: "go-next-level",
					serialized: context.save(),
				}),
			);
		}
	}

	/**
	 * timelineを用いて様々なタイミングでいろいろ初期化する。
	 *
	 * @param context コンテキスト。
	 */
	private startTurn(context: System, upadtePlayerPanel: boolean): void {
		this.niceButton.hide();

		this.destroySwingArrowUI();

		if (this.kokoButton && !this.kokoButton.destroyed()) {
			this.kokoButton.destroy();
			this.kokoButton = null;
		}

		const tween = this.timeline.create({});

		// 透明おはじきの配置。
		this.deployCrystalOhajiki(context, tween);

		const playerManager = context.playerManager;

		// 待機列(queue)の進行。
		if (upadtePlayerPanel) {
			playerManager.changePlayer();
		} else {
			// 全員が追放されて空になった待機列を、その後の参加者で埋め直す。
			// 待機列が埋まっていれば何もしない。
			playerManager.fillQueue();
		}

		// パネルの更新。
		// 待機列が埋まらなかった分はパネルを足さないので、空になった待機列の
		// パネルも残らない。
		const addedPanels = context.syncPlayerPanels(upadtePlayerPanel, tween);

		// 全員が追放されると待機列が空になる。進行できないのでこの手番は
		// 始めない。途中参加があれば resumeIfQueueEmpty() が再開する。
		if (playerManager.queue.length === 0) {
			context.logger.warn(
				"No player remains in the queue. The turn is not started.",
			);
			return;
		}

		// ターン開始時にインクリメントするため、１始まりとなる。
		context.turnNo++;

		// プレイヤー情報の取得。
		const currentPlayer = playerManager.getCurrentPlayer();
		const currentPlayerData = playerManager.getCurrentPlayerData();
		const currentPlayerPanel = context.getPlayerPanel(0);

		// もし自分が待機列に現れた＝当選したなら、当選通知。
		const myAddedPanel = addedPanels.filter(
			(added) => added.playerData.player.id === g.game.selfId,
		)[0];
		if (myAddedPanel) {
			tween.call(() =>
				context.notifyWinningByLottery(
					this.timeline.create({}),
					myAddedPanel.panel,
				),
			);
		}

		// プレイヤーおはじきの配置と自分のターンなら投石UIの設置。
		tween.call(() => {
			const ohajikiE = currentPlayerPanel.ohajikiE;
			if (!ohajikiE) {
				context.logger.error("No ohajikiE in current player panel.");
				return;
			}
			currentPlayerPanel.ohajikiE = null;
			if (ohajikiE.parent) {
				ohajikiE.remove();
			}
			const pos1 = context.getPlayerPanelTrayPosition();
			const pos2 = currentPlayerPanel.getOhajikiPosition();
			ohajikiE.x = currentPlayerPanel.x + pos1.x + pos2.x;
			ohajikiE.y = currentPlayerPanel.y + pos1.y + pos2.y;
			context.origin!.append(ohajikiE);

			const ohajikiTween = this.timeline.create(ohajikiE);

			const to = context.getStrikePosition();

			ohajikiTween
				.call(() => context.numStrikesRemaining--)
				.moveTo(to.x, to.y, 1000, tl.Easing.easeOutCubic)
				.wait(1000)
				.call(() => {
					// この上で `numStrikesRemaining` を減じていて、それに基づいて求めている。
					const life = context.tweakLifeIfInaPinch(
						currentPlayerData.ohajikiLife,
					);

					this.playerOhajiki = context.putPlayerOhajiki({ life });

					const timeLimitInMilliSec =
						context.config.general.strikeTimeLimitInMilliSec;
					const autoStrikeDelay = 1 * 1000;
					const maxAngle =
						(context.config.swingArrow.maxAngle / 180) * Math.PI;

					if (currentPlayer.id === g.game.selfId) {
						const ohajiki = this.playerOhajiki?.ohajiki;
						if (!ohajiki) {
							context.logger.error(
								"No ohajiki in playerOhajiki.",
							);
							return;
						}
						this.swingArrow = new SwingArrow({
							scene: context.scene,
							x: ohajiki.position.x,
							y: ohajiki.position.y,
							arrowImageAsset: context.scene.asset.getImage(
								"/assets/gameplay/ui/daiza_arrow.png",
							),
							baseImageAsset: context.scene.asset.getImage(
								"/assets/gameplay/ui/daiza.png",
							),
							abusoluteAngularVecolity:
								(context.config.swingArrow.angularVelocity /
									180) *
								Math.PI,
							maxAngle,
							timeLimitInMilliSec,
						});
						context.origin!.append(this.swingArrow);
						this.strikeButton = createStrikeButton(
							context.scene,
							context.config.strike.impulseMax,
							this.swingArrow,
						);
						// 全画面の投石ボタンなので、origin 直下に置くと
						// プレイヤーパネル(と放送者向けの BAN メニュー)を
						// 覆ってタップを奪ってしまう。パネルより下にある
						// 専用レイヤへ置く。
						context.strikeButtonLayer.append(this.strikeButton);
					} else {
						this.kokoButton = this.createKokoButton(context);
						context.origin!.append(this.kokoButton);
					}

					// DEBUG: ココバーストボタン。
					// コントローラによる流量制限で1秒あたり最大 general.maxKokoPerSec の
					// コココマンドだけがブロードキャストされる。このボタンでその制限を確認する。
					//
					// this.burstKokoButton = this.createBurstKokoButton(context, 20);
					// context.origin.append(this.burstKokoButton);

					// active instance は自動投石を行う。
					if (g.game.isActiveInstance()) {
						this.autoStrikeTimerId = context.scene.setTimeout(
							() => this.sendAutoStrike(context),
							// 動作の遅れたインスタンスに対するケアとして、このようにしてみる。
							// 多分こうしないと、時間ギリギリで投石したとき、わずかに自動投石が
							// が先行してデタラメな方向に投石してしまいバグのように見えることが
							// 考えられるため。
							timeLimitInMilliSec + autoStrikeDelay,
						);
					}

					this.remainNormaAtStart = context.remainNorma;

					ohajikiE.destroy();

					this.activeInstanceInternalState = "started";
				});
		});
	}

	/**
	 * 自動投石する。
	 */
	private sendAutoStrike(context: System): void {
		const maxAngle = (context.config.swingArrow.maxAngle / 180) * Math.PI;
		const impulseVec = getRandomDirection(maxAngle).scale(
			context.config.strike.impulseMax,
		);
		context.scene.send({
			type: "strike",
			impulse: impulseVec,
			autoStrike: true,
		});
	}

	/**
	 * 追放されたプレイヤーの手番を、投数を使わずに飛ばす。
	 *
	 * skip-turn コマンドの中で呼ぶので、全インスタンスが同じ tick に行う。
	 */
	private skipTurn(context: System): void {
		// 要求が届く前に投石が届いていたら、その投石で手番を進める。
		if (!this.playerOhajiki || this.playerOhajiki.destroyed()) {
			context.logger.info("The turn to be skipped is already striked.");
			return;
		}

		if (this.autoStrikeTimerId) {
			if (!this.autoStrikeTimerId.destroyed()) {
				context.scene.clearTimeout(this.autoStrikeTimerId);
			}
			this.autoStrikeTimerId = null;
		}

		// 投げられなかったおはじきを片付け、手番の開始時に減らした投数を戻す。
		this.playerOhajiki.destroy();
		this.playerOhajiki = null;
		context.numStrikesRemaining++;

		this.startTurn(context, true);
	}

	/**
	 * 空になった待機列が途中参加で埋まるなら、止まっていた手番を始める。
	 *
	 * add-player コマンドの中で呼ぶので、全インスタンスで同じ判断になる。
	 */
	private resumeIfQueueEmpty(context: System): void {
		// 待機列が空になるのは startTurn() が手番を始められなかった時だけである。
		if (this.nextState || context.playerManager.queue.length > 0) {
			return;
		}

		context.playerManager.fillQueue();

		if (context.playerManager.queue.length === 0) {
			return;
		}

		context.logger.info("Resume the turn with players joined midway.");

		this.startTurn(context, false);
	}

	private destroySwingArrowUI(): void {
		if (this.swingArrow && !this.swingArrow.destroyed()) {
			this.swingArrow.destroy();
			this.swingArrow = null;
		}
		if (this.strikeButton && !this.strikeButton.destroyed()) {
			this.strikeButton.destroy();
			this.strikeButton = null;
		}
	}

	/**
	 * nice スプライトを破棄する。
	 *
	 * 「ナイス」が画面に残り続けることがあるため、その対策。
	 */
	private destroyNiceSprites(): void {
		this.niceSprites.forEach((spr) => {
			if (!spr.destroyed()) {
				spr.destroy();
			}
		});
		this.niceSprites = [];
	}

	private recordPlay(context: System): void {
		const player = context.playerManager.getCurrentPlayer();

		player.playRecord.combo = Math.max(
			player.playRecord.combo,
			context.explosionCount,
		);

		// MVPになるのは残りノルマ４以上かつ最後の一投でレベルクリア。
		if (context.isLevelClear() || context.isGameClear()) {
			if (
				context.numStrikesRemaining === 0 &&
				this.remainNormaAtStart >= 4 &&
				(!player.playRecord.narrowEscape ||
					player.playRecord.narrowEscape.norma <
						this.remainNormaAtStart)
			) {
				player.playRecord.narrowEscape = {
					areaId: context.areaId,
					worldId: context.worldId,
					norma: this.remainNormaAtStart,
				};
			}
		}

		context.logger.log(
			`numStrikesRemaining ${context.numStrikesRemaining}`,
		);
		context.logger.log(
			`player ${player.id}'s best combo = ${player.playRecord.combo}`,
		);
		context.logger.log(
			`player narrowEscape ${JSON.stringify(player.playRecord.narrowEscape)}`,
		);
	}

	private setupNiceButton(context: System): void {
		const scene = context.scene;

		this.niceButton = new NiceButtonE({
			scene,
			x: 968 - 16,
			y: 92 + 58,
			normalImageAsset: scene.asset.getImage(
				"/assets/gameplay/ui/icon_nice.png",
			),
			highlightedImageAsset: scene.asset.getImage(
				"/assets/gameplay/ui/icon_nice_active.png",
			),
			disabledImageAsset: scene.asset.getImage(
				"/assets/gameplay/ui/icon_nice_done.png",
			),
			touchable: true,
			hidden: true,
		});

		this.niceButton.clicked.add(() => {
			this.niceButton.disabled = true;

			// 出現場所はフィールド内らしいが、座標を真面目に求める手間を省く。
			// 本当なら config のフィールド情報を用いるか、いいね出現領域を
			// config に持つのが良い。
			context.scene.send({
				type: "nice",
				x: utils.randomInt(g.game.random, 60, 720),
				y: utils.randomInt(g.game.random, 160, 620),
			});
		});

		context.origin!.append(this.niceButton);
	}
}
