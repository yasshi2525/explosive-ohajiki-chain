import type * as tl from "@akashic-extension/akashic-timeline";
import type { PlayerPanelE } from "./PlayerPanelE";

export interface PlayerPanelTrayEParameterObject extends g.EParameterObject {
	playerPanels?: PlayerPanelE[];
}

export class PlayerPanelTrayE extends g.E {

	playerPanels: PlayerPanelE[];

	constructor(param: PlayerPanelTrayEParameterObject) {
		super(param);

		this.playerPanels = [];

		if (param.playerPanels) {
			param.playerPanels.forEach(panel => this.addPanel(panel));
		}
	}

	/**
	 * パネルの追加。
	 *
	 * アニメーションしない。
	 *
	 * @param panel パネル。
	 */
	addPanel(panel: PlayerPanelE): void {
		panel.x = 0;
		panel.y = this.playerPanels.length * 140;
		panel.modified();
		this.append(panel);
		this.playerPanels.push(panel);
	}

	/**
	 * パネルの即時削除。
	 *
	 * 追放のように、アニメーションの完了を待てない・他のタイムラインと
	 * 競合しうる変更に使う。tween 版は開始時の y を捕まえて動かすので、
	 * 別のタイムラインが同じパネルを動かしていると最終位置が壊れる。
	 *
	 * @param index 削除するパネルの位置。
	 */
	removeAtImmediately(index: number): void {
		if (index < 0 || index >= this.playerPanels.length) {
			return;
		}

		const panel = this.playerPanels.splice(index, 1)[0];
		panel.destroy();
		this.layout();
	}

	/**
	 * 全パネルを所定の位置へ並べ直す。
	 */
	layout(): void {
		for (let i = 0; i < this.playerPanels.length; i++) {
			const panel = this.playerPanels[i];
			panel.x = 0;
			panel.y = i * 140;
			panel.modified();
		}
	}

	removeTop(tween: tl.Tween): tl.Tween {
		return this.removeAt(0, tween);
	}

	/**
	 * パネルの削除。
	 *
	 * 削除したパネルは右へ流れて消え、それより後ろのパネルが繰り上がる。
	 *
	 * @param index 削除するパネルの位置。
	 * @param tween 演出のアニメーションが構築される tween 。
	 */
	removeAt(index: number, tween: tl.Tween): tl.Tween {
		if (index < 0 || index >= this.playerPanels.length) {
			return tween;
		}

		const panel = this.playerPanels[index];
		this.playerPanels.splice(index, 1);

		const startX = panel.x;
		const offsetX = g.game.width - this.x;

		tween
			.every(
				(e, p) => {
					panel.x = startX + offsetX * p;
					panel.modified();
				},
				250
			)
			.call(() => panel.destroy());

		// 繰り上がる位置は動き始める時点の並びから求める。演出を組んでから
		// 動き始めるまでに、追放で他のパネルが即時削除され並びが変わることがある。
		for (let i = index; i < this.playerPanels.length; i++) {

			const panel = this.playerPanels[i];
			let startY: number | null = null;
			tween
				.every(
					(e, p) => {
						const panelIndex = this.playerPanels.indexOf(panel);
						if (panel.destroyed() || panelIndex < 0) {
							return;
						}
						if (startY === null) {
							startY = panel.y;
						}
						panel.y = startY + (panelIndex * 140 - startY) * p;
						panel.modified();
					},
					250
				);
		}

		return tween;
	}

	pushPanel(panel: PlayerPanelE, tween: tl.Tween): tl.Tween {
		panel.x = g.game.width - this.x;
		panel.modified();
		this.append(panel);

		this.playerPanels.push(panel);

		const startX = panel.x;
		const offsetX = -startX;

		// 縦位置は現れる時点の並びから求める。演出を組んでから現れるまでに、
		// 追放で他のパネルが即時削除され並びが変わることがある。
		tween
			.call(() => {
				const panelIndex = this.playerPanels.indexOf(panel);
				if (panel.destroyed() || panelIndex < 0) {
					return;
				}
				panel.y = panelIndex * 140;
				panel.modified();
			})
			.every(
				(e, p) => {
					if (panel.destroyed()) {
						return;
					}
					panel.x = startX + offsetX * p;
					panel.modified();
				},
				250
			);

		return tween;
	}
}
