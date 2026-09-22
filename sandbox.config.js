var config = {
	autoSendEventName: "myConfig",

	showMenu: false,
	server: {
		external: {
			scoreboard:
				require.resolve("@multi-indiegame/akashic-scoreboard-serve-coe/server.js"),
		},
	},
	client: {
		external: {
			playerBan:
				require.resolve("@multi-indiegame/akashic-player-ban-serve"),
			scoreboard:
				require.resolve("@multi-indiegame/akashic-scoreboard-serve-coe"),
		},
	},
};

module.exports = config;
