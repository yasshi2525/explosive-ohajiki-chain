// NOTE: スクリプトアセットとして実行される環境をエミュレーションするためにglobal.gを生成する
global.g = require("@akashic/akashic-engine");

const { isLateJoinClosed } = require("../script/utils");
const { handleAddPlayerCommand } = require("../script/state/common");

describe("utils.isLateJoinClosed", () => {
	it("1-x では許可設定によらず締め切らない", () => {
		expect(isLateJoinClosed(false, 0)).toBe(false);
		expect(isLateJoinClosed(true, 0)).toBe(false);
	});

	it("2-1 以降は既定 (不許可) で締め切る", () => {
		expect(isLateJoinClosed(false, 1)).toBe(true);
		expect(isLateJoinClosed(false, 2)).toBe(true);
	});

	it("2-1 以降でも許可されていれば締め切らない", () => {
		expect(isLateJoinClosed(true, 1)).toBe(false);
		expect(isLateJoinClosed(true, 2)).toBe(false);
	});
});

describe("handleAddPlayerCommand の途中参加締め切り", () => {
	function makeContext(opts) {
		const added = [];
		const ctx = {
			allowLateJoin: opts.allowLateJoin,
			worldId: opts.worldId,
			logger: { log: () => undefined },
			playerManager: {
				isBannedPlayer: () => false,
				findPlayer: (id) => (opts.registeredIds.includes(id) ? { id } : null),
				addPlayer: (player) => {
					added.push(player);
					return true;
				}
			},
			inPlayApplyButton: null,
			closedMessageCount: 0,
			isLateJoinClosed() {
				return isLateJoinClosed(this.allowLateJoin, this.worldId);
			},
			showLateJoinClosedMessage() {
				this.closedMessageCount++;
			}
		};
		return { ctx, added };
	}

	function commandOf(id) {
		return {
			type: "add-player",
			player: { id, name: id },
			isHost: false,
			name: id
		};
	}

	beforeEach(() => {
		if (!g.game) {
			g.game = {};
		}
		g.game.selfId = "self";
	});

	it("1-x では登録される", () => {
		const { ctx, added } = makeContext({ allowLateJoin: false, worldId: 0, registeredIds: [] });
		handleAddPlayerCommand(ctx, commandOf("p1"));
		expect(added.length).toBe(1);
		expect(ctx.closedMessageCount).toBe(0);
	});

	it("2-1 以降・不許可では登録されず、本人にだけ締め切りが通知される", () => {
		const { ctx, added } = makeContext({ allowLateJoin: false, worldId: 1, registeredIds: [] });

		handleAddPlayerCommand(ctx, commandOf("self"));
		expect(added.length).toBe(0);
		expect(ctx.closedMessageCount).toBe(1);

		handleAddPlayerCommand(ctx, commandOf("other"));
		expect(added.length).toBe(0);
		expect(ctx.closedMessageCount).toBe(1);
	});

	it("2-1 以降でも許可されていれば登録される", () => {
		const { ctx, added } = makeContext({ allowLateJoin: true, worldId: 1, registeredIds: [] });
		handleAddPlayerCommand(ctx, commandOf("p1"));
		expect(added.length).toBe(1);
		expect(ctx.closedMessageCount).toBe(0);
	});

	it("締め切り後でも登録済みプレイヤーには通知しない", () => {
		const { ctx, added } = makeContext({ allowLateJoin: false, worldId: 1, registeredIds: ["self"] });
		handleAddPlayerCommand(ctx, commandOf("self"));
		expect(added.length).toBe(0);
		expect(ctx.closedMessageCount).toBe(0);
	});
});
