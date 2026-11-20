import { isBanCommand } from "@multi-indiegame/akashic-player-ban-coe";
import { OhajikiStateManager, MatchingState } from "./state";
import type { System } from "./System";
import type { OhajikiCommand } from "./coeMessages";

/**
 * システムランナー。
 *
 * System を FSM によって操作・実行する。
 */
export class SystemRunner {
	private system: System;
	private stateManager!: OhajikiStateManager;

	/** 真の時、ゲームが始まっている (start-introduction を受信済み)。 */
	private gameStarted: boolean = false;

	constructor(system: System) {
		this.system = system;
	}

	start(): void {
		const scene = this.system.scene;

		scene.onUpdate.add(() => this.update());
		scene.onPointDownCapture.add((ev) => this.onPointDown(ev));
		scene.onPointMoveCapture.add((ev) => this.onPointMove(ev));
		scene.onCommandReceive.add((command) => this.onCommand(command));

		this.system.start();

		const state = new MatchingState();

		this.stateManager = new OhajikiStateManager(
			this.system,
			state,
			this.system.logger,
		);
	}

	update(): void {
		this.system.update();
		this.stateManager.update();
	}

	onCommand(command: OhajikiCommand): void {
		// 追放通知はアダプタが受け取って onPlayerBanned を発火させる。
		// ステートへ渡すと TurnState が timeline を巻いてしまうので弾く。
		if (isBanCommand(command)) {
			return;
		}

		// 途中参加の設定はタイトル画面でのみ受け付ける。
		// カウントダウン終盤の切り替えが遅れて届くと、開始演出中のステートが
		// timeline を巻いてしまうため、開始後はステートへ渡さない。
		if (command.type === "start-introduction") {
			this.gameStarted = true;
		} else if (command.type === "set-late-join" && this.gameStarted) {
			return;
		}

		this.stateManager.command(command);
	}

	onPointDown(ev: g.PointDownEvent): void {
		this.stateManager.pointDown(ev);
	}

	onPointMove(ev: g.PointMoveEvent): void {
		this.stateManager.pointMove(ev);
	}
}
