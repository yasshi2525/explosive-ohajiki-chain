import type { BanModeE, BanTarget } from "./BanModeE";

export interface BanMenuEParameterObject extends g.EParameterObject {
	/** メニューを載せるパネルの幅。タップ領域と BAN ボタンの右寄せに用いる。 */
	panelWidth: number;

	/** メニューを載せるパネルの高さ。タップ領域に用いる。 */
	panelHeight: number;

	/** BAN ボタンの画像。 */
	buttonImageAsset: g.ImageAsset;

	/** 押されている間の BAN ボタンの画像。 */
	buttonPressedImageAsset: g.ImageAsset;

	/** パネルのプレイヤーID。 */
	playerId: string;

	/** 表示を連動させる BAN モード。 */
	banMode: BanModeE;

	/**
	 * パネルがタップされた時に呼ばれる。
	 *
	 * null の時は BAN ボタンを出さず、タップしても何もしない。自分のパネルのように
	 * BAN できないが、タップで BAN モードを解除させたくないパネルに用いる。
	 */
	onBan: ((playerId: string) => void) | null;
}

/**
 * プレイヤーパネルに載せる BAN メニュー。
 *
 * BAN モードの間だけ現れ、パネルの右よりに BAN ボタンを出す。画面の小さい
 * スマホでも押しやすいよう、BAN ボタンではなくパネル全体をタップ領域とする。
 *
 * タップは BanModeE のタップの受け皿が受け取って、contains() で判定する。
 * このエンティティ自身は touchable ではない。
 *
 * 部屋主のインスタンスにしか存在しないので、このエンティティとその子は
 * すべてローカルである。
 */
export class BanMenuE extends g.E implements BanTarget {
	/** パネル右端との間隔。 */
	private static readonly MarginRight: number = 8;

	/** BAN ボタンの縦の中心。パネルのおはじきの中心に揃える。 */
	private static readonly ButtonCenterY: number = 88;

	private playerId: string;
	private banMode: BanModeE;
	private onBan: ((playerId: string) => void) | null;
	private button: g.Sprite | null;
	private buttonPressed: g.Sprite | null;

	constructor(param: BanMenuEParameterObject) {
		// 部屋主だけが持つ表示なので、必ずローカルエンティティとする。
		param.local = true;
		param.width = param.panelWidth;
		param.height = param.panelHeight;
		param.hidden = !param.banMode.active;

		super(param);

		this.playerId = param.playerId;
		this.banMode = param.banMode;
		this.onBan = param.onBan;
		this.button = null;
		this.buttonPressed = null;

		if (this.onBan) {
			const scene = this.scene;

			//
			// BAN ボタン。パネル内の右端に置く。
			//
			// パネルは画面右端に接していて外に出す余地がなく、また出入りの
			// アニメーション中はパネルごと横に流れるため、パネルの中に置く。
			// 通常と押下の画像は同じ大きさなので、重ねて出し分ける。
			//

			const buttonImageAsset = param.buttonImageAsset;
			const x =
				param.panelWidth - buttonImageAsset.width - BanMenuE.MarginRight;
			const y =
				BanMenuE.ButtonCenterY - Math.round(buttonImageAsset.height / 2);

			this.button = new g.Sprite({
				scene,
				local: true,
				src: buttonImageAsset,
				x,
				y,
			});

			this.buttonPressed = new g.Sprite({
				scene,
				local: true,
				src: param.buttonPressedImageAsset,
				x,
				y,
				hidden: true,
			});

			this.append(this.button);
			this.append(this.buttonPressed);
		}

		this.banMode.onChange.add(this.handleBanModeChange, this);
		this.banMode.addTarget(this);
	}

	contains(point: g.CommonOffset): boolean {
		if (this.destroyed() || !this.visible()) {
			return false;
		}
		const local = this.globalToLocal(point);
		return (
			0 <= local.x &&
			local.x <= this.width &&
			0 <= local.y &&
			local.y <= this.height
		);
	}

	setPressed(pressed: boolean): void {
		if (!this.button || !this.buttonPressed) {
			return;
		}
		if (pressed) {
			this.button.hide();
			this.buttonPressed.show();
		} else {
			this.button.show();
			this.buttonPressed.hide();
		}
	}

	tap(): void {
		// 追放の成立を待たずに進行から外してはならない。
		// 進行から外すのは onPlayerBanned に任せる。
		if (this.onBan) {
			this.onBan(this.playerId);
		}
	}

	destroy(): void {
		if (this.destroyed()) {
			return;
		}
		if (!this.banMode.destroyed()) {
			this.banMode.onChange.remove(this.handleBanModeChange, this);
			this.banMode.removeTarget(this);
		}
		super.destroy();
	}

	private handleBanModeChange(active: boolean): void {
		if (active) {
			this.show();
		} else {
			this.setPressed(false);
			this.hide();
		}
	}
}
