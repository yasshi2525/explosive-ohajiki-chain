var config = {
	autoSendEventName: "myConfig",

	showMenu: false,
	client: {
		external: {
			playerBan:
				require.resolve("@multi-indiegame/akashic-player-ban-serve"),
		},
	},
};

module.exports = config;
