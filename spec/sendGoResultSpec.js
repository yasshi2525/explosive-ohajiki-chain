// NOTE: スクリプトアセットとして実行される環境をエミュレーションするためにglobal.gを生成する
global.g = require("@akashic/akashic-engine");

global.g.game = {
	isActiveInstance: () => false,
	external: {},
};

const { sendGoResult } = require("../script/utils");
const { ScoreReporter } = require("../script/ScoreReporter");

const silentLogger = {
	log: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined,
};

/**
 * プレイ記録を持つプレイヤーを作る。
 *
 * @param id プレイヤーID。screenName を兼ねる。
 * @param record nice / combo / narrowEscape のノルマ。
 */
function createPlayer(id, record) {
	return {
		id,
		name: id,
		screenName: id,
		playRecord: {
			nice: record.nice || 0,
			combo: record.combo || 0,
			narrowEscape:
				record.narrowEscape != null
					? { norma: record.narrowEscape, worldId: 1, areaId: 2 }
					: null,
		},
	};
}

/**
 * "go-result" アクションを捕まえる System の代用品。
 */
function createSystem(players) {
	const sent = [];

	const context = {
		difficulty: "normal",
		worldId: 2,
		areaId: 3,
		scene: { send: (action) => sent.push(action) },
		playerManager: { getAllPlayers: () => players },
		scoreReporter: new ScoreReporter(silentLogger),
		isGameClear: () => false,
	};

	return { context, sent };
}

describe("utils.sendGoResult", () => {
	describe("受賞タイトルの重複回避", () => {
		it("ナイス・コンボ受賞者以外が居れば、その人を九死に一生賞にする", () => {
			// a がナイスとコンボの両方で首位。九死に一生は a と b が同ノルマ。
			const a = createPlayer("a", {
				nice: 5,
				combo: 10,
				narrowEscape: 8,
			});
			const b = createPlayer("b", { nice: 1, combo: 2, narrowEscape: 8 });
			const { context, sent } = createSystem([a, b]);

			sendGoResult(context);

			expect(sent[0].niceAward.name).toBe("a");
			expect(sent[0].comboAward.name).toBe("a");
			// a はすでに受賞しているので b に回る。
			expect(sent[0].narrowEscapeAward.name).toBe("b");
		});

		it("ナイス受賞者しか候補が居なければ、その人が九死に一生賞も受け取る", () => {
			const a = createPlayer("a", {
				nice: 5,
				combo: 10,
				narrowEscape: 8,
			});
			const b = createPlayer("b", {
				nice: 0,
				combo: 2,
				narrowEscape: null,
			});
			const { context, sent } = createSystem([a, b]);

			sendGoResult(context);

			expect(sent[0].niceAward.name).toBe("a");
			expect(sent[0].narrowEscapeAward.name).toBe("a");
		});

		it("コンボ受賞者は九死に一生賞の候補から外れる", () => {
			// ナイス受賞者は居ない。コンボ首位は a 。
			const a = createPlayer("a", { combo: 10, narrowEscape: 8 });
			const b = createPlayer("b", { combo: 2, narrowEscape: 8 });
			const { context, sent } = createSystem([a, b]);

			sendGoResult(context);

			expect(sent[0].niceAward).toBeNull();
			expect(sent[0].comboAward.name).toBe("a");
			expect(sent[0].narrowEscapeAward.name).toBe("b");
		});

		it("九死に一生賞の候補が居なければ null", () => {
			const a = createPlayer("a", {
				nice: 1,
				combo: 3,
				narrowEscape: null,
			});
			const { context, sent } = createSystem([a]);

			sendGoResult(context);

			expect(sent[0].narrowEscapeAward).toBeNull();
		});

		it("ノルマが最大の候補だけが九死に一生賞の対象になる", () => {
			const a = createPlayer("a", { nice: 9, combo: 9, narrowEscape: 4 });
			const b = createPlayer("b", { narrowEscape: 4 });
			const c = createPlayer("c", { narrowEscape: 7 });
			const { context, sent } = createSystem([a, b, c]);

			sendGoResult(context);

			expect(sent[0].narrowEscapeAward.name).toBe("c");
		});
	});
});
