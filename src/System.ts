import * as audio from "./audio";
import * as utils from "./utils";
import * as coe from "@akashic-extension/coe";
import type * as tl from "@akashic-extension/akashic-timeline";
import { resolvePlayerInfo } from "@akashic-extension/resolve-player-info";
import {
	banPlayer,
	BanTarget,
	isSupported,
	onPlayerBanned,
	onPlayerUnbanned,
} from "@multi-indiegame/akashic-player-ban";
import type * as types from "./types";
import { Vec2 } from "./math";
import type { Vector2Like } from "./math";
import { EntityManager } from "./entity-system-2";
import { Border, World } from "./ohajiki";
import type { Arbiter, Ohajiki } from "./ohajiki";
import type { Logger } from "./Logger";
import { Player } from "./Player";
import { PlayerManager } from "./PlayerManager";
import type { PlayerData } from "./PlayerManager";
import {
	applyBlast,
	createBorders,
	createCorners,
	createOhajikiE,
} from "./game-common";
import type { OhajikiActionData, OhajikiCommand } from "./coeMessages";
import { TimeManager } from "./TimeManager";
import type { Level } from "./Level";
import {
	deployOhajikiForLevel,
	deployOhajiki,
	isVacantPosition,
} from "./game-common";
import type {
	Configuration,
	OhajikiParameter,
	FieldParameter,
	CrystalOhajikiParameter,
	DeployArea,
} from "./Configuration";
import type {
	BaseGameEntity,
	ExplosionParam,
	SerializedOhajikiGameEntity,
} from "./entity";
import { OhajikiGameEntity, BorderGameEntity } from "./entity";
import {
	TrailRenderer,
	LevelE,
	NumberIndicatorE,
	PlayerPanelE,
	PlayerPanelTrayE,
	ComboBonusIndicatorE,
	InPlayApplyButton,
	WinningRateE,
	BanMenuE,
	BanModeE,
	banMessageIds,
} from "./E";
import type { BanMessageId } from "./E";

/**
 * System#syncPlayerPanels() で追加したパネル。
 */
export interface AddedPlayerPanel {
	playerData: PlayerData;
	panel: PlayerPanelE;
}

export class OhajikiScene extends coe.Scene<
	OhajikiCommand,
	OhajikiActionData
> {}

interface PlayerOhajikiGameEntityParam {
	position?: Vector2Like;
	allowDeployOhajikiOutside?: boolean;
	ohajikiParam?: OhajikiParameter;
	life?: number;
}

interface BaseLevelParam {
	cont: boolean;
	hidden: boolean;
}

interface GoNextLevelParam extends BaseLevelParam {
	type: "go-next";
}

interface GoToLevelparam extends BaseLevelParam {
	type: "go-to";
	worldId: number;
	areaId: number;
}

type LevelParam = GoNextLevelParam | GoToLevelparam;

export interface ExplosionEvent {
	explosionParam: ExplosionParamEx;
	system: System;
}

export interface SparkEvent {
	position: Vector2Like;
	bodyA: Ohajiki;
	bodyB: Ohajiki | Border;
	system: System;
}

export interface SerializedSystem {
	numStrikesRemaining: number;
	remainNorma: number;
	explosionCount: number;
	worldId: number;
	areaId: number;
	fieldIndex: number;
	ohajikiSers: SerializedOhajikiGameEntity[];
}

/**
 * コンボ（連鎖）ボーナスか否かの判定。
 *
 * @param comboCount 爆発回数。
 * @param config ボーナスとして与えられる透明石に関する設定。
 */
function isComboBonus(
	comboCount: number,
	config: CrystalOhajikiParameter,
): boolean {
	const comboBonuses = config.comboBonuses;

	for (let i = 0; i < comboBonuses.length; i++) {
		const bonus = comboBonuses[i];
		if (comboCount < bonus.combo) {
			// コンボ数順で ComboBonus が並んでいる、としている。
			break;
		} else if (comboCount === bonus.combo) {
			return true;
		}
	}

	return false;
}

/**
 * 爆発SEのアセット名取得。
 *
 * 爆発回数によってアセット名が決まる。
 *
 * @param explosionCount 爆発回数。1 以上の整数。
 */
function getExplosionSeAssetName(explosionCount: number): string {
	const explosionAudioAssetNames = [
		"/assets/gameplay/se/explosion_1",
		"/assets/gameplay/se/explosion_2",
		"/assets/gameplay/se/explosion_3",
		"/assets/gameplay/se/explosion_4",
		"/assets/gameplay/se/explosion_5",
		"/assets/gameplay/se/explosion_6",
		"/assets/gameplay/se/explosion_7",
	];

	const audioAssetIdx = Math.max(
		0,
		Math.min(explosionAudioAssetNames.length - 1, explosionCount - 1),
	);

	return explosionAudioAssetNames[audioAssetIdx];
}

/**
 * 拡張爆発パラメータ。
 */
export interface ExplosionParamEx extends ExplosionParam {
	spawnCrystal: boolean;
	seAssetName: string;
}

/**
 * 拡張爆発パラメータの生成。
 *
 * 爆発パラメータを作れない entity の時 null 。
 *
 * @param entity 爆発する entity 。
 * @param explosionCount 連鎖回数。１以上の整数。
 * @param config クリスタル発生に関する設定。
 */
function createExplosionParamEx(
	entity: BaseGameEntity,
	explosionCount: number,
	config: CrystalOhajikiParameter,
): ExplosionParamEx | null {
	// 基本爆発パラメータ。
	const param = entity.createExplosionParam();

	if (!param) {
		return null;
	}

	// クリスタル発生の有無。
	const spawnCrystal = isComboBonus(explosionCount, config);

	// 爆発音の選択。
	const seAssetName = getExplosionSeAssetName(explosionCount);

	return {
		position: param.position,
		radius: param.radius,
		impulse: param.impulse,
		blastDamage: param.blastDamage,
		sources: param.sources,
		appearance: param.appearance,
		spawnCrystal,
		seAssetName,
	};
}

class EStack {
	private parent: g.E | g.Scene;
	private stack: g.E[];

	constructor(parent: g.E | g.Scene) {
		this.parent = parent;
		this.stack = [];
	}

	getTop(): g.E | null {
		return this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;
	}

	push(e: g.E): void {
		if (this.stack.length > 0) {
			this.stack[this.stack.length - 1].remove();
		}
		this.parent.append(e);
		this.stack.push(e);
	}

	pop(): g.E | null {
		let e: g.E | null = null;

		if (this.stack.length > 0) {
			const popped = this.stack.pop();
			if (popped) {
				e = popped;
				e.remove();
			}
		}

		if (this.stack.length > 0) {
			this.parent.append(this.stack[this.stack.length - 1]);
		}

		return e;
	}
}

/**
 * 一方通行の壁のスロープ。
 *
 * スロープはおはじきが一方通行の壁を乗り越えていないまま静止した時稼働し、
 * フィールドへ掃き出す。
 *
 * 掃き出しがタイムアウトした（制限時間内に掃き出しきれなかった）時、
 * 強制的にフィールド内の空いている場所に移動させる。
 *
 * この強制移動処理は空き地を見つけられない時失敗する (giveup===true) 。
 */
class OneWayBorderSlope {
	/**
	 * 強制掃き出しを実行しそれに失敗した時、真。
	 *
	 * update() 呼び出しごとに更新される。
	 */
	giveup: boolean = false;

	/** おはじきワールド。 */
	private world: World;

	/** 一方通行の壁。 */
	private oneWayBorder: Border;

	/** おはじきの再配置エリア。 */
	private tossArea: DeployArea;

	/** スロープの状態。真の時、スロープが稼働している。 */
	private active: boolean = false;

	/** スロープの連続稼働時間。 */
	private timer: number = 0;

	/** スロープ稼働の制限時間。 */
	private timeLimit: number;

	/** ロガー。 */
	private logger: Logger;

	constructor(
		world: World,
		oneWayBorder: Border,
		timeLimit: number,
		tossArea: DeployArea,
		logger: Logger,
	) {
		this.world = world;
		this.oneWayBorder = oneWayBorder;
		this.tossArea = tossArea;
		this.timeLimit = timeLimit;
		this.logger = logger;
		this.reset();
	}

	/** 初期化する。 */
	reset(): void {
		this.giveup = false;
		this.active = false;
		this.timer = 0;
	}

	/**
	 * スロープの更新。
	 *
	 * @param dt 経過時間。
	 */
	update(dt: number): void {
		this.giveup = false;

		// スロープの切り替え。
		if (!this.active) {
			if (this.strikedStationaryOhajikiBehindTheOneWayBorderExists()) {
				this.active = true;
				this.timer = 0;
			}
		} else {
			if (this.checkIfOhajikisInFrontOfTheOneWayBorder()) {
				this.active = false;
			}
		}

		if (!this.active) {
			return;
		}

		// スロープ稼働時間更新。
		this.timer += dt;

		// 時間をかけてもスロープでおはじきを押し出しきれない時、タイムアウト。
		if (this.timer >= this.timeLimit) {
			this.forceSweep();
			return;
		}

		// スロープの力をおはじきに加える。
		this.world.ohajikis.forEach((ohajiki) => {
			if (!ohajiki || ohajiki.invMass === 0) {
				return;
			}
			const separation =
				this.oneWayBorder.normal.dot(ohajiki.position) +
				this.oneWayBorder.d -
				ohajiki.radius;
			if (separation < 0) {
				const speed = ohajiki.velocity.length();
				if (speed < this.world.restTolerance) {
					const v = this.oneWayBorder.normal
						.clone()
						.scale(this.world.restTolerance);
					ohajiki.velocity.x = v.x;
					ohajiki.velocity.y = v.y;
				}
				const acc = this.oneWayBorder.normal.clone().scale(300);
				ohajiki.velocity.add(acc.scale(dt));
			}
		});
	}

	/**
	 * おはじきを toss area の空いている場所に放り込む。
	 *
	 * 100回試行して空き地が見つからない時、失敗。
	 *
	 * @param ohajiki
	 * @param gen
	 */
	private toss(ohajiki: Ohajiki, gen: g.RandomGenerator): boolean {
		const left = this.tossArea.left + ohajiki.radius;
		const top = this.tossArea.top + ohajiki.radius;
		const right = this.tossArea.right - ohajiki.radius;
		const bottom = this.tossArea.bottom - ohajiki.radius;

		for (let i = 0; i < 100; i++) {
			const x = gen.generate() * (right - left) + left;
			const y = gen.generate() * (bottom - top) + top;
			if (isVacantPosition(this.world, x, y, ohajiki.radius)) {
				ohajiki.velocity.x = 0;
				ohajiki.velocity.y = 0;
				ohajiki.position.x = x;
				ohajiki.position.y = y;
				return true;
			}
		}

		return false;
	}

	/**
	 * 一方通行の壁を乗り越えられていなおはじきを強制的にフィールドに掃き出す。
	 */
	private forceSweep(): void {
		this.logger.info("Force sweep");

		// config.json で全てのフィールドに tossArea を設定していない。
		// 簡単でないため。実際にゲームで使用されているフィールドのみ設定した。
		// そのため、ここで存在を確認している。
		if (!this.tossArea) {
			this.giveup = true;
			this.logger.warn("Give up force sweep because of no toss area");
			return;
		}

		// command を受信してゲームが進行した結果、インスタンスごとに forceSweep を
		// 実行したりしなかったりする、ということがあるかもしれない。
		// それによって乱数がずれることを避けるため、ここで新しい乱数生成器を
		// を用意する。シードは固定で問題ない。
		const gen = new g.XorshiftRandomGenerator(0);

		for (let i = 0; i < this.world.ohajikis.length; i++) {
			const ohajiki = this.world.ohajikis[i];
			if (
				ohajiki &&
				this.isStrikedStationaryOhajikiBehindTheOneWayBorder(ohajiki)
			) {
				const result = this.toss(ohajiki, gen);
				if (!result) {
					// 諦めて中断。
					this.giveup = true;
					this.logger.warn("Give up force sweep because of no room");
					return;
				}
			}
		}
	}

	/**
	 * おはじきがプレイヤーの弾いたもので静止状態でありさらに一方通行の壁を乗り越えていない時、真。
	 *
	 * @param ohajiki おはじき。
	 */
	private isStrikedStationaryOhajikiBehindTheOneWayBorder(
		ohajiki: Ohajiki,
	): boolean {
		const entity = ohajiki.userData as OhajikiGameEntity;
		if (entity.destroyed()) return false;
		if (!entity.striked) return false;
		if (!ohajiki.velocity.equal(Vec2.zero)) return false;
		const separation =
			this.oneWayBorder.normal.dot(ohajiki.position) +
			this.oneWayBorder.d -
			ohajiki.radius;
		return separation < 0;
	}

	/**
	 * 一方通行の背後にあって静止している、ユーザの弾いたおはじきが存在する時、真。
	 */
	private strikedStationaryOhajikiBehindTheOneWayBorderExists(): boolean {
		for (let i = 0; i < this.world.ohajikis.length; i++) {
			const ohajiki = this.world.ohajikis[i];
			if (
				ohajiki &&
				this.isStrikedStationaryOhajikiBehindTheOneWayBorder(ohajiki)
			) {
				return true;
			}
		}

		return false;
	}

	/**
	 * 全てのおはじきが一方通行の壁の向こうにあるか調べる。
	 */
	private checkIfOhajikisInFrontOfTheOneWayBorder(): boolean {
		for (let i = 0; i < this.world.ohajikis.length; i++) {
			const ohajiki = this.world.ohajikis[i];
			if (!ohajiki) continue;
			const entity = ohajiki.userData as OhajikiGameEntity;
			if (entity.destroyed()) continue;
			const separation =
				this.oneWayBorder.normal.dot(ohajiki.position) +
				this.oneWayBorder.d -
				ohajiki.radius;
			if (separation < 0) {
				return false;
			}
		}

		return true;
	}
}

export class System {
	scene: OhajikiScene;

	/// start()が実行済みか。
	started: boolean = false;

	// 画面に表示される名前
	displayName: string = "ゲスト";

	/// このインスタンスがホスト役か。
	isHost: boolean;

	/// 乱数生成器。ゲームの進行に影響する乱数の生成に用いる。
	rand: g.RandomGenerator;

	/// コンフィグ。
	config: Configuration;

	/// ロガー。
	logger: Logger;

	/// AI実行役であるか。
	// get isAiRunner(): boolean {
	// 	return g.game.isActiveInstance();
	// }

	world!: World;
	entityManager!: EntityManager<BaseGameEntity>;

	playerManager!: PlayerManager;

	timeManager!: TimeManager;

	/** 手持ちの投石用おはじきの数。 */
	get numStrikesRemaining() {
		return this._numStrikesRemaining;
	}
	set numStrikesRemaining(v: number) {
		this._numStrikesRemaining = v;
		if (this.numStrikesIndicatorE) {
			this.numStrikesIndicatorE.num = v;
			this.numStrikesIndicatorE.inDanger = v <= 3;
			this.numStrikesIndicatorE.modified();
		}
	}

	/** あるレベルで破壊しなければならないおはじきの数。 */
	get remainNorma() {
		return this._remainNorma;
	}
	set remainNorma(v: number) {
		this._remainNorma = v;
		if (this.normaIndicatorE) {
			this.normaIndicatorE.num = v;
			this.normaIndicatorE.modified();
		}
	}

	get explosionCount() {
		return this._explosionCount;
	}
	set explosionCount(v: number) {
		this._explosionCount = v;
	}

	/** 爆発トリガー。 */
	explosion: g.Trigger<ExplosionEvent>;

	/** 火花トリガー。 */
	spark: g.Trigger<SparkEvent>;

	/** 難易度。 */
	get difficulty() {
		return this._difficulty;
	}
	set difficulty(v: types.Difficulty) {
		this._difficulty = v;
		this.levelE.difficulty = v;
	}

	/** 現在のワールドのID。表示上はこれに 1 加算したものになる。 */
	worldId: number;

	/** 現在のエリアのID。表示上はこれに 1 加算したものになる。 */
	areaId: number;

	/** ターン番号。０から始まる。 */
	turnNo: number;

	/** フィールドインデックス。 */
	fieldIndex: number;

	/** このゲームの原点となる g.E のスタック。 */
	originStack!: EStack;

	/** このゲームの原点となる g.E 。 */
	get origin(): g.E | null {
		return this.originStack.getTop();
	}

	ohajikiImage!: g.ImageAsset;
	ohajikiStaticImage!: g.ImageAsset;
	ohajikiCrystalImage!: g.ImageAsset;

	/**
	 * おはじきフォント（デバッグ用）。
	 */
	get ohajikiFont(): g.Font {
		if (this._ohajikiFont == null) {
			this._ohajikiFont = new g.DynamicFont({
				game: g.game,
				fontFamily: "monospace",
				fontWeight: "bold",
				size: this.ohajikiImage.height / 2,
			});
		}
		return this._ohajikiFont;
	}

	strikeButtonLayer!: g.E;
	effectLayer!: g.E;
	ohajikiLayer!: g.E;

	levelE!: LevelE;
	normaIndicatorE!: NumberIndicatorE;
	numStrikesIndicatorE!: NumberIndicatorE;
	comboBonusIndicator!: ComboBonusIndicatorE;
	background!: g.Sprite;
	inPlayApplyButton!: InPlayApplyButton;
	winningRateE!: WinningRateE;
	winningSpr!: g.Sprite;

	trailRenderer!: TrailRenderer;

	private _ohajikiFont: g.Font | null;

	private _difficulty: types.Difficulty;

	/** 一方通行の壁を乗り越えるための坂道の有効・無効。 */
	private slopeActive: boolean;

	/** 一方通行の壁。 */
	private oneWayBorder!: Border;
	private oneWayBorderSlope!: OneWayBorderSlope;

	private _remainNorma: number;

	private _numStrikesRemaining: number;

	private _explosionCount: number;

	private playerPanelTray!: PlayerPanelTrayE;
	private panelFont!: g.Font;

	/** BAN モードの切り替え。放送者(部屋主)のインスタンスにだけ存在する。 */
	private banModeE: BanModeE | null;

	constructor(
		scene: OhajikiScene,
		isHost: boolean,
		config: Configuration,
		logger: Logger,
	) {
		this.scene = scene;
		this.isHost = isHost;
		this.config = config;
		this.logger = logger;
		this.started = false;
		this.rand = new g.XorshiftRandomGenerator(
			utils.randomInt(g.game.random, 0, 10000),
		);
		this._ohajikiFont = null;
		this._difficulty = config.general.defaultDifficulty;
		this.worldId = 0;
		this.areaId = 0;
		this.turnNo = 0;
		this._numStrikesRemaining = 0;
		this._remainNorma = 0;
		this._explosionCount = 0;
		this.fieldIndex = 0;
		this.slopeActive = false;
		this.banModeE = null;

		this.explosion = new g.Trigger<ExplosionEvent>();
		this.spark = new g.Trigger<SparkEvent>();
	}

	// scene.loaded が fire されたあとに実行する。
	start(): void {
		this.playerManager = new PlayerManager(
			() => this.getRandomOhajiliLife(this.getPlayerOhajikiParam()!),
			this.rand,
			this.logger,
		);

		this.timeManager = new TimeManager(
			this.config.hitstop.timeScale,
			this.config.hitstop.durationInFrame,
		);

		this.setupSceneGraph();

		// 進行から外すのは決定的な onPlayerBanned だけで行う。
		// banPlayer() の callback はローカルなのでここには使えない。
		//
		// coe は g.MessageEvent を握り潰すので、通知は
		// @multi-indiegame/akashic-player-ban-coe が Controller の
		// broadcast 経路へ載せ替えてここまで運んでくる。
		//
		// 自分が要求していない追放・解除も届く(実行基盤の管理画面など)ので、
		// 両方のハンドラを登録しておく。解除を受け取らないと、戻ってきた
		// 相手を拒み続けることになる。
		onPlayerBanned.add((ev) => this.handlePlayerBanned(ev.playerId), this);
		onPlayerUnbanned.add(
			(ev) => this.handlePlayerUnbanned(ev.playerId),
			this,
		);

		this.entityManager = new EntityManager<BaseGameEntity>();

		this.world = new World({
			iteration: this.config.physics.iteration,
			restTolerance: this.config.physics.restTolerance,
		});

		this.started = true;
	}

	update(): void {
		this.entityManager.flush();
		this.world.flush();
		this.entityManager.entities.forEach((entity) => {
			if (entity) {
				entity.clearDamage();
			}
		});

		// ヒットストップの更新。
		this.timeManager.update();

		// 物理世界を更新。
		this.updateWorld();

		// ゲームエンティティの更新（含む物理世界の反映）。
		this.entityManager.update();

		audio.update(Math.floor((1 / g.game.fps) * 1000));

		// g.E#update による更新がこの後に続く。はず。
	}

	/**
	 * 試合が次のターン（次のプレイヤーがプレイする）に進むことができるか調べる。
	 *
	 * 条件:
	 * - 破壊されたおはじきが存在しない（ワールドから排除されている）。
	 * - 全てのおはじきが静止している。
	 * - 全てのおはじきが一方通行の壁の向こうにいる。
	 * - 爆風でダメージを受けるタイプのおはじきが遅延ダメージを持っている。
	 */
	isTurnCompleted(): boolean {
		if (this.timeManager.isSlowmo) {
			return false;
		}

		for (let i = 0; i < this.world.ohajikis.length; i++) {
			const ohajiki = this.world.ohajikis[i];

			if (!ohajiki) {
				continue;
			}

			const entity = ohajiki.userData as OhajikiGameEntity;

			if (entity.destroyed()) {
				continue;
			}

			// 破壊されたおはじきが存在する。
			if (entity.dead) {
				return false;
			}

			// 移動中のおはじきがある。
			if (ohajiki.velocity.squaredLength() > 0) {
				return false;
			}

			// 爆風で徐々にダメージを受ける状態にあるおはじきが存在する。
			if (entity.blastHitCount > 0) {
				return false;
			}

			// 一方通行の壁を超えていない。
			// ただしスロープが掃き出しを諦めた時は見逃す。
			if (!this.oneWayBorderSlope.giveup) {
				const separation =
					this.oneWayBorder.normal.dot(ohajiki.position) +
					this.oneWayBorder.d -
					ohajiki.radius;
				if (separation < 0) {
					return false;
				}
			}
		}

		return true;
	}

	/**
	 * コンボ数（=一投で起きた爆発の数）に応じて与える透明石の数を求める。
	 *
	 * System#explosionCount に基づいて算出される。
	 */
	crystalOhajikiCount(): number {
		const comboBonuses = this.config.crystalOhajiki.comboBonuses;
		const comboCount = this.explosionCount;

		let count = 0;

		for (let i = 0; i < comboBonuses.length; i++) {
			const bonus = comboBonuses[i];
			if (comboCount < bonus.combo) {
				break;
			}
			count++;
		}

		return count;
	}

	/**
	 * おはじき物理世界の更新。
	 */
	updateWorld(): void {
		const baseIteration = 10;
		const iteration = Math.max(
			1,
			Math.round(baseIteration * this.timeManager.timeScale),
		);
		const subDt = this.timeManager.dt / iteration;

		let willDie: boolean = false;
		let arbiters: Arbiter[] = [];
		let allArbiters: Arbiter[] = [];

		for (let i = 0; i < iteration; i++) {
			if (this.oneWayBorderSlope) {
				this.oneWayBorderSlope.update(subDt);
			}

			this.world.broadPhase();

			// ヒットストップ演出のために衝突した瞬間を捉える必要がある。そのため
			//
			// 1. iteration = 10 として時間解像度を上げる（高速カメラと同じ考え方。これは従来通り）。
			// 2. 致死性衝突の時点でシミュレーションを中断する。

			// 衝突判定対象を取得。
			arbiters = this.world.arbiters.filter(
				(arbiter) => !arbiter.longevity,
			);

			allArbiters = allArbiters.concat(arbiters);

			// 衝突によるダメージを累積する。
			willDie = this.applyCollisionDamage(arbiters);

			// ダメージが累積して消失するおはじきが１つ以上あれば、ここでシミュレーションを中断する。
			if (willDie) {
				break;
			}

			this.world.preStep(subDt);
			this.world.applyImpulse();

			this.world.integrateVelocity(subDt);
		}

		const prevExplosionCount = this.explosionCount;

		// 火花を発生させる。
		this.fireSparkEvent(allArbiters);

		// 接触の状態と累積ダメージに応じた爆発パラメータを生成する。
		const explosionParams = willDie
			? this.createOhajikiExplosionParams(
					arbiters,
					this.explosionCount,
					this.config,
				)
			: [];

		this.explosionCount += explosionParams.length;

		// ダメージを清算し、ライフを減じる。
		this.updateLife(this.entityManager.entities);

		// 爆風の遅延ダメージの更新。これによってライフが０になる時、爆発パラメータが返る。
		const blastDamageExplosionParams = this.updateBlastDamage(
			this.entityManager.entities,
			this.explosionCount,
			this.config,
		);

		this.explosionCount += blastDamageExplosionParams.length;

		// 爆発が起きる時、シミュレーションを一定時間停止する（ヒットストップ）。
		if (this.explosionCount > prevExplosionCount) {
			this.timeManager.startSlowmo();
		}

		// 爆発を起こす。
		explosionParams.forEach((param) => this.applyExplosion(param));
		blastDamageExplosionParams.forEach((param) =>
			this.applyExplosion(param),
		);
	}

	/**
	 * ターン終了時の状態を保存する。
	 */
	save(): SerializedSystem {
		const sers: SerializedOhajikiGameEntity[] = [];

		this.entityManager.entities.forEach((entity) => {
			if (!(entity instanceof OhajikiGameEntity)) {
				return;
			}
			sers.push(entity.serialize());
		});

		return {
			numStrikesRemaining: this.numStrikesRemaining,
			remainNorma: this.remainNorma,
			explosionCount: this.explosionCount,
			worldId: this.worldId,
			areaId: this.areaId,
			fieldIndex: this.fieldIndex,
			ohajikiSers: sers,
		};
	}

	/**
	 * ターン終了時の状態を復元する。
	 */
	restore(serialized: SerializedSystem): void {
		// cleanup.
		this.entityManager.entities.forEach((entity) => {
			if (!(entity instanceof OhajikiGameEntity)) {
				return;
			}
			entity.destroy();
		});

		this.numStrikesRemaining = serialized.numStrikesRemaining;
		this.remainNorma = serialized.remainNorma;
		this.explosionCount = serialized.explosionCount;
		this.worldId = serialized.worldId;
		this.areaId = serialized.areaId;
		this.fieldIndex = serialized.fieldIndex;

		this.comboBonusIndicator.count = this.crystalOhajikiCount();

		this.oneWayBorderSlope.reset();

		this.logger.log(
			`Deserialize ${serialized.ohajikiSers.length} ohajiki(s).`,
		);
		serialized.ohajikiSers.forEach((ser) => {
			const ohajikiGameEntity = new OhajikiGameEntity({
				type: ser.type,

				world: this.world,
				system: this,

				position: ser.position,
				countExplosion: ser.countExplosion,

				appearance: ser.appearance,

				root: this.ohajikiLayer,
				hidden: false,

				life: ser.life,
				damageSources: ser.damageSources,
				normaDecrease: ser.normaDecrease,
				receiveBlastDamage: ser.receiveBlastDamage,

				ohajikiParam: {
					// `...ser.ohajikiParam` は ES5 で Object.assign() に変換される。
					// Object.assign() の利用は sandbox などでオプションが有効な時
					// 警告される。
					mass: ser.ohajikiParam.mass,
					velocity: ser.ohajikiParam.velocity,
					radius: ser.ohajikiParam.radius,
					restitution: ser.ohajikiParam.restitution,
					mu: ser.ohajikiParam.mu,
					// ...ser.ohajikiParam,

					position: ser.position,
				},

				// strikeParam: null,

				blastRadius: ser.blastRadius,
				blastImpulse: ser.blastImpulse,

				logger: this.logger,
			});

			this.entityManager.register(ohajikiGameEntity);
		});
	}

	/**
	 * 現在のレベル設定を取得する。
	 */
	getCurrentLevel(): Level {
		return this.config.worlds[this.difficulty][this.worldId][this.areaId];
	}

	/**
	 * 次のレベルの設定を取得する。
	 *
	 * 存在しない時 null 。
	 */
	getNextLevelConfig(): Level | null {
		let worldId: number;
		let areaId: number;

		if (
			this.config.worlds[this.difficulty][this.worldId][this.areaId + 1]
		) {
			worldId = this.worldId;
			areaId = this.areaId + 1;
		} else {
			worldId = this.worldId + 1;
			areaId = 0;
		}

		const world = this.config.worlds[this.difficulty][worldId];

		return world ? world[areaId] : null;
	}

	/**
	 * 試合開始の準備をする。
	 *
	 * 試合開始準備として以下を行う。
	 * - ワールド、エリアの進行。
	 * - おはじきの配置。
	 */
	setupLevel(param: LevelParam): OhajikiGameEntity[] {
		const cont = param.cont;
		const hidden = param.hidden;

		if (param.type === "go-to") {
			this.worldId = param.worldId;
			this.areaId = param.areaId;
		} else {
			if (
				this.config.worlds[this.difficulty][this.worldId][
					this.areaId + 1
				]
			) {
				this.areaId++;
			} else {
				this.worldId++;
				this.areaId = 0;
			}
		}

		this.turnNo = 0;

		const level = this.getCurrentLevel();

		if (cont) {
			this.remainNorma += level.norma;
			// レベルクリア演出中に加算するので、ここでは加算しない。
			// this.numStrikesRemaining += level.numAwardOhajikis;
		} else {
			this.remainNorma = level.norma;
			this.numStrikesRemaining =
				this.config.general.initialNumStrikesRemaining;
		}

		const field = this.config.fields[this.fieldIndex];
		const deployArea = field.deployArea;

		const ohajikis = deployOhajikiForLevel({
			system: this,

			level: this.getCurrentLevel(),
			boxArea: {
				pos: {
					x: (deployArea.right + deployArea.left) / 2,
					y: (deployArea.bottom + deployArea.top) / 2,
				},
				size: {
					x: deployArea.right - deployArea.left,
					y: deployArea.bottom - deployArea.top,
				},
			},
			hidden,

			entityNamager: this.entityManager,

			ohajikiParams: this.config.ohajikis,
			world: this.world,

			root: this.ohajikiLayer,
			logger: this.logger,
		});

		this.levelE.worldId = this.worldId;
		this.levelE.areaId = this.areaId;
		this.levelE.modified();

		return ohajikis;
	}

	getCurrentField(): FieldParameter {
		return this.config.fields[this.fieldIndex];
	}

	/**
	 * 透明おはじきの配置。
	 *
	 * deployOhajiki()のラッパーである。
	 *
	 * @param numCrystalOhajiki 配置する透明おはじきの数。
	 */
	deployCrystalOhajiki(numCrystalOhajiki: number): OhajikiGameEntity[] {
		const field = this.config.fields[this.fieldIndex];
		const deployArea = field.deployArea;
		const hidden = true;
		const ohajikiParam = this.config.ohajikis.filter(
			(param) => param.id === this.config.crystalOhajiki.ohajikiId,
		)[0];

		return deployOhajiki(numCrystalOhajiki, {
			system: this,
			world: this.world,
			entityManager: this.entityManager,

			ohajikiParam,

			countExplosion: this.config.crystalOhajiki.countExplosion,

			boxArea: {
				pos: {
					x: (deployArea.right + deployArea.left) / 2,
					y: (deployArea.bottom + deployArea.top) / 2,
				},
				size: {
					x: deployArea.right - deployArea.left,
					y: deployArea.bottom - deployArea.top,
				},
			},

			root: this.ohajikiLayer,
			hidden,

			logger: this.logger,
		});
	}

	/**
	 * 全てのおはじきが静止しているか。
	 */
	isAllOhajikiRest(): boolean {
		for (let i = 0; i < this.world.ohajikis.length; i++) {
			const ohajiki = this.world.ohajikis[i];
			if (!ohajiki) {
				continue;
			}
			if (ohajiki.velocity.squaredLength() !== 0) {
				return false;
			}
		}

		return true;
	}

	/**
	 * レベルをクリアしているか。
	 */
	isLevelClear(): boolean {
		return this.remainNorma <= 0;
	}

	/**
	 * ゲームをクリアしているか。
	 */
	isGameClear(): boolean {
		return this.isLevelClear() && this.getNextLevelConfig() == null;
	}

	/**
	 * ゲームオーバーか。
	 */
	isGameOver(): boolean {
		return this.remainNorma > 0 && this.numStrikesRemaining <= 0;
	}

	/**
	 * 現在のレベルのUIDを取得する。
	 *
	 * UIDは全てのレベルに与えられる通し番号(Universe Identity)。
	 */
	getCurrentLevelUId(): number {
		const worlds = this.config.worlds[this.difficulty];

		let id = 0;
		for (let i = 0; i < this.worldId; i++) {
			id += worlds[i].length;
		}

		id += this.areaId;

		return id;
	}

	/**
	 * 宇宙(=全てのワールドの集合)に存在するレベル総数を取得する。。
	 */
	getUniverseSize(): number {
		const worlds = this.config.worlds[this.difficulty];

		let total = 0;
		for (let i = 0; i < worlds.length; i++) {
			total += worlds[i].length;
		}

		return total;
	}

	getOhajikiParamById(id: string): OhajikiParameter | null {
		for (let i = 0; i < this.config.ohajikis.length; i++) {
			const param = this.config.ohajikis[i];
			if (param.id === id) {
				return param;
			}
		}

		return null;
	}

	getPlayerOhajikiParam(): OhajikiParameter | null {
		return this.getOhajikiParamById(this.config.general.playerOhajikiId);
	}

	getRandomOhajiliLife(param: OhajikiParameter): number {
		return utils.randomInt(
			this.rand,
			param.lifeRange[0],
			param.lifeRange[1],
		);
	}

	getStrikePosition(): Vector2Like {
		return this.config.fields[this.fieldIndex].strikePosition;
	}

	/**
	 * おはじきのライフを調整する。
	 *
	 * ピンチ状態の時調整される。ただし、調整した結果ライフが増えるようならそのままにする。
	 * 残り投石数 2 以下の時、ピンチと判断する。
	 *
	 * @param life おはじきのライフ。
	 */
	tweakLifeIfInaPinch(life: number): number {
		const newLife =
			this.numStrikesRemaining <= 2 ? this.numStrikesRemaining + 1 : life;
		return newLife < life ? newLife : life;
	}

	putPlayerOhajiki(
		param: PlayerOhajikiGameEntityParam = {},
	): OhajikiGameEntity | null {
		const position = param.position || this.getStrikePosition();
		const allowDeployOhajikiOutside =
			typeof param.allowDeployOhajikiOutside === "boolean"
				? param.allowDeployOhajikiOutside
				: false;
		const ohajikiParam = param.ohajikiParam || this.getPlayerOhajikiParam();
		if (!ohajikiParam) {
			return null;
		}
		const life =
			param.life != null
				? param.life
				: this.tweakLifeIfInaPinch(
						this.getRandomOhajiliLife(ohajikiParam),
					);
		// const life = 10;

		if (!allowDeployOhajikiOutside) {
			const borders = this.world.borders;
			for (let i = 0; i < borders.length; i++) {
				const border = borders[i];
				if (border.betaScale === 0) {
					continue;
				}
				if (border.normal.dot(position) + border.d < 0) {
					return null;
				}
			}
		}

		const ohajikiGameEntity = new OhajikiGameEntity({
			system: this,
			type: ohajikiParam.type,
			world: this.world,
			position,
			root: this.ohajikiLayer,
			life,
			hidden: false,

			appearance: ohajikiParam.appearance,

			damageSources: ohajikiParam.damageSources,
			normaDecrease: ohajikiParam.normaDecrease,
			countExplosion: true,
			receiveBlastDamage: ohajikiParam.receiveBlastDamage,

			ohajikiParam: {
				mass: ohajikiParam.mass,
				radius: ohajikiParam.radius,
				position,
				mu: ohajikiParam.mu,
				restitution: ohajikiParam.restitution,
			},

			blastRadius: ohajikiParam.blast.radius,
			blastImpulse: ohajikiParam.blast.impulse,

			logger: this.logger,
		});

		this.entityManager.register(ohajikiGameEntity);

		return ohajikiGameEntity;
	}

	setupField(param?: FieldParameter): void {
		param = param || this.config.fields[this.fieldIndex];

		this.entityManager.destroyAllEntities();
		this.world.ohajikis = [];
		this.world.borders = [];

		const corners = createCorners(param.corners);
		const borders = createBorders(corners);
		const oneWayBorderCorners = createCorners(param.oneWayBorderCorners);

		this.oneWayBorder = new Border(
			oneWayBorderCorners[0],
			oneWayBorderCorners[1],
		);
		this.oneWayBorder.betaScale = 0;
		borders.push(this.oneWayBorder);

		Array.prototype.push.apply(this.world.borders, borders);

		this.world.borders.forEach((border) => {
			this.entityManager.register(new BorderGameEntity(border));
		});

		this.oneWayBorderSlope = new OneWayBorderSlope(
			this.world,
			this.oneWayBorder,
			8,
			param.tossArea,
			this.logger,
		);
	}

	getPlayerPanelTrayPosition(): Vector2Like {
		return { x: this.playerPanelTray.x, y: this.playerPanelTray.y };
	}

	getPlayerPanel(idx: number): PlayerPanelE {
		return this.playerPanelTray.playerPanels[idx];
	}

	addPlayerPanel(
		playerData: PlayerData,
		highlit: boolean,
		tween: tl.Tween,
	): tl.Tween {
		this.playerPanelTray.pushPanel(
			this.createPlayerPanel(playerData, highlit),
			tween,
		);

		return tween;
	}

	/**
	 * プレイヤーパネルの生成。トレイへの追加は呼び出し側で行う。
	 */
	private createPlayerPanel(
		playerData: PlayerData,
		highlit: boolean,
	): PlayerPanelE {
		const scene = this.scene;
		const player = playerData.player;

		const ohajikiE = createOhajikiE(
			scene,
			"normal",
			false,
			playerData.ohajikiLife,
			{ x: 0, y: 0 },
			false,
		);

		const panelImageAsset = scene.asset.getImage(
			"/assets/gameplay/player/panel_next.png",
		);

		const playerPanel = new PlayerPanelE({
			scene,
			name: player.screenName || player.name || player.id,
			font: this.panelFont,
			highlit: highlit,
			normalImageAsset: panelImageAsset,
			blinkImageAsset: scene.asset.getImage(
				"/assets/gameplay/player/panel_next_tosen.png",
			),
			hilightImageAsset: scene.asset.getImage(
				"/assets/gameplay/player/panel_player.png",
			),
			playerImageAsset: scene.asset.getImage(
				"/assets/gameplay/player/panel_player_text.png",
			),
			ohajikiE,
		});

		// 放送者(部屋主)だけに、自分以外のプレイヤーを追放するメニューを見せる。
		// 誰が発行してよいかを決めるのは実行基盤なので、これは表示の出し分けにすぎない。
		// banModeE は放送者のインスタンスにしか無く、置くのもローカルエンティティである
		// BanMenuE に限る。
		// 自分のパネルにも BAN ボタンの無いメニューを置く。パネル以外のタップで
		// BAN モードを解除するので、自分のパネルのタップでは解除させない。
		if (this.banModeE) {
			playerPanel.append(
				new BanMenuE({
					scene,
					panelWidth: panelImageAsset.width,
					panelHeight: panelImageAsset.height,
					buttonImageAsset: scene.asset.getImage(
						"/assets/gameplay/ui/ban_button.png",
					),
					buttonPressedImageAsset: scene.asset.getImage(
						"/assets/gameplay/ui/ban_button_pressed.png",
					),
					playerId: player.id,
					banMode: this.banModeE,
					onBan:
						player.id !== g.game.selfId
							? (playerId) =>
									this.requestBan({
										playerId,
										name: player.screenName || player.name,
									})
							: null,
				}),
			);
		}

		return playerPanel;
	}

	/**
	 * 追放されたプレイヤーを進行から外す。
	 *
	 * onPlayerBanned は全インスタンスが同一 tick で同一内容を受け取るので、
	 * ここでの変更は決定的である。逆に、ここ以外でゲーム状態を変えてはならない。
	 */
	private handlePlayerBanned(playerId: string): void {
		const playerManager = this.playerManager;

		// 同じ確定の再送。すでに進行から外してある。
		if (
			playerManager.isBannedPlayer(playerId) &&
			playerManager.findQueueIndex(playerId) < 0
		) {
			return;
		}

		// ゲームに触れていないプレイヤーの追放も届く。登録がなくても、
		// 再入室で参加されないよう BAN リストには載せる。
		const player =
			playerManager.findPlayer(playerId) ?? new Player(playerId);

		this.logger.info(`Remove a banned player from the game: ${playerId}`);

		// 抽選対象から外し、再入室しても参加できないようにする。
		//
		// 実行基盤の追放はコンテンツ側の都合で拒めないので、放送者(isHost)
		// であっても外す。追放された相手は実行基盤から切断されている以上、
		// 待機列の先頭に残しておく方が進行を壊す。
		playerManager.forceBan(player);

		// 自分が追放されたなら途中参加もできない。
		if (playerId === g.game.selfId && this.inPlayApplyButton) {
			this.inPlayApplyButton.hide();
		}

		if (
			this.playerPanelTray.playerPanels.length !==
			playerManager.queue.length
		) {
			this.logger.warn(
				"Player panels and the queue are out of sync. " +
					`panels = ${this.playerPanelTray.playerPanels.length}, queue = ${playerManager.queue.length}`,
			);
		}

		// 参加者が少ないと同じプレイヤーが待機列に複数並ぶので、先頭以外を
		// すべて取り除く。
		//
		// 投球中(待機列の先頭)はここで外すと手番の進行が壊れるので残す。
		// 手番は TurnState が投数を使わずに飛ばし、changePlayer() で通常どおり抜ける。
		// 先頭から探すと先頭で止まってしまい後ろの重複が残るので、2 番目から探す。
		//
		// NOTE: アニメーションさせない。tween は開始時の y を捕まえて動かすので、
		// 手番進行のタイムラインが同じパネルを動かしている最中に重なると
		// 最終位置が壊れる（リロード後にパネルがずれる原因になっていた）。
		let removed = 0;
		for (;;) {
			const index = playerManager.findQueueIndex(playerId, 1);
			if (index < 0) {
				break;
			}
			playerManager.removeQueueAt(index);
			this.playerPanelTray.removeAtImmediately(index);
			removed++;
		}

		if (removed === 0) {
			return;
		}

		playerManager.fillQueue();

		// 補充されたプレイヤーのパネルを並べる。
		while (
			playerManager.queue.length >
			this.playerPanelTray.playerPanels.length
		) {
			this.playerPanelTray.addPanel(
				this.createPlayerPanel(
					playerManager.queue[
						this.playerPanelTray.playerPanels.length
					],
					false,
				),
			);
		}
	}

	/**
	 * 追放の解除に追従する。
	 *
	 * 抽選対象には戻さない。追放の間に切断されている以上、参加し直すかは
	 * プレイヤー自身の操作に任せる。
	 */
	private handlePlayerUnbanned(playerId: string): void {
		const player = this.playerManager.unban(playerId);

		if (!player) {
			return;
		}

		this.logger.info(
			`Unbanned player is allowed to join again: ${playerId}`,
		);

		// 自分が解除されたなら、途中参加ボタンを出し直す。
		if (
			playerId === g.game.selfId &&
			this.inPlayApplyButton &&
			!this.playerManager.findPlayer(g.game.selfId)
		) {
			this.showInPlayApplyButton();
		}
	}

	/**
	 * プレイヤーの追放を実行基盤に要求する。
	 *
	 * callback はローカルなので、ここでゲーム状態を変更してはならない。
	 * 進行から外すのは onPlayerBanned の中で行うこと。
	 * 確認ダイアログは実行基盤が出すので、ここでは確認しない。
	 */
	private requestBan(target: BanTarget): void {
		banPlayer(target, (result) => {
			if (result.ok) {
				this.logger.info(
					`banPlayer accepted: ${target.playerId} (name = ${target.name})`,
				);
				this.banModeE?.showMessage("banned");
			} else {
				this.logger.warn(
					`banPlayer rejected: ${target.playerId} (name = ${target.name}), reason: ${result.reason}`,
				);
				this.banModeE?.showMessage(result.reason ?? "Unknown");
			}
		});
	}

	/**
	 * 待機列の変化に合わせてパネルを更新する。
	 *
	 * 先頭のパネルを取り除いたあと、パネルの無い待機列のプレイヤーのパネルを
	 * 後ろに並べる。待機列が埋まらなかった時はパネルを足さず、空になった
	 * 待機列が後から埋め直された時はまとめて足す。
	 *
	 * 追加したパネルとそのプレイヤーデータを返す。
	 *
	 * @param removeTop 真の時、先頭のパネルを取り除く。
	 * @param tween 演出のアニメーションが構築される tween 。
	 */
	syncPlayerPanels(removeTop: boolean, tween: tl.Tween): AddedPlayerPanel[] {
		if (removeTop) {
			this.removePlayerPanel(tween);
		}

		const queue = this.playerManager.queue;
		const panels = this.playerPanelTray.playerPanels;
		const added: AddedPlayerPanel[] = [];

		while (queue.length > panels.length) {
			const index = panels.length;
			this.addPlayerPanel(queue[index], index === 0, tween);
			added.push({ playerData: queue[index], panel: panels[index] });
		}

		return added;
	}

	removePlayerPanel(tween: tl.Tween): tl.Tween {
		this.playerPanelTray.removeTop(tween);

		// 全員が追放されるとパネルが無くなる。
		if (this.playerPanelTray.playerPanels.length === 0) {
			return tween;
		}

		this.playerPanelTray.playerPanels[0].switchHighlight(true, tween);
		return tween;
	}

	/**
	 * 当選率表示を隠し、当選表示を行う tween を作成する。
	 */
	showWinning(tween: tl.Tween): tl.Tween {
		tween
			.call(() => {
				this.winningRateE.hide();
				this.winningSpr.show();
				audio.playbackSE("/assets/common/se/notify_winning");
			})
			.wait(4000)
			.call(() => {
				this.winningRateE.show();
				this.winningSpr.hide();
			});

		return tween;
	}

	/**
	 * 当選演出する。
	 *
	 * パネルは位置ではなくエンティティで受け取る。演出が始まるまでの間に追放で
	 * パネルが取り除かれ、並びが変わったり足りなくなったりすることがあるため。
	 *
	 * @param tween 演出のアニメーションを構築される tween 。
	 * @param blinkPanel blink させるパネル。null の時、なにもしない。
	 */
	notifyWinningByLottery(
		tween: tl.Tween,
		blinkPanel: PlayerPanelE | null,
	): tl.Tween {
		this.showWinning(tween);
		if (blinkPanel && !blinkPanel.destroyed()) {
			blinkPanel.blink = true;
		}
		return tween;
	}

	/**
	 * 途中参加ボタンを出す。
	 *
	 * ボタンは押されると touchable を落として隠れるので、出し直す時は戻す。
	 * 戻さないと、一度途中参加した後に追放・解除されたプレイヤーが押せなくなる。
	 */
	showInPlayApplyButton(): void {
		this.inPlayApplyButton.touchable = true;
		this.inPlayApplyButton.pushed = false;
		this.inPlayApplyButton.show();
	}

	/**
	 * 各おはじきに物体同士の接触によるダメージを与える。
	 */
	private applyCollisionDamage(arbiters: Arbiter[]): boolean {
		const system = this;

		let willDie = false;

		for (let i = 0; i < arbiters.length; i++) {
			const arbiter = arbiters[i];

			const bodyA = arbiter.bodyA;
			const bodyB = arbiter.bodyB;
			const bodyAGameEntity = bodyA.userData as BaseGameEntity;
			const bodyBGameEntity = bodyB.userData as BaseGameEntity;

			// ohajiki と 一方通行の の接触ならおはじきが「出て行く動き」をしている限りノーダメージにする。
			if (
				bodyB !== system.oneWayBorder ||
				bodyA.velocity.dot(bodyB.normal) < 0
			) {
				let AWillDie = false;
				let BWillDie = false;
				bodyAGameEntity.addDamage(bodyBGameEntity);
				AWillDie = bodyAGameEntity.willDie();
				bodyBGameEntity.addDamage(bodyAGameEntity);
				BWillDie = bodyBGameEntity.willDie();
				willDie = willDie || AWillDie || BWillDie;
			}
		}

		return willDie;
	}

	private fireSparkEvent(arbiters: Arbiter[]): void {
		for (let i = 0; i < arbiters.length; i++) {
			const arbiter = arbiters[i];

			this.spark.fire({
				position: arbiter.contacts[0].point,
				bodyA: arbiter.bodyA,
				bodyB: arbiter.bodyB,
				system: this,
			});
		}
	}

	/**
	 * 接触状態に応じて爆風パラメータを生成する。
	 *
	 * @param arbiters ２体の接触情報。
	 * @param explosionCount 爆発数の初期値。
	 * @param config コンフィグ。
	 */
	private createOhajikiExplosionParams(
		arbiters: Arbiter[],
		explosionCount: number,
		config: Configuration,
	): ExplosionParamEx[] {
		const explosionParams: ExplosionParamEx[] = [];

		for (let i = 0; i < arbiters.length; i++) {
			const arbiter = arbiters[i];

			const bodyA = arbiter.bodyA;
			const bodyB = arbiter.bodyB;
			const bodyAGameEntity = bodyA.userData as BaseGameEntity;
			const bodyBGameEntity = bodyB.userData as BaseGameEntity;

			const AWillDie = bodyAGameEntity.willDie();
			const BWillDie = bodyBGameEntity.willDie();

			let param: ExplosionParamEx | null = null;

			// 接触する二体が同時に爆発する時、単一の大きな爆発にする。
			if (AWillDie && BWillDie) {
				param = {
					position: arbiter.contacts[0].point,
					radius: config.specialBlast.radius,
					impulse: config.specialBlast.impulse,
					blastDamage: config.general.blastDamage,
					sources: [bodyAGameEntity, bodyBGameEntity],
					appearance: "big",
					spawnCrystal: isComboBonus(
						explosionCount + 1,
						config.crystalOhajiki,
					),
					seAssetName: getExplosionSeAssetName(explosionCount + 1),
				};
			} else if (AWillDie || BWillDie) {
				// 通常の爆発（どちらか一方の爆発）。
				const entity = AWillDie ? bodyAGameEntity : bodyBGameEntity;
				param = createExplosionParamEx(
					entity,
					explosionCount + 1,
					config.crystalOhajiki,
				);
			}

			if (param) {
				// コンボボーナスやSEに関係するため、実際に爆発した（パラメータが生成された）なら
				// カウントを増やす。
				explosionCount++;
				explosionParams.push(param);
			}
		}

		return explosionParams;
	}

	/**
	 * エンティティのライフを更新する。
	 *
	 * 累積ダメージをクリアする。ライフが０になったエンティティがあればノルマを減じる。
	 *
	 * @param entities エンティティ配列。
	 */
	private updateLife(entities: (BaseGameEntity | null)[]): void {
		for (let i = 0; i < entities.length; i++) {
			const entity = entities[i];
			if (!entity) {
				continue;
			}
			const dead = entity.updateLife();
			entity.clearDamage();

			if (dead) {
				this.remainNorma -= entity.normaDecrease;
			}
		}
	}

	/**
	 * 爆風ダメージを更新する。
	 *
	 * 爆風ダメージは何度かに分けてライフを減じる。ライフが０になったエンティティが
	 * あればノルマを減じ、爆風パラメータを生成する。
	 *
	 * @param entities エンティティ配列。
	 * @param explosionCount 爆発数の初期値。
	 */
	private updateBlastDamage(
		entities: (BaseGameEntity | null)[],
		explosionCount: number,
		config: Configuration,
	): ExplosionParamEx[] {
		const explosionParams: ExplosionParamEx[] = [];

		for (let i = 0; i < entities.length; i++) {
			const entity = entities[i];
			if (!entity) {
				continue;
			}
			entity.updateBlastDamage();
			const died = entity.updateLife();
			entity.clearDamage();

			if (died) {
				this.remainNorma -= entity.normaDecrease;

				const param = createExplosionParamEx(
					entity,
					explosionCount + 1,
					config.crystalOhajiki,
				);

				if (param) {
					explosionCount++;
					explosionParams.push(param);
				}
			}
		}

		return explosionParams;
	}

	/**
	 * 爆発をおはじきに適用する。
	 *
	 * @param param 爆発パラメータ。
	 */
	private applyExplosion(param: ExplosionParamEx): void {
		applyBlast(
			this.world,
			param.position,
			param.sources,
			param.radius,
			param.impulse,
			param.blastDamage,
		);

		audio.playbackSE(param.seAssetName);

		this.explosion.fire({
			explosionParam: param,
			system: this,
		});
	}

	private setupSceneGraph(): void {
		const scene = this.scene;

		this.originStack = new EStack(scene);
		this.originStack.push(new g.E({ scene }));

		this.ohajikiImage = scene.asset.getImage(
			"/assets/gameplay/ui/circleBlue.png",
		);
		this.ohajikiStaticImage = scene.asset.getImage(
			"/assets/gameplay/ui/circleGreen.png",
		);
		this.ohajikiCrystalImage = scene.asset.getImage(
			"/assets/gameplay/ui/circleCrystal.png",
		);

		this.panelFont = new g.DynamicFont({
			game: g.game,
			fontFamily: "monospace",
			size: 32,
		});

		const numberImageAssets: g.ImageAsset[] = [];
		for (let i = 0; i < 10; i++) {
			numberImageAssets.push(
				scene.asset.getImage(
					"/assets/common/numbers/stageNum_0" + i + ".png",
				),
			);
		}

		const difficultyImageAssets = {
			easy: scene.asset.getImage("/assets/ui/cutin/stage_easy.png"),
			normal: scene.asset.getImage("/assets/ui/cutin/stage_normal.png"),
			hard: scene.asset.getImage("/assets/ui/cutin/stage_hard.png"),
			crazy: scene.asset.getImage("/assets/ui/cutin/stage_crazy.png"),
		};

		this.levelE = new LevelE({
			scene,
			x: 10,
			y: 10,
			width: 180,
			worldId: this.worldId,
			areaId: this.areaId,
			difficulty: this._difficulty,
			numberImageAssets,
			difficultyImageAssets,
			hyphenImageAsset: scene.asset.getImage(
				"/assets/common/numbers/stageNum_hyphen.png",
			),
		});

		const normaNumberImageAssets: g.ImageAsset[] = [];
		for (let i = 0; i < 10; i++) {
			normaNumberImageAssets.push(
				scene.asset.getImage(
					"/assets/common/numbers/taskNum_0" + i + ".png",
				),
			);
		}

		const redNormaNumberImageAssets: g.ImageAsset[] = [];
		for (let i = 0; i < 4; i++) {
			redNormaNumberImageAssets.push(
				scene.asset.getImage(
					"/assets/common/numbers/taskNum_danger_0" + i + ".png",
				),
			);
		}

		this.normaIndicatorE = new NumberIndicatorE({
			scene,
			x: 200,
			y: 10,
			num: 0,
			maxIndicator: 12,
			labelImageAsset: scene.asset.getImage(
				"/assets/gameplay/player/task_remain.png",
			),
			indicatorImageAsset: scene.asset.getImage(
				"/assets/ui/cutin/icon_bomb.png",
			),
			numberImageAssets: normaNumberImageAssets,
			redNumberImageAssets: redNormaNumberImageAssets,
			minusImageAsset: scene.asset.getImage(
				"/assets/common/numbers/taskNum_minus.png",
			),
			unitImageAsset: scene.asset.getImage(
				"/assets/common/numbers/taskNum_ko.png",
			),
		});

		this.numStrikesIndicatorE = new NumberIndicatorE({
			scene,
			x: 834,
			y: 10,
			height: 72,
			maxIndicator: 10,
			labelImageAsset: scene.asset.getImage(
				"/assets/gameplay/player/task_remain02.png",
			),
			indicatorImageAsset: scene.asset.getImage(
				"/assets/ui/cutin/icon_ball.png",
			),
			redIndicatorImageAsset: scene.asset.getImage(
				"/assets/ui/cutin/icon_ball_alert.png",
			),
			numberImageAssets: normaNumberImageAssets,
			redNumberImageAssets: redNormaNumberImageAssets,
			minusImageAsset: scene.asset.getImage(
				"/assets/common/numbers/taskNum_minus.png",
			),
			unitImageAsset: scene.asset.getImage(
				"/assets/common/numbers/taskNum_tou.png",
			),
		});

		this.background = new g.Sprite({
			scene,
			src: scene.asset.getImage(
				"/assets/common/backgrounds/background.png",
			),
		});

		this.strikeButtonLayer = new g.E({ scene });
		this.ohajikiLayer = new g.E({ scene });
		this.effectLayer = new g.E({ scene });

		this.playerPanelTray = new PlayerPanelTrayE({
			scene,
			x: 1016,
			y: 114,
		});

		this.comboBonusIndicator = new ComboBonusIndicatorE({
			scene,
			x: 809,
			y: 108,
			count: 0,
			numberImageAssets,
			labelImageAsset: scene.asset.getImage(
				"/assets/gameplay/player/chainBonus_txt.png",
			),
			equalImageAsset: scene.asset.getImage(
				"/assets/gameplay/player/chainBonus_equal.png",
			),
			ohajikiImageAsset: scene.asset.getImage(
				"/assets/common/ohajiki/ball_cleanness.png",
			),
			hidden: true,
		});

		this.trailRenderer = new TrailRenderer({
			scene,
			width: g.game.width,
			height: g.game.height,
			opacity: 0.5,

			// 単色水色。
			gradation: false,
			upperTriangleSrc: this.scene.asset.getImage(
				"/assets/gameplay/ui/upperTriangle2.png",
			),
			lowerTriangleSrc: this.scene.asset.getImage(
				"/assets/gameplay/ui/lowerTriangle2.png",
			),
		});

		// trail はヒットストップに関わらず更新する。
		// ヒットストップ中に trail の削除があり得るため。
		this.trailRenderer.onUpdate.add(() => this.trailRenderer.invalidate());

		// 途中参加ボタン。
		const inPlayApplyButton = new InPlayApplyButton({
			scene,
			x: 1080,
			y: 544,
			buttonImageAsset: scene.asset.getImage(
				"/assets/gameplay/player/sanka.png",
			),
			buttonPushedImageAsset: scene.asset.getImage(
				"/assets/gameplay/player/sanka_active.png",
			),
			hidden: true,
			touchable: true,
		});
		inPlayApplyButton.onPointDown.add((_ev) => {
			inPlayApplyButton.pushed = true;
		});
		inPlayApplyButton.onPointUp.add((ev) => {
			const x = ev.point.x + ev.startDelta.x;
			const y = ev.point.y + ev.startDelta.y;
			if (
				0 <= x &&
				x <= inPlayApplyButton.width &&
				0 <= y &&
				y <= inPlayApplyButton.height
			) {
				resolvePlayerInfo({}, (err, playerInfo) => {
					if (err) {
						this.logger.log("resolvePlayerInfo err:", err);
					}
					if (playerInfo?.name) {
						this.displayName = playerInfo.name;
					}
					utils.applyForPlay(this);
				});
				inPlayApplyButton.touchable = false;
				inPlayApplyButton.hide();
			}
			inPlayApplyButton.pushed = false;
		});
		this.inPlayApplyButton = inPlayApplyButton;

		this.winningRateE = new WinningRateE({
			scene,
			x: 1020,
			y: 622,
			opacity: 0,
			baseImageAsset: scene.asset.getImage(
				"/assets/gameplay/player/kakuritu.png",
			),
			numberImageAssets,
			percentImageAsset: scene.asset.getImage(
				"/assets/common/numbers/stageNum_percent.png",
			),
			lowerImageAsset: scene.asset.getImage(
				"/assets/common/numbers/stageNum_less.png",
			),
		});

		this.winningSpr = new g.Sprite({
			scene,
			x: 1020,
			y: 554,
			src: scene.asset.getImage("/assets/gameplay/player/text_tosen.png"),
			hidden: true,
		});

		this.playerManager.playerAdded.add((p) => this.onPlayerAddedRemoved(p));
		this.playerManager.playerRemoved.add((p) =>
			this.onPlayerAddedRemoved(p),
		);

		const origin = this.origin!;
		this.scene.append(origin);

		origin.append(this.background);
		origin.append(this.trailRenderer);
		origin.append(this.levelE);
		origin.append(this.normaIndicatorE);
		origin.append(this.numStrikesIndicatorE);
		origin.append(this.comboBonusIndicator);
		origin.append(this.ohajikiLayer);
		origin.append(this.strikeButtonLayer);
		origin.append(this.playerPanelTray);
		origin.append(this.winningRateE);
		origin.append(this.winningSpr);
		origin.append(this.inPlayApplyButton);
		origin.append(this.effectLayer);

		// 放送者(部屋主)だけに BAN モードの切り替えを見せる。
		// 自分の手番の全画面の投石ボタンにタップを奪われないよう、
		// strikeButtonLayer より上に置く。
		//
		// 追放を要求できない実行基盤では、押しても何も起きないので出さない。
		// isSupported() の結果はインスタンスごとに違いうるが、BanModeE も
		// パネルの BanMenuE もローカルエンティティなので表示の出し分けに留まる。
		if (this.isHost && isSupported()) {
			const messageImageAssets = {} as {
				[id in BanMessageId]: g.ImageAsset;
			};
			banMessageIds.forEach((id) => {
				messageImageAssets[id] = scene.asset.getImage(
					`/assets/gameplay/ui/ban_msg_${id}.png`,
				);
			});

			this.banModeE = new BanModeE({
				scene,
				messageImageAssets,
				sirenOnImageAsset: scene.asset.getImage(
					"/assets/gameplay/ui/ban_siren_on.png",
				),
				sirenOffImageAsset: scene.asset.getImage(
					"/assets/gameplay/ui/ban_siren_off.png",
				),
			});
			origin.append(this.banModeE);
		}
	}

	private onPlayerAddedRemoved(_player: Player): void {
		this.winningRateE.rate = this.playerManager.calcWinningRate() * 100;
		this.winningRateE.modified();
	}
}
