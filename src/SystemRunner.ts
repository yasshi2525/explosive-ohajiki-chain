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

		this.stateManager.command(command);
	}

	onPointDown(ev: g.PointDownEvent): void {
		this.stateManager.pointDown(ev);
	}

	onPointMove(ev: g.PointMoveEvent): void {
		this.stateManager.pointMove(ev);
	}
}
