import type * as tl from "@akashic-extension/akashic-timeline";
import type { Vector2Like } from "../math";
import * as utils from "../utils";

export interface PlayerPanelEParameterObject extends g.EParameterObject {
	name: string;
	font: g.Font;
	highlit?: boolean;
	normalImageAsset: g.ImageAsset;
	blinkImageAsset: g.ImageAsset;
	hilightImageAsset: g.ImageAsset;
	playerImageAsset: g.ImageAsset;
	ohajikiE: g.E;
}

export class PlayerPanelE extends g.E {
	name: string;
	font: g.Font;
	ohajikiE: g.E | null;

	get highlit() {
		return this._highlit;
	}
	set highlit(v: boolean) {
		this._highlit = v;
		this.blendCoef = this._highlit ? 1 : 0;
	}

	blink: boolean;

	private _highlit: boolean;
	private normalSurface: g.Surface;
	private blinkSurface: g.Surface;
	private hilightSurface: g.Surface;
	private playerImageSurface: g.Surface;
	private nameLabel: g.Label;
	private blendCoef: number;
	private blinkCntr: number;

	constructor(param: PlayerPanelEParameterObject) {
		super(param);

		this.name = param.name;
		this.font = param.font;
		this._highlit = false;
		this.blendCoef = 0;
		this.highlit = !!param.highlit;
		this.ohajikiE = param.ohajikiE;
		this.blink = false;
		this.blinkCntr = 0;
		this.normalSurface = param.normalImageAsset.asSurface();
		this.blinkSurface = param.blinkImageAsset.asSurface();
		this.hilightSurface = param.hilightImageAsset.asSurface();
		this.playerImageSurface = param.playerImageAsset.asSurface();

		const fontSize = 32;
		const text = utils.limitTextByWidth(
			this.name,
			Math.round(this.normalSurface.width - 16),
			this.font,
			fontSize,
			"..."
		);

		this.nameLabel = new g.Label({
			scene: param.scene,
			font: this.font,
			fontSize,
			text
		});

		this.onUpdate.add(this.handleUpdate, this);
	}

	renderSelf(renderer: g.Renderer, camera?: g.Camera): boolean {

		//
		// プレートの描画。
		// パネル画像が透過しているので、切り替えのクロスフェードは常に両方描画する。
		//

		renderer.save();

		renderer.opacity(1 - this.blendCoef);

		renderer.drawImage(
			this.normalSurface,
			0, 0,
			this.normalSurface.width, this.normalSurface.height,
			0, 0
		);

		renderer.restore();

		renderer.save();

		renderer.opacity(this.blendCoef);

		renderer.drawImage(
			this.hilightSurface,
			0, 0,
			this.hilightSurface.width, this.hilightSurface.height,
			0, 0
		);

		renderer.restore();

		if (this.blink) {
			renderer.save();

			const s = this.blinkCntr / (g.game.fps * 2);
			const t = (Math.sin(s * Math.PI * 2) + 1) / 2;

			renderer.opacity(t);

			renderer.drawImage(
				this.blinkSurface,
				0, 0,
				this.blinkSurface.width, this.blinkSurface.height,
				0, 0
			);

			renderer.restore();
		}

		//
		// 名前の描画。
		//

		renderer.save();

		renderer.translate(
			Math.round((this.normalSurface.width - this.nameLabel.width) / 2),
			10
		);

		this.nameLabel.render(renderer, camera);

		renderer.restore();


		//
		// おはじき or "PLAYER" 描画。
		//

		renderer.save();

		if (this.ohajikiE) {
			const ohajikiPosition = this.getOhajikiPosition();
			renderer.translate(ohajikiPosition.x, ohajikiPosition.y);
			this.ohajikiE.render(renderer, camera);
		} else {
			renderer.translate(29, 70);
			renderer.drawImage(
				this.playerImageSurface,
				0, 0,
				this.playerImageSurface.width, this.playerImageSurface.height,
				0, 0
			);
		}

		renderer.restore();

		return true;
	}

	getOhajikiPosition(): Vector2Like {
		const size = this.ohajikiE ?
			{ width: this.ohajikiE.width, height: this.ohajikiE.height } :
			{ width: 0, height: 0 };
		return {
			x: Math.round((this.normalSurface.width - size.width) / 2),
			y: Math.round(88 - size.height / 2)
		};
	}

	switchHighlight(highlit: boolean, tween: tl.Tween): tl.Tween {
		this._highlit = highlit; // `_` 付きに代入していることに留意。

		tween.every(
			(e, p) => {
				// 演出の途中で追放により取り除かれることがある。
				if (this.destroyed()) {
					return;
				}
				const t = highlit ? p : 1 - p;
				this.blendCoef = t;
				this.modified();
			},
			250
		);

		return tween;
	}

	private handleUpdate(): void {
		if (this.blink) {
			this.blinkCntr++;
			this.modified();
		}
	}
}
