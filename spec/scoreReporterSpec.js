// NOTE: スクリプトアセットとして実行される環境をエミュレーションするためにglobal.gを生成する
global.g = require("@akashic/akashic-engine");

const { ScoreReporter } = require("../script/ScoreReporter");

const silentLogger = {
	log: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined
};

/**
 * 実行基盤の代わりに報告を受け取る。
 *
 * ライブラリ本体(@multi-indiegame/akashic-scoreboard)を通すので、
 * キー名や値の検証も実際と同じものが働く。
 */
function installExternal() {
	const playRecord = {};
	const playerRecords = {};

	global.g.game = {
		isActiveInstance: () => true,
		external: {
			scoreboard: {
				setPlayRecord: (patch) => Object.assign(playRecord, patch),
				setPlayerRecord: (playerId, patch) => {
					playerRecords[playerId] = Object.assign(playerRecords[playerId] || {}, patch);
				}
			}
		}
	};

	return { playRecord, playerRecords };
}

function createPlayer(id, combo) {
	return { id, playRecord: { combo: combo || 0, nice: 0, narrowEscape: null } };
}

/**
 * 参加者の集合を差し替えられる System の代用品。
 */
function createSystem(players, difficulty) {
	const context = {
		difficulty: difficulty || "normal",
		worldId: 0,
		playerManager: {
			players: players,
			getAllPlayers: () => context.playerManager.players
		}
	};
	return context;
}

describe("ScoreReporter", () => {
	let external;

	beforeEach(() => {
		external = installExternal();
	});

	describe("ゲームオーバー時", () => {
		it("全員の最大コンボ数と九死に一生賞を報告し、クリア記録は報告しない", () => {
			const a = createPlayer("a", 5);
			const b = createPlayer("b", 12);
			const context = createSystem([a, b]);
			const reporter = new ScoreReporter(silentLogger);

			reporter.report(context, false, b);

			expect(external.playerRecords).toEqual({
				a: { "max-combo-normal": 5 },
				b: { "max-combo-normal": 12, "narrow-escape-award-normal": true }
			});
			expect(external.playRecord).toEqual({});
		});

		it("九死に一生賞の受賞者が居なければ報告しない", () => {
			const a = createPlayer("a", 3);
			const reporter = new ScoreReporter(silentLogger);

			reporter.report(createSystem([a]), false, null);

			expect(external.playerRecords).toEqual({ a: { "max-combo-normal": 3 } });
		});
	});

	describe("全ステージクリア時", () => {
		it("2-1開始時点から残り続けたプレイヤーにだけクリア記録を報告する", () => {
			const a = createPlayer("a");
			const b = createPlayer("b");
			const context = createSystem([a, b]);
			const reporter = new ScoreReporter(silentLogger);

			// 2-1 開始。この時点の参加者は a, b 。
			context.worldId = 1;
			reporter.onLevelStart(context);

			// c が途中参加し、b が追放された。
			const c = createPlayer("c");
			context.playerManager.players = [a, c];
			reporter.onPlayerBanned("b");
			reporter.onPlayerCountChanged(context);

			reporter.report(context, true, null);

			expect(external.playRecord).toEqual({ "game-clear-normal": true });
			expect(external.playerRecords.a["game-clear-normal"]).toBe(true);
			expect(external.playerRecords.c["game-clear-normal"]).toBeUndefined();
			expect(external.playerRecords.b).toBeUndefined();
		});

		it("2-1に到達していなければプレイ自体にだけクリア記録を報告する", () => {
			const a = createPlayer("a");
			const context = createSystem([a]);
			const reporter = new ScoreReporter(silentLogger);

			reporter.report(context, true, null);

			expect(external.playRecord).toEqual({ "game-clear-normal": true });
			expect(external.playerRecords.a["game-clear-normal"]).toBeUndefined();
		});

		it("難易度ごとにキーが分かれる", () => {
			const a = createPlayer("a");
			const context = createSystem([a], "crazy");
			const reporter = new ScoreReporter(silentLogger);

			context.worldId = 1;
			reporter.onLevelStart(context);
			reporter.report(context, true, null);

			expect(external.playRecord).toEqual({ "game-clear-crazy": true });
			expect(external.playerRecords.a).toEqual({
				"max-combo-crazy": 0,
				"game-clear-crazy": true
			});
		});
	});

	describe("単独プレイ(solo)", () => {
		function reportWithStrikes(strikes) {
			const a = createPlayer("a");
			const b = createPlayer("b");
			const context = createSystem([a, b]);
			const reporter = new ScoreReporter(silentLogger);

			context.worldId = 1;
			reporter.onLevelStart(context);

			Object.keys(strikes).forEach((id) => {
				for (let i = 0; i < strikes[id]; i++) {
					reporter.onStrike(id);
				}
			});

			reporter.report(context, true, null);
		}

		it("投球の92.5%を占めるプレイヤーが居れば報告する", () => {
			reportWithStrikes({ a: 37, b: 3 }); // 37/40 = 0.925

			expect(external.playRecord["game-clear-normal-solo"]).toBe(true);
			expect(external.playerRecords.a["game-clear-normal-solo"]).toBe(true);
			expect(external.playerRecords.b["game-clear-normal-solo"]).toBeUndefined();
		});

		it("92.5%に満たなければ報告しない", () => {
			reportWithStrikes({ a: 36, b: 4 }); // 36/40 = 0.9

			expect(external.playRecord["game-clear-normal-solo"]).toBeUndefined();
			expect(external.playerRecords.a["game-clear-normal-solo"]).toBeUndefined();
		});

		it("投球が無ければ報告しない", () => {
			reportWithStrikes({});

			expect(external.playRecord["game-clear-normal-solo"]).toBeUndefined();
		});

		it("ゲームオーバー時は報告しない", () => {
			const a = createPlayer("a");
			const context = createSystem([a]);
			const reporter = new ScoreReporter(silentLogger);

			for (let i = 0; i < 10; i++) {
				reporter.onStrike("a");
			}
			reporter.report(context, false, null);

			expect(external.playRecord).toEqual({});
		});
	});

	describe("大人数プレイ(party)", () => {
		function createPlayers(n) {
			const players = [];
			for (let i = 0; i < n; i++) {
				players.push(createPlayer(`p${i}`));
			}
			return players;
		}

		it("ステージ2以降つねに5人以上なら報告する", () => {
			const players = createPlayers(5);
			const context = createSystem(players);
			const reporter = new ScoreReporter(silentLogger);

			context.worldId = 1;
			reporter.onLevelStart(context);

			// 6人に増えた。最小人数は5のまま。
			context.playerManager.players = players.concat([createPlayer("p5")]);
			reporter.onPlayerCountChanged(context);

			reporter.report(context, true, null);

			expect(external.playRecord["game-clear-normal-party"]).toBe(true);
			expect(external.playerRecords.p0["game-clear-normal-party"]).toBe(true);
			// 2-1 開始後に参加した相手は対象外。
			expect(external.playerRecords.p5["game-clear-normal-party"]).toBeUndefined();
		});

		it("ステージ2以降に一度でも5人を下回れば報告しない", () => {
			const players = createPlayers(5);
			const context = createSystem(players);
			const reporter = new ScoreReporter(silentLogger);

			context.worldId = 1;
			reporter.onLevelStart(context);

			// 追放で4人に減り、その後また5人に戻った。
			context.playerManager.players = players.slice(0, 4);
			reporter.onPlayerBanned("p4");
			reporter.onPlayerCountChanged(context);

			context.playerManager.players = players.slice(0, 4).concat([createPlayer("p5")]);
			reporter.onPlayerCountChanged(context);

			reporter.report(context, true, null);

			expect(external.playRecord["game-clear-normal-party"]).toBeUndefined();
			expect(external.playRecord["game-clear-normal"]).toBe(true);
		});

		it("ステージ1で5人を下回っても、ステージ2以降が5人以上なら報告する", () => {
			const players = createPlayers(5);
			const context = createSystem(players.slice(0, 2));
			const reporter = new ScoreReporter(silentLogger);

			// ステージ1の人数は数えない。
			reporter.onPlayerCountChanged(context);

			context.playerManager.players = players;
			context.worldId = 1;
			reporter.onLevelStart(context);

			reporter.report(context, true, null);

			expect(external.playRecord["game-clear-normal-party"]).toBe(true);
		});
	});

	describe("2-1開始時点の記録", () => {
		it("ステージ3に進んでも2-1時点の参加者を保つ", () => {
			const a = createPlayer("a");
			const context = createSystem([a]);
			const reporter = new ScoreReporter(silentLogger);

			context.worldId = 1;
			reporter.onLevelStart(context);

			const b = createPlayer("b");
			context.playerManager.players = [a, b];
			context.worldId = 2;
			reporter.onLevelStart(context);

			reporter.report(context, true, null);

			expect(external.playerRecords.a["game-clear-normal"]).toBe(true);
			expect(external.playerRecords.b["game-clear-normal"]).toBeUndefined();
		});
	});

	describe("パッシブインスタンス", () => {
		it("報告しない", () => {
			global.g.game.isActiveInstance = () => false;

			const a = createPlayer("a", 7);
			const reporter = new ScoreReporter(silentLogger);

			reporter.report(createSystem([a]), true, a);

			expect(external.playRecord).toEqual({});
			expect(external.playerRecords).toEqual({});
		});
	});
});
