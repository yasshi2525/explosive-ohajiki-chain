import type { BanResultReason } from "@multi-indiegame/akashic-player-ban";

/**
 * 説明ラベルに出す文言の種類。
 *
 * - prompt: BAN モードに入った時の説明。
 * - banned: banPlayer() が受け付けられた時の報告。
 * - BanResultReason: banPlayer() が拒否された時の理由。
 */
export type BanMessageId = "prompt" | "banned" | BanResultReason;

/**
 * 説明ラベルの文言の種類の一覧。
 *
 * 文言は画像 `/assets/gameplay/ui/ban_msg_<id>.png` に描かれている。
 *
 * - prompt: BANするユーザーを選択してください
 * - banned: ユーザーをBANしました
 * - NotSupported: この環境ではBANできません
 * - Unauthorized: BANする権限がありません
 * - PlayerNotFound: ユーザーが見つかりませんでした
 * - SelfBan: 自分自身はBANできません
 * - LimitExceeded: BANできる上限に達しました
 * - UserCancel: BANを取りやめました
 * - Unknown: BANできませんでした
 */
export const banMessageIds: readonly BanMessageId[] = [
	"prompt",
	"banned",
	"NotSupported",
	"Unauthorized",
	"PlayerNotFound",
	"SelfBan",
	"LimitExceeded",
	"UserCancel",
	"Unknown",
];

export interface BanModeEParameterObject extends g.EParameterObject {
	/** 説明ラベルの画像。文言の種類ごとに用意する。 */
	messageImageAssets: { [id in BanMessageId]: g.ImageAsset };

	/** BAN モード中のサイレン画像。 */
	sirenOnImageAsset: g.ImageAsset;

	/** BAN モードでない時のサイレン画像。 */
	sirenOffImageAsset: g.ImageAsset;
}

/**
 * BAN モード中にタップで選べる対象。プレイヤーパネルに載る BanMenuE が該当する。
 */
export interface BanTarget {
	/**
	 * 画面上の点が対象の上にあるか。
	 *
	 * @param point シーン座標の点。
	 */
	contains(point: g.CommonOffset): boolean;

	/** 押されている表示の切り替え。 */
	setPressed(pressed: boolean): void;

	/** タップされた時の処理。 */
	tap(): void;
}

/**
 * BAN モードの切り替えボタンと、その説明ラベル。
 *
 * ヘッダーのノルマ表示と残り投数表示の間にサイレンを置き、タップすると BAN
 * モードに入る。BAN モードの間はサイレンが光り、ヘッダー直下に説明ラベルを
 * 出し、プレイヤーパネルが BAN 対象として選べるようになる(BanMenuE)。
 * サイレンかプレイヤーパネル以外をタップすると解除する。
 *
 * 部屋主のインスタンスにしか存在しないので、このエンティティとその子は
 * すべてローカルである。
 */
export class BanModeE extends g.E {
	/**
	 * サイレンの中心。
	 *
	 * ノルマ表示はノルマ 14 で x=702 付近まで伸び、残り投数表示は x=834 から
	 * 始まる。その間の常に空いている帯に収める。
	 */
	private static readonly SirenCenterX: number = 769;
	private static readonly SirenCenterY: number = 44;

	/** 説明ラベルの上端。ヘッダーの直下。 */
	private static readonly MessageY: number = 88;

	/** 説明ラベルの右端。サイレンの右端あたりに揃える。 */
	private static readonly MessageRight: number = 811;

	/** 画面左端との最小間隔。 */
	private static readonly ScreenMargin: number = 8;

	/** 説明ラベルをそのまま見せる時間。 */
	private static readonly MessageHoldMs: number = 3000;

	/** 説明ラベルのフェードにかける時間。 */
	private static readonly MessageFadeMs: number = 1000;

	/** 選択を促す説明ラベルが薄くなった後の透明度。 */
	private static readonly PromptDimmedOpacity: number = 0.5;

	/**
	 * BAN モードの切り替え。引数は切り替え後の状態。
	 */
	readonly onChange: g.Trigger<boolean>;

	private _active: boolean;
	private sirenOn: g.Sprite;
	private sirenOff: g.Sprite;
	private messageRoot: g.E;
	private messageSprites: { [id in BanMessageId]: g.Sprite };
	private messageId: BanMessageId;
	private messageElapsedMs: number;
	private tapCatcher: g.E;
	private targets: BanTarget[];
	private pressedTargets: { [pointerId: number]: BanTarget | null };

	get active(): boolean {
		return this._active;
	}

	constructor(param: BanModeEParameterObject) {
		// 部屋主だけが持つ表示なので、必ずローカルエンティティとする。
		param.local = true;

		super(param);

		this._active = false;
		this.onChange = new g.Trigger<boolean>();
		this.targets = [];
		this.pressedTargets = {};

		const scene = this.scene;

		//
		// サイレン。
		//
		// ON と OFF の画像は同じ大きさなので、重ねて出し分ける。
		//

		const sirenOnImageAsset = param.sirenOnImageAsset;

		const siren = new g.E({
			scene,
			local: true,
			x: BanModeE.SirenCenterX - Math.round(sirenOnImageAsset.width / 2),
			y: BanModeE.SirenCenterY - Math.round(sirenOnImageAsset.height / 2),
			width: sirenOnImageAsset.width,
			height: sirenOnImageAsset.height,
			touchable: true,
		});

		this.sirenOff = new g.Sprite({
			scene,
			local: true,
			src: param.sirenOffImageAsset,
		});
		siren.append(this.sirenOff);

		this.sirenOn = new g.Sprite({
			scene,
			local: true,
			src: sirenOnImageAsset,
			hidden: true,
		});
		siren.append(this.sirenOn);

		// BAN モード中はタップの受け皿が覆うので、ここに届くのは入る時だけ。
		BanModeE.onTap(siren, () => this.setActive(true));

		//
		// 説明ラベル。
		//
		// サイレンの右は残り投数表示で埋まっているので、ヘッダーの直下に出す。
		// 文言ごとの画像を重ねて出し分け、表示時間とフェードは messageRoot の
		// 透明度で表す。
		//

		this.messageRoot = new g.E({
			scene,
			local: true,
			hidden: true,
		});

		this.messageId = "prompt";
		this.messageElapsedMs = 0;
		this.messageSprites = {} as { [id in BanMessageId]: g.Sprite };
		banMessageIds.forEach((id) => {
			const imageAsset = param.messageImageAssets[id];
			const sprite = new g.Sprite({
				scene,
				local: true,
				src: imageAsset,
				x: Math.max(
					BanModeE.ScreenMargin,
					BanModeE.MessageRight - imageAsset.width,
				),
				y: BanModeE.MessageY,
				hidden: id !== this.messageId,
				opacity: 0.8,
			});
			this.messageSprites[id] = sprite;
			this.messageRoot.append(sprite);
		});

		this.append(siren);
		this.append(this.messageRoot);

		//
		// タップの受け皿。
		//
		// BAN モード中は画面全体を覆ってすべてのタップを受け取り、サイレンと
		// BAN 対象はここで判定する。それ以外のタップは BAN モードの解除だけに使い、
		// 投石やココなどゲームの操作には渡さない。
		//
		// ゲームの UI は状態ごとに後から追加されて上に積まれるので、このエンティティ
		// の子にはせず、BAN モードに入るたびにシーンの最前面へ置き直す。
		//

		this.tapCatcher = new g.E({
			scene,
			local: true,
			width: g.game.width,
			height: g.game.height,
			touchable: true,
			hidden: true,
		});
		this.tapCatcher.onPointDown.add(this.handleCatcherPointDown, this);
		this.tapCatcher.onPointUp.add(this.handleCatcherPointUp, this);

		this.onUpdate.add(this.handleUpdate, this);
	}

	/**
	 * 説明ラベルの文言を変える。
	 *
	 * 選択を促す文言(prompt)は 3 秒後に 1 秒かけて薄くなる。それ以外の文言は
	 * 3 秒後に 1 秒かけて消え、選択を促す文言に戻る。同じ文言でも時間は測り直す。
	 *
	 * @param id 文言の種類。
	 */
	showMessage(id: BanMessageId): void {
		if (this.destroyed()) {
			return;
		}

		// 実行基盤が知らない理由を返すこともある。
		const nextId: BanMessageId = this.messageSprites[id] ? id : "Unknown";

		this.messageSprites[this.messageId].hide();
		this.messageSprites[nextId].show();
		this.messageId = nextId;
		this.messageElapsedMs = 0;
		this.setMessageOpacity(1);
	}

	/**
	 * BAN 対象を登録する。
	 *
	 * @param target 対象。
	 */
	addTarget(target: BanTarget): void {
		this.targets.push(target);
	}

	/**
	 * BAN 対象の登録を解除する。
	 *
	 * @param target 対象。
	 */
	removeTarget(target: BanTarget): void {
		this.targets = this.targets.filter((t) => t !== target);
		Object.keys(this.pressedTargets).forEach((pointerId) => {
			if (this.pressedTargets[Number(pointerId)] === target) {
				this.pressedTargets[Number(pointerId)] = null;
			}
		});
	}

	destroy(): void {
		if (this.destroyed()) {
			return;
		}
		this.onChange.destroy();
		this.tapCatcher.destroy();
		super.destroy();
	}

	/**
	 * ボタンの上で指を離した時だけハンドラを呼ぶ。
	 */
	static onTap(e: g.E, handler: () => void): void {
		e.onPointUp.add((ev) => {
			const x = ev.point.x + ev.startDelta.x;
			const y = ev.point.y + ev.startDelta.y;
			if (0 <= x && x <= e.width && 0 <= y && y <= e.height) {
				handler();
			}
		});
	}

	private setActive(active: boolean): void {
		if (this._active === active) {
			return;
		}

		this._active = active;

		if (active) {
			// 前回の拒否理由を残さない。
			this.showMessage("prompt");
			this.sirenOn.show();
			this.sirenOff.hide();
			this.messageRoot.show();

			// 後から積まれた UI より上に置き直す。
			if (this.tapCatcher.parent) {
				this.tapCatcher.remove();
			}
			this.scene.append(this.tapCatcher);
			this.tapCatcher.show();
		} else {
			this.releasePressedTargets();
			this.sirenOn.hide();
			this.sirenOff.show();
			this.messageRoot.hide();
			this.tapCatcher.hide();
		}

		this.onChange.fire(active);
	}

	private handleUpdate(): void {
		if (!this._active) {
			return;
		}

		const hold = BanModeE.MessageHoldMs;
		const fade = BanModeE.MessageFadeMs;

		this.messageElapsedMs += 1000 / g.game.fps;

		const elapsed = this.messageElapsedMs;
		const p = Math.min(1, Math.max(0, (elapsed - hold) / fade));

		if (this.messageId === "prompt") {
			this.setMessageOpacity(1 - (1 - BanModeE.PromptDimmedOpacity) * p);
		} else if (elapsed < hold + fade) {
			this.setMessageOpacity(1 - p);
		} else {
			this.showMessage("prompt");
		}
	}

	private setMessageOpacity(opacity: number): void {
		if (this.messageRoot.opacity === opacity) {
			return;
		}
		this.messageRoot.opacity = opacity;
		this.messageRoot.modified();
	}

	private handleCatcherPointDown(ev: g.PointDownEvent): void {
		const target = this.findTarget(ev.point);
		this.pressedTargets[ev.pointerId] = target;
		if (target) {
			target.setPressed(true);
		}
	}

	private handleCatcherPointUp(ev: g.PointUpEvent): void {
		const point = {
			x: ev.point.x + ev.startDelta.x,
			y: ev.point.y + ev.startDelta.y,
		};
		const pressed = this.pressedTargets[ev.pointerId];
		delete this.pressedTargets[ev.pointerId];

		if (pressed) {
			pressed.setPressed(false);
			// 押したまま外へずらしたら取りやめとみなす。
			if (pressed.contains(point)) {
				pressed.tap();
			}
			return;
		}

		// 対象の外で押し始めたタップは BAN モードの解除である。サイレンも含む。
		// ただし対象の上で離した時は、パネルを狙ったものとみなして解除しない。
		if (!this.findTarget(point)) {
			this.setActive(false);
		}
	}

	private findTarget(point: g.CommonOffset): BanTarget | null {
		for (let i = 0; i < this.targets.length; i++) {
			if (this.targets[i].contains(point)) {
				return this.targets[i];
			}
		}
		return null;
	}

	private releasePressedTargets(): void {
		Object.keys(this.pressedTargets).forEach((pointerId) => {
			const target = this.pressedTargets[Number(pointerId)];
			if (target) {
				target.setPressed(false);
			}
		});
		this.pressedTargets = {};
	}
}
