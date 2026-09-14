import * as coe from "@akashic-extension/coe";
import type {
	OhajikiActionData,
	OhajikiCommand,
	KokoCommand,
} from "./coeMessages";
import type { Logger } from "./Logger";

class LoadMonitor {
	private cursor: number;
	private loadValues: number[];

	constructor(monitorFrames: number) {
		this.cursor = 0;
		this.loadValues = [];
		for (let i = 0; i < monitorFrames; i++) {
			this.loadValues.push(0);
		}
	}

	/**
	 * 負荷を記録する。
	 *
	 * @param v 負荷。
	 */
	addLoad(v: number): void {
		this.loadValues[this.cursor] = v;
		this.cursor++;
		this.cursor %= this.loadValues.length;
	}

	/**
	 * 過去 monitorFrames - 1 フレームの負荷の総計を得る。
	 */
	getTotalLoad(): number {
		let total = 0;

		for (let i = 0; i < this.loadValues.length; i++) {
			if (i !== this.cursor) {
				total += this.loadValues[i];
			}
		}

		return total;
	}
}

export class OhajikiController extends coe.COEController<
	OhajikiCommand,
	OhajikiActionData
> {
	private kokoCommandQueue: KokoCommand[];
	private maxKokoPerSec: number;
	private loadMonitor: LoadMonitor;
	private logger: Logger;

	constructor(logger: Logger, maxKokoPerSec: number) {
		super();

		this.kokoCommandQueue = [];
		this.maxKokoPerSec = maxKokoPerSec;
		this.loadMonitor = new LoadMonitor(g.game.fps * 1);
		this.logger = logger;

		this.onUpdate.add(this.handleUpdate, this);
		this.onActionReceive.add(this.onActionReceived, this);
	}

	destroy(): void {
		this.onActionReceive.remove(this.onActionReceived, this);
		this.onUpdate.remove(this.handleUpdate, this);
		super.destroy();
	}

	/**
	 * バッファされたコココマンドを流量制限しつつブロードキャストする。
	 */
	private handleUpdate(): void {
		// 送信なし。
		if (this.kokoCommandQueue.length === 0) {
			this.loadMonitor.addLoad(0);
			return;
		}

		// 無制限。
		if (this.maxKokoPerSec == null) {
			this.kokoCommandQueue.forEach((command) => this.broadcast(command));
			this.loadMonitor.addLoad(this.kokoCommandQueue.length);
			this.kokoCommandQueue = [];
			return;
		}

		const totalLoad = this.loadMonitor.getTotalLoad();

		const kokoEmitCount = Math.max(
			0,
			Math.min(
				this.kokoCommandQueue.length,
				this.maxKokoPerSec - totalLoad,
			),
		);

		const drop = this.kokoCommandQueue.length - kokoEmitCount;
		if (drop > 0) {
			this.logger.log("Koko:");
			this.logger.log(`  Q len        =${this.kokoCommandQueue.length}`);
			this.logger.log(`  loadPerSec   =${totalLoad}`);
			this.logger.log(`  maxKokoPerSec=${this.maxKokoPerSec}`);
			this.logger.log(`  emit         =${kokoEmitCount}`);
			this.logger.log(`  drop         =${drop}`);
		}

		for (let i = 0; i < kokoEmitCount; i++) {
			this.broadcast(this.kokoCommandQueue[i]);
		}

		this.kokoCommandQueue = [];
		this.loadMonitor.addLoad(kokoEmitCount);
	}

	private onActionReceived(action: coe.Action<OhajikiActionData>): void {
		if (!action.data) {
			return;
		}

		if (action.data.type === "select-difficulty") {
			this.broadcast({
				type: "select-difficulty",
				difficulty: action.data.difficulty,
			});
		} else if (action.data.type === "apply") {
			this.broadcast({
				type: "add-player",
				player: action.player,
				isHost: action.data.isHost,
				name: action.data.name,
			});
		} else if (action.data.type === "start-introduction") {
			this.broadcast({
				type: "start-introduction",
				difficulty: action.data.difficulty,
			});
		} else if (action.data.type === "start-game") {
			this.broadcast({
				type: "start-game",
			});
		} else if (action.data.type === "strike") {
			this.broadcast({
				type: "strike",
				impulse: action.data.impulse,
				autoStrike: action.data.autoStrike,
			});
		} else if (action.data.type === "game-clear") {
			this.broadcast({
				type: "game-clear",
				serialized: action.data.serialized,
			});
		} else if (action.data.type === "game-over") {
			this.broadcast({
				type: "game-over",
				serialized: action.data.serialized,
			});
		} else if (action.data.type === "level-clear") {
			this.broadcast({
				type: "level-clear",
				serialized: action.data.serialized,
			});
		} else if (action.data.type === "level-clear-multi") {
			this.broadcast({
				type: "level-clear-multi",
				serialized: action.data.serialized,
			});
		} else if (action.data.type === "go-next-level") {
			this.broadcast({
				type: "go-next-level",
				serialized: action.data.serialized,
			});
		} else if (action.data.type === "go-next-turn") {
			this.broadcast({
				type: "go-next-turn",
				serialized: action.data.serialized,
			});
		} else if (action.data.type === "skip-turn") {
			this.broadcast({
				type: "skip-turn",
			});
		} else if (action.data.type === "go-result") {
			this.broadcast({
				type: "go-result",
				difficulty: action.data.difficulty,
				worldId: action.data.worldId,
				areaId: action.data.areaId,
				niceAward: action.data.niceAward,
				comboAward: action.data.comboAward,
				narrowEscapeAward: action.data.narrowEscapeAward,
			});
		} else if (action.data.type === "koko") {
			this.kokoCommandQueue.push({
				type: "koko",
				userId: action.player.id ?? "",
				x: action.data.x,
				y: action.data.y,
			});
		} else if (action.data.type === "nice") {
			this.broadcast({
				type: "nice",
				x: action.data.x,
				y: action.data.y,
			});
		}
	}
}
